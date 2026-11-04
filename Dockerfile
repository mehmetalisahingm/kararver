# syntax=docker/dockerfile:1.7
# KararVer API + worker imajı (#51, #297): sağlayıcıdan bağımsız (Azure Container Apps, Render, Koyeb, Fly…).
# Railway bugün kendi derleyicisini (Railpack) kullanıyor; bu imaj Railway'den çıkış ve bağımsız yedek için.
#
#   docker build -t kararver-api .                              # medya moderasyonu (Python/NudeNet) olmadan
#   docker build -t kararver-api --build-arg WITH_MODERATION=true .
#   docker run --rm --env-file … kararver-api pnpm --filter @kararver/db run db:deploy   # migration (ayrı adım)
#   docker run -p 4000:4000 --env-file … kararver-api                                     # API + worker
#
# - Node sürümü .nvmrc ile aynı. pnpm sürümü package.json `packageManager` ile aynı ve imajda hazır (Corepack önbelleği
#   çalışma anında indirme yapmaz).
# - PostgreSQL istemci araçları (pg_dump/pg_restore) sunucuyla aynı major olmalı (KV-48): PG_MAJOR (varsayılan 18,
#   staging ve Neon 18.6). Zamanlanmış şifreli yedek (BACKUP_ENABLED) bu araçları PG_BIN'den kullanır.
# - Medya moderasyonu yoksa görsel işleme fail-closed: görseller karantinada kalır (docs/MEDIA_MODERATION.md).
# - Uygulama root olmayan `node` kullanıcısıyla çalışır; sırlar imaja girmez, yalnız çalışma anında ortamdan gelir.
ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV COREPACK_HOME=/opt/corepack
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack install && chmod -R a+rwX /opt/corepack

FROM base AS build
# Önce yalnız manifestler: bağımlılık katmanı kaynak değişikliklerinde yeniden kurulmaz.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/mock-api/package.json apps/mock-api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma packages/db/prisma
# Prisma istemcisi postinstall'da üretilir; üretim bağlantı gerektirmez (adres yalnız yapılandırmanın dolu olması için).
RUN DATABASE_URL=postgresql://build@localhost:5432/build \
    pnpm install --frozen-lockfile --filter "@kararver/api..." --filter "@kararver/worker..."
COPY . .

FROM base AS runtime
ARG PG_MAJOR=18
ARG WITH_MODERATION=false
# PGDG deposu (CI ile aynı resmî yöntem): sunucuyla aynı major istemci.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends "postgresql-client-${PG_MAJOR}" \
 && rm -rf /var/lib/apt/lists/*
COPY apps/worker/python/requirements.txt /tmp/moderation-requirements.txt
RUN set -eu; \
    if [ "$WITH_MODERATION" = "true" ]; then \
      apt-get update; \
      apt-get install -y --no-install-recommends python3 python3-venv; \
      python3 -m venv /opt/moderation; \
      /opt/moderation/bin/pip install --no-cache-dir -r /tmp/moderation-requirements.txt; \
      rm -rf /var/lib/apt/lists/*; \
    fi; \
    rm -f /tmp/moderation-requirements.txt
COPY --from=build --chown=node:node /app /app
# /health → release.sha bu değerden gelir (izleme ve sürüm sabitleme buna dayanır): --build-arg GIT_COMMIT_SHA=$(git rev-parse HEAD)
ARG GIT_COMMIT_SHA=""
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA} \
    NODE_ENV=production \
    PG_BIN=/usr/lib/postgresql/${PG_MAJOR}/bin \
    MODERATION_PYTHON=/opt/moderation/bin/python \
    PORT=4000
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=150s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-api-with-worker.mjs"]

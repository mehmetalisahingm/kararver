# @kararver/contracts — Değişiklik günlüğü

Kurallar: [`docs/API_CONTRACTS.md` §5](../../docs/API_CONTRACTS.md#5-versiyonlama-ve-deprecation).
Kırıcı değişiklikler `contract-breaking` etiketiyle, bütün tüketici sahipleri reviewer olarak eklenerek yapılır.

## 1.0.0 — 2026-09-28 (KV-03, #5)

İlk tam v1 sözleşmesi.

- **Geçiş:** Paket bağımlılıksız `.mjs`'ten TypeScript + zod 4.6.5'e taşındı (TECH_DECISIONS §2). #64'teki export adları (`contractVersion`, `errorStatuses`, `errorResponse`, `pageResponse`, `pollResults`, `eventEnvelope`, `roles`, `canModerate`), davranışları ve 5 testi aynen korundu. Giriş dosyası `src/index.mjs` → `src/index.ts`.
- **Eklendi:**
  - 10 domain için 97 endpoint tanımı: request/response şeması, yetki seviyesi, hata kodları, idempotency, cache, sağlayıcı ve tüketici.
  - `errorStatuses`'a 24 yeni kod; mevcut 9 kod ve status'ları değişmedi.
  - `resultsVisibleTo`, `dbErrorMap`, `allErrors`, `getEndpoint`, `endpoints`.
  - Her endpoint için fixture örnekleri (`fixtures/examples.ts`).
  - Domain olay tipleri: `vote.changed`, `comment.replied`, `reaction.changed`, `report.created`, `points.granted`, `points.debited`, `points.adjusted`.
- **Değişti (tüketicisi yoktu):** FOUNDATION_CONTRACTS'taki `PUT/DELETE /comments/:id/like` yerine `PUT/DELETE /comments/:id/reaction` (like/dislike, #66).

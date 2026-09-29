// KV-03 sözleşme testleri: registry tutarlılığı, fixture ↔ şema uyumu, gizli sonuç,
// validation kuralları ve belge senkronu. DB gerektirmez.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { z } from "zod";
import { examples } from "../fixtures/examples.ts";
import legacyFixture from "../fixtures/polls.json" with { type: "json" };
import {
  allErrors,
  CommentView,
  CreatePollBody,
  CursorQuery,
  endpoints,
  ErrorBody,
  errorStatuses,
  getEndpoint,
  isErrorCode,
  PollCard,
  PollDetail,
  pollResults,
  Results,
  PollViewer,
  resultsVisibleTo,
  voteAvailability,
  VoteBlockedReason,
  voteBlockedReasons,
} from "../src/index.ts";
import { renderInventory, renderUnblocks, replaceBlock } from "../src/inventory.ts";

function mustParse(schema: z.ZodType, value: unknown, label: string): void {
  const result = schema.safeParse(value);
  if (!result.success) {
    assert.fail(`${label}: ${JSON.stringify(result.error.issues, null, 2)}`);
  }
}

// ─── Registry ─────────────────────────────────────────────────

describe("endpoint registry", () => {
  test("id ve method+path benzersiz", () => {
    const ids = endpoints.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, "tekrarlanan id");
    const routes = endpoints.map((e) => `${e.method} ${e.path}`);
    assert.equal(new Set(routes).size, routes.length, "tekrarlanan route");
  });

  test("her endpoint tam tanımlı", () => {
    for (const e of endpoints) {
      assert.match(e.path, /^\/[a-z0-9/_-]*(:[A-Za-z]+[a-z0-9/_-]*)*$/, `${e.id} path`);
      assert.ok(!e.path.startsWith("/v1"), `${e.id}: /v1 öneki path'e yazılmaz`);
      assert.ok(e.consumers.length > 0, `${e.id} consumer`);
      assert.ok(e.unblocks.length > 0 && e.unblocks.every((u) => /^#\d+$/.test(u)), `${e.id} unblocks`);
      const statuses = Object.keys(e.responses).map(Number);
      assert.ok(statuses.length > 0 && statuses.every((s) => s >= 200 && s < 300), `${e.id} başarı status'ları`);
      assert.ok(e.errors.every(isErrorCode), `${e.id} bilinmeyen hata kodu`);
      if (e.availability.status === "planned") assert.match(e.availability.tableIn, /^#\d+$/, `${e.id} tableIn`);
    }
  });

  test("HTTP semantiği: GET gövde almaz; key-zorunlu sadece POST; admin yolu yetkisiz olamaz", () => {
    for (const e of endpoints) {
      if (e.method === "GET") {
        assert.equal(e.request.body, undefined, `${e.id} GET body`);
        assert.equal(e.idempotency, "none", `${e.id} GET idempotency`);
      }
      if (e.idempotency === "key-required") assert.equal(e.method, "POST", e.id);
      if (e.method === "PUT" || e.method === "DELETE") assert.equal(e.idempotency, "natural", `${e.id} PUT/DELETE doğal idempotent olmalı`);
      if (e.path.startsWith("/admin")) assert.ok(["moderator", "admin", "super_admin"].includes(e.auth), `${e.id} admin yetkisi`);
    }
  });

  test("misafire açık mutation'lar sadece bilinçli istisnalar", () => {
    const publicMutations = endpoints.filter((e) => e.method !== "GET" && e.auth === "public").map((e) => e.id);
    assert.deepEqual(publicMutations.sort(), [
      "auth.email.verify",
      "auth.login",
      "auth.password.forgot",
      "auth.password.reset",
      "auth.register",
      "shares.create",
    ]);
  });

  test("ürün kuralları: yayın, yorum ve oy e-posta doğrulaması ister; tepki sadece giriş", () => {
    for (const id of ["polls.create", "comments.create", "votes.put", "media.uploads.create"]) {
      assert.equal(getEndpoint(id).auth, "verified", id);
    }
    for (const id of ["reactions.poll.put", "reactions.comment.put"]) assert.equal(getEndpoint(id).auth, "user", id);
  });

  test("puan harcayan işlemler Idempotency-Key ister", () => {
    assert.equal(getEndpoint("polls.create").idempotency, "key-required");
    assert.equal(getEndpoint("admin.points.adjust").idempotency, "key-required");
    assert.equal(getEndpoint("votes.put").idempotency, "natural");
  });

  test("V1_USER_FLOW endpointleri planlı olarak işaretli", () => {
    const planned = endpoints.filter((e) => e.availability.status === "planned").map((e) => e.id);
    for (const id of [
      "reactions.poll.put",
      "points.get",
      "points.ledger",
      "admin.points.adjust",
      "admin.revisions.polls",
    ]) {
      assert.ok(planned.includes(id), `${id} planlı olmalı`);
    }
  });

  test("kategori yönetimi Faruk'ta (KV-26), UI Mehmet'te (KV-41)", () => {
    for (const e of endpoints.filter((x) => x.path.startsWith("/admin/categories"))) {
      assert.equal(e.provider.owner, "Faruk", e.id);
      assert.ok(e.unblocks.includes("#43"), e.id);
    }
  });
});

// ─── Fixture ↔ şema ───────────────────────────────────────────

describe("fixture örnekleri", () => {
  test("her endpoint'in en az bir başarılı örneği var", () => {
    for (const e of endpoints) {
      const ok = examples.some((x) => x.endpoint === e.id && x.status < 300);
      assert.ok(ok, `${e.id} için başarılı örnek yok`);
    }
  });

  for (const example of examples) {
    test(`${example.endpoint} · ${example.name} (${example.status})`, () => {
      const e = getEndpoint(example.endpoint);
      const label = `${example.endpoint}/${example.name}`;
      const { params, query, body } = e.request;
      if (params) mustParse(params, example.request?.params ?? {}, `${label} params`);
      if (query) mustParse(query, example.request?.query ?? {}, `${label} query`);
      if (body) mustParse(body, example.request?.body, `${label} body`);
      if (!body) assert.equal(example.request?.body, undefined, `${label}: bu endpoint gövde almaz`);

      if (example.status < 300) {
        const schema = e.responses[example.status];
        assert.ok(schema, `${label}: ${example.status} bu endpoint'in başarı cevabı değil`);
        mustParse(schema, example.body, `${label} response`);
      } else {
        mustParse(ErrorBody, example.body, `${label} error body`);
        const code = (example.body as { error: { code: keyof typeof errorStatuses } }).error.code;
        assert.equal(errorStatuses[code], example.status, `${label}: ${code} status'u ${errorStatuses[code]}`);
        assert.ok(allErrors(e).includes(code), `${label}: ${code} bu endpoint'in hata listesinde yok`);
      }
    });
  }

  test("#64 fixture'ı (polls.json) yeni şemalarla uyumlu", () => {
    mustParse(Results, legacyFixture.hidden.results, "hidden.results");
    mustParse(Results, legacyFixture.closed.results, "closed.results");
    mustParse(ErrorBody, legacyFixture.forbidden, "forbidden");
    mustParse(getEndpoint("feed.list").responses[200], legacyFixture.empty, "empty page");
    mustParse(getEndpoint("trends.list").responses[200], { ...legacyFixture.trendInsufficient, meta: null }, "trendInsufficient");
  });
});

// ─── Gizli sonuç ──────────────────────────────────────────────

describe("gizli sonuç (AFTER_VOTE)", () => {
  test("görünürlük kuralı", () => {
    const base = { resultsVisibility: "AFTER_VOTE", closed: false, viewerHasValidVote: false, viewerIsAuthor: false } as const;
    assert.equal(resultsVisibleTo(base), false);
    assert.equal(resultsVisibleTo({ ...base, viewerHasValidVote: true }), true);
    assert.equal(resultsVisibleTo({ ...base, closed: true }), true);
    assert.equal(resultsVisibleTo({ ...base, resultsVisibility: "ALWAYS" }), true);
  });

  test("anket sahibi oy veremediği için sonuçları kapanmadan da görür (Mehmet kararı, 2026-09-28)", () => {
    assert.equal(
      resultsVisibleTo({ resultsVisibility: "AFTER_VOTE", closed: false, viewerHasValidVote: false, viewerIsAuthor: true }),
      true,
    );
  });

  test("viewerIsAuthor verilmezse #64 davranışı korunur (sahip değil sayılır)", () => {
    assert.equal(resultsVisibleTo({ resultsVisibility: "AFTER_VOTE", closed: false, viewerHasValidVote: false }), false);
    assert.equal(resultsVisibleTo({ resultsVisibility: "AFTER_VOTE", closed: false, viewerHasValidVote: true }), true);
  });

  test("fixture'larda sahip her zaman görünür sonuç alır", () => {
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== "object") return;
      const obj = value as Record<string, unknown>;
      const v = obj.viewer as { isAuthor?: boolean } | null | undefined;
      if (v?.isAuthor && obj.results) assert.deepEqual((obj.results as { visible: boolean }).visible, true, "sahibe gizli sonuç");
      Object.values(obj).forEach(walk);
    };
    examples.forEach((x) => walk(x.body));
  });

  test("gizli projeksiyona sayı sızdırmak şema ihlalidir", () => {
    assert.equal(Results.safeParse({ visible: false, total: 3 }).success, false);
    assert.equal(Results.safeParse({ visible: false, options: [] }).success, false);
    mustParse(Results, pollResults({ visible: false, total: 3, options: [{ id: "a", votes: 3 }] }), "helper");
  });

  test("kart ve detay dışarıda oy sayısı taşıyamaz", () => {
    const card = examples.find((x) => x.endpoint === "feed.list" && x.name === "guest");
    const first = (card?.body as { data: Record<string, unknown>[] }).data[0];
    assert.equal(PollCard.safeParse({ ...first, voteCount: 10 }).success, false, "PollCard.voteCount reddedilmeli");
    const detail = examples.find((x) => x.endpoint === "polls.get" && x.name === "guest-hidden");
    const d = (detail?.body as { data: Record<string, unknown> }).data;
    assert.equal(PollDetail.safeParse({ ...d, totalVotes: 10 }).success, false, "PollDetail.totalVotes reddedilmeli");
  });

  test("gizli örneklerde hiçbir yerde sayı yok", () => {
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== "object") return;
      const obj = value as Record<string, unknown>;
      if (obj.visible === false) assert.deepEqual(Object.keys(obj), ["visible"]);
      Object.values(obj).forEach(walk);
    };
    examples.forEach((x) => walk(x.body));
  });
});

// ─── Oy durumu (viewer.canVote) ───────────────────────────────

describe("izleyici oy durumu", () => {
  const ok = {
    kind: "POLL",
    viewerIsAuthor: false,
    closed: false,
    contentStatus: "ACTIVE",
    accountRestricted: false,
    emailVerified: true,
    voteInvalidated: false,
    hasVote: false,
    voteChangeAllowed: true,
  } as const;

  test("engel yoksa oy verebilir", () => {
    assert.deepEqual(voteAvailability(ok), { canVote: true, voteBlockedReason: null });
    assert.deepEqual(voteAvailability({ ...ok, hasVote: true }), { canVote: true, voteBlockedReason: null });
  });

  test("her sebep tek başına doğru kodu verir", () => {
    const cases: [Partial<Parameters<typeof voteAvailability>[0]>, string][] = [
      [{ kind: "DISCUSSION" }, "NOT_A_POLL"],
      [{ viewerIsAuthor: true }, "OWN_POLL"],
      [{ closed: true }, "POLL_CLOSED"],
      [{ contentStatus: "LOCKED" }, "CONTENT_LOCKED"],
      [{ accountRestricted: true }, "ACCOUNT_RESTRICTED"],
      [{ emailVerified: false }, "EMAIL_NOT_VERIFIED"],
      [{ voteInvalidated: true }, "VOTE_INVALIDATED"],
      [{ hasVote: true, voteChangeAllowed: false }, "VOTE_CHANGE_DISABLED"],
    ];
    for (const [patch, reason] of cases) {
      assert.deepEqual(voteAvailability({ ...ok, ...patch }), { canVote: false, voteBlockedReason: reason }, reason);
    }
  });

  test("sahip, e-postası doğrulanmamış olsa da OWN_POLL alır (öncelik sırası)", () => {
    assert.equal(voteAvailability({ ...ok, viewerIsAuthor: true, emailVerified: false }).voteBlockedReason, "OWN_POLL");
  });

  test("şema ile helper aynı sebep listesini kullanır", () => {
    assert.deepEqual(VoteBlockedReason.options, [...voteBlockedReasons]);
  });

  test("şema tutarsız viewer'ı reddeder", () => {
    const viewer = {
      vote: null,
      voteInvalidated: false,
      reaction: null,
      bookmarked: false,
      following: false,
      isAuthor: false,
      canVote: true,
      voteBlockedReason: null,
    };
    mustParse(PollViewer, viewer, "geçerli viewer");
    assert.equal(PollViewer.safeParse({ ...viewer, voteBlockedReason: "POLL_CLOSED" }).success, false, "canVote true + sebep");
    assert.equal(PollViewer.safeParse({ ...viewer, canVote: false }).success, false, "canVote false + sebep yok");
    assert.equal(PollViewer.safeParse({ ...viewer, isAuthor: true }).success, false, "sahip oy verebilir görünüyor");
  });

  test("oy hata kodları ile engel sebepleri eşleşir", () => {
    const errors = allErrors(getEndpoint("votes.put"));
    const reasonToError: Record<string, string> = {
      NOT_A_POLL: "NOT_A_POLL",
      OWN_POLL: "SELF_VOTE_FORBIDDEN",
      POLL_CLOSED: "POLL_CLOSED",
      CONTENT_LOCKED: "CONTENT_LOCKED",
      ACCOUNT_RESTRICTED: "ACCOUNT_RESTRICTED",
      EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
      VOTE_INVALIDATED: "VOTE_INVALIDATED",
      VOTE_CHANGE_DISABLED: "VOTE_CHANGE_DISABLED",
    };
    for (const reason of voteBlockedReasons) {
      assert.ok(errors.includes(reasonToError[reason] as never), `${reason} → ${reasonToError[reason]} votes.put hata listesinde`);
    }
  });
});

// ─── Validation kuralları ─────────────────────────────────────

describe("validation", () => {
  const base = {
    kind: "POLL",
    title: "Bu araba bu fiyata alınır mı?",
    categoryId: "01998b9a-0000-7000-8000-000000000010",
    durationHours: 24,
    resultsVisibility: "ALWAYS",
  };
  const options = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Seçenek ${i + 1}` }));

  test("anket 2–6 farklı seçenek ister", () => {
    assert.equal(CreatePollBody.safeParse({ ...base, options: options(1) }).success, false);
    assert.equal(CreatePollBody.safeParse({ ...base, options: options(2) }).success, true);
    assert.equal(CreatePollBody.safeParse({ ...base, options: options(6) }).success, true);
    assert.equal(CreatePollBody.safeParse({ ...base, options: options(7) }).success, false);
    assert.equal(CreatePollBody.safeParse({ ...base, options: [{ label: "Evet" }, { label: "EVET" }] }).success, false);
  });

  test("tartışma seçenek ve sonuç görünürlüğü almaz", () => {
    const d = { kind: "DISCUSSION", title: base.title, categoryId: base.categoryId };
    assert.equal(CreatePollBody.safeParse(d).success, true);
    assert.equal(CreatePollBody.safeParse({ ...d, options: options(2) }).success, false);
  });

  test("bilinmeyen alan reddedilir (strict)", () => {
    assert.equal(CreatePollBody.safeParse({ ...base, options: options(2), authorId: "x" }).success, false);
  });

  test("alternatif öneri cevap olamaz", () => {
    const body = getEndpoint("comments.create").request.body!;
    assert.equal(body.safeParse({ body: "x", kind: "ALTERNATIVE", parentId: "01998b9a-0000-7000-8000-000000000040" }).success, false);
    assert.equal(body.safeParse({ body: "x", parentId: "01998b9a-0000-7000-8000-000000000040" }).success, true);
  });

  test("yaptırım süresi: SUSPEND süreli, BAN kalıcı (DB CHECK ile aynı)", () => {
    const body = getEndpoint("admin.sanctions.create").request.body!;
    const endsAt = "2026-10-05T12:00:00.000Z";
    assert.equal(body.safeParse({ type: "SUSPEND", reason: "spam tekrarı" }).success, false);
    assert.equal(body.safeParse({ type: "SUSPEND", reason: "spam tekrarı", endsAt }).success, true);
    assert.equal(body.safeParse({ type: "BAN", reason: "spam tekrarı", endsAt }).success, false);
    assert.equal(body.safeParse({ type: "BAN", reason: "spam tekrarı" }).success, true);
    assert.equal(body.safeParse({ type: "BAN", reason: "spam tekrarı", endsAt: null }).success, true);
    assert.equal(body.safeParse({ type: "RESTRICT_COMMENTS", reason: "spam tekrarı", endsAt }).success, true);
  });

  test("pagination: limit 1–100, varsayılan 20, cursor base64url", () => {
    assert.equal(CursorQuery.parse({}).limit, 20);
    assert.equal(CursorQuery.parse({ limit: "100" }).limit, 100);
    assert.equal(CursorQuery.safeParse({ limit: "101" }).success, false);
    assert.equal(CursorQuery.safeParse({ limit: "0" }).success, false);
    assert.equal(CursorQuery.safeParse({ cursor: "abc+/=" }).success, false);
  });

  test("silinmiş yorum tombstone'u metin taşımaz ama şemaya uyar", () => {
    const tomb = examples.find((x) => x.name === "tombstone");
    const c = (tomb?.body as { data: unknown[] }).data[0];
    mustParse(CommentView, c, "tombstone");
  });
});

// ─── Belge senkronu ───────────────────────────────────────────

test("docs/API_CONTRACTS.md envanteri registry ile aynı (değiştiyse: pnpm --filter @kararver/contracts docs)", () => {
  const docPath = path.resolve(import.meta.dirname, "../../../docs/API_CONTRACTS.md");
  const doc = readFileSync(docPath, "utf8").replaceAll("\r\n", "\n");
  const expected = replaceBlock(replaceBlock(doc, "inventory", renderInventory(endpoints)), "unblocks", renderUnblocks(endpoints));
  assert.equal(doc, expected);
});


test("anket sahibinin oy reddi endpoint ve hata fixture sözleşmesinde zorunlu", () => {
  const endpoint = getEndpoint("votes.put");
  assert.ok(allErrors(endpoint).includes("SELF_VOTE_FORBIDDEN"));
  assert.equal(errorStatuses.SELF_VOTE_FORBIDDEN, 403);
  const fixture = examples.find(e => e.endpoint === "votes.put" && e.name === "self-vote-forbidden");
  assert.ok(fixture);
  assert.equal(fixture.status, 403);
  mustParse(ErrorBody, fixture.body, "self vote rejection");
  assert.equal((fixture.body as {error: {code: string}}).error.code, "SELF_VOTE_FORBIDDEN");
});

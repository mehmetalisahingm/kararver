// KV-39 audit sözleşmesi: gerekçe listesi ↔ endpoint gövdeleri, işlem türleri ve assertAuditEntry kuralları. DB gerektirmez.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { z } from "zod";
import {
  actions,
  allowedAuditOperations,
  assertAuditEntry,
  AUDIT_SUMMARY_MAX_CHARS,
  auditOperations,
  AuditEntry,
  endpointPermissions,
  endpoints,
  isAuditAction,
  ModerationAction,
  reasonRequiredActions,
  systemAuditActions,
  type AuditEntryInput,
} from "../src/index.ts";

const ADMIN = "0199a000-0000-7000-8000-000000000001";
const TARGET = "0199a000-0000-7000-8000-000000000002";
const STAFF = new Set(["moderator", "admin", "super_admin"]);
/** Gerekçe alanı olan ama türlerinden biri gerekçesiz olduğu için listede olmayan işlemler. */
const REASON_EXCEPTIONS = new Set(["community.moderator.assign", "featured.manage", "announcement.manage", "media.ban.manage"]);

const api = (overrides: Partial<AuditEntryInput> = {}): AuditEntryInput => ({
  source: "API",
  actorId: ADMIN,
  action: "user.sanction",
  target: { type: "USER", id: TARGET },
  reason: "Tekrarlayan spam",
  before: { status: "ACTIVE" },
  after: { status: "SUSPENDED" },
  requestId: "req_01998b9a00007000",
  ...overrides,
});

function bodyKeys(schema: z.ZodType | undefined): string[] {
  const shape = (schema as { shape?: Record<string, unknown> } | undefined)?.shape;
  return shape ? Object.keys(shape) : [];
}

const mutating = endpoints.filter((e) => e.method !== "GET");

describe("gerekçe zorunlu işlemler", () => {
  test("listedeki her işlemin bütün değiştiren endpoint'leri gövdede reason (rapor: note) ister", () => {
    for (const action of reasonRequiredActions) {
      const list = mutating.filter((e) => endpointPermissions[e.id] === action);
      assert.ok(list.length > 0, `${action}: değiştiren endpoint yok`);
      for (const e of list) {
        const key = action === "report.resolve" ? "note" : "reason";
        assert.ok(bodyKeys(e.request.body).includes(key), `${e.id}: gövdede ${key} yok`);
        const field = (e.request.body as z.ZodObject).shape[key] as z.ZodType;
        assert.equal(field.safeParse(undefined).success, false, `${e.id}: ${key} isteğe bağlı`);
        assert.equal(field.safeParse("  ").success, false, `${e.id}: ${key} boş geçiyor`);
      }
    }
  });

  test("gövdesinde reason olan yönetici endpoint'inin işlemi listede (bilinen istisnalar hariç)", () => {
    for (const e of mutating) {
      if (!STAFF.has(e.auth) || !bodyKeys(e.request.body).includes("reason")) continue;
      const action = endpointPermissions[e.id]!;
      assert.ok(reasonRequiredActions.has(action) || REASON_EXCEPTIONS.has(action), `${e.id} (${action}) listede değil`);
    }
  });

  test("istisnalar gerçekten gerekçesiz bir endpoint içerir", () => {
    for (const action of REASON_EXCEPTIONS) {
      const list = mutating.filter((e) => endpointPermissions[e.id] === action);
      assert.ok(list.some((e) => !bodyKeys(e.request.body).includes("reason")), action);
    }
  });
});

describe("işlem türü (operation)", () => {
  test("haritadaki her anahtar audit işlemi; türler küçük harf, tekil ve DB biçiminde", () => {
    for (const [action, ops] of Object.entries(auditOperations)) {
      assert.ok(isAuditAction(action), action);
      assert.ok(ops!.length > 0, action);
      assert.equal(new Set(ops).size, ops!.length, action);
      for (const op of ops!) assert.match(op, /^[a-z][a-z_]*$/, `${action}: ${op}`);
    }
  });

  test("audit'li her işlem haritada açıkça: gerekçe zorunlular ve bütün değiştiren yönetici endpoint'leri", () => {
    for (const action of reasonRequiredActions) assert.ok(Object.hasOwn(auditOperations, action), `${action} haritada yok`);
    for (const e of mutating) {
      if (!STAFF.has(e.auth)) continue;
      const action = endpointPermissions[e.id]!;
      assert.ok(Object.hasOwn(auditOperations, action), `${e.id} (${action}) haritada yok`);
    }
    for (const action of Object.keys(auditOperations)) assert.ok(Object.hasOwn(actions, action), `${action} KV-04 kataloğunda yok`);
  });

  test("son parça varsayılanı yalnız sistem işlemlerinde; haritada olmayan katalog işlemi audit'e yazılamaz", () => {
    for (const action of systemAuditActions) {
      assert.ok(!Object.hasOwn(auditOperations, action), action);
      assert.deepEqual(allowedAuditOperations(action), [action.slice(action.lastIndexOf(".") + 1)]);
    }
    assert.deepEqual(allowedAuditOperations("user.status.sync"), ["sync"]);
    for (const action of Object.keys(actions).filter((a) => !Object.hasOwn(auditOperations, a))) {
      assert.throws(() => allowedAuditOperations(action as never), /audit'li değil/, action);
    }
    assert.throws(() => assertAuditEntry(api({ action: "account.verifyEmail", reason: null })), /audit'li değil/);
  });

  test("ayrım gereken işlemler birden çok türlü", () => {
    assert.deepEqual(allowedAuditOperations("user.role.assign"), ["grant", "revoke", "change"]);
    assert.deepEqual(allowedAuditOperations("vote.invalidate"), ["invalidate", "restore"]);
    assert.deepEqual(allowedAuditOperations("community.moderator.assign"), ["assign", "remove"]);
    assert.deepEqual(allowedAuditOperations("user.sanction"), ["apply"]);
    assert.deepEqual(allowedAuditOperations("user.sanction.lift"), ["lift"]);
    assert.deepEqual(allowedAuditOperations("moderation.poll.apply"), ModerationAction.options.map((o) => o.toLowerCase()));
    assert.ok(!allowedAuditOperations("moderation.comment.apply").includes("exclude_from_trends"));
  });

  test("tek türlüde varsayılan yazılır, birden çok türlüde zorunlu, izinsiz tür reddedilir", () => {
    assert.equal(assertAuditEntry(api()).operation, "apply");
    const invalidate = api({ action: "vote.invalidate", target: { type: "VOTE", id: TARGET }, before: null, after: null });
    assert.throws(() => assertAuditEntry(invalidate), /operation zorunlu/);
    assert.equal(assertAuditEntry({ ...invalidate, operation: "restore" }).operation, "restore");
    assert.throws(() => assertAuditEntry({ ...invalidate, operation: "delete" }), /geçersiz operation/);
    assert.throws(() => assertAuditEntry(api({ operation: "lift" })), /geçersiz operation/);
  });

  test("katalog dışı işlem reddedilir", () => {
    assert.throws(() => assertAuditEntry(api({ action: "sanction.applied" as never })), /bilinmeyen işlem/);
    assert.throws(() => allowedAuditOperations("audit.delete" as never), /bilinmeyen işlem/);
  });
});

describe("assertAuditEntry", () => {
  test("gerekçe: zorunlu işlemde eksik/boş/kısa reddedilir, trim edilir; zorunlu olmayanda null olabilir", () => {
    assert.throws(() => assertAuditEntry(api({ reason: undefined })), /gerekçe ister/);
    assert.throws(() => assertAuditEntry(api({ reason: null })), /gerekçe ister/);
    assert.throws(() => assertAuditEntry(api({ reason: "   " })), /gerekçe ister/);
    assert.throws(() => assertAuditEntry(api({ reason: " ab " })), /gerekçe 3–500/);
    assert.throws(() => assertAuditEntry(api({ reason: "x".repeat(501) })), /gerekçe 3–500/);
    assert.equal(assertAuditEntry(api({ reason: "  Spam hesap  " })).reason, "Spam hesap");
    const read = assertAuditEntry(api({ action: "revision.read", target: { type: "POLL", id: TARGET }, reason: undefined }));
    assert.equal(read.reason, null);
    assert.equal(read.operation, "read");
  });

  test("kaynak ve aktör: API aktör + requestId ister; CLI/worker aktörsüz; sistem işlemi API'den yazılamaz", () => {
    assert.throws(() => assertAuditEntry(api({ actorId: null })), /actorId/);
    assert.throws(() => assertAuditEntry(api({ actorId: "admin" })), /actorId/);
    assert.throws(() => assertAuditEntry(api({ requestId: null })), /requestId zorunlu/);
    assert.throws(() => assertAuditEntry(api({ source: "CLI" })), /CLI kaydında actorId null/);
    assert.throws(() => assertAuditEntry(api({ source: "ROOT" as never })), /geçersiz kaynak/);
    const role = { source: "CLI", actorId: null, requestId: null, action: "user.role.assign" } as const;
    assert.throws(() => assertAuditEntry(api(role)), /operation zorunlu \(grant \| revoke \| change\)/);
    const cli = assertAuditEntry(api({ ...role, operation: "grant" }));
    assert.deepEqual([cli.source, cli.actorId, cli.requestId, cli.operation], ["CLI", null, null, "grant"]);
    const sync = { source: "WORKER", actorId: null, action: "user.status.sync", target: { type: "USER", id: TARGET } } as const;
    assert.equal(assertAuditEntry(sync).operation, "sync");
    assert.throws(() => assertAuditEntry({ ...sync, source: "API", actorId: ADMIN, requestId: "req_1" }), /sistem işlemidir/);
  });

  test("hedef tipi ve id doğrulanır", () => {
    assert.throws(() => assertAuditEntry(api({ target: { type: "user" as never, id: TARGET } })), /hedef tipi/);
    assert.throws(() => assertAuditEntry(api({ target: { type: "USER", id: "" } })), /hedef id/);
    assert.throws(() => assertAuditEntry(api({ target: { type: "SETTING", id: "x".repeat(65) } })), /hedef id/);
    assert.equal(assertAuditEntry(api({ action: "settings.update", target: { type: "SETTING", id: "polls.maxOptions" } })).target.id, "polls.maxOptions");
  });

  test("önce/sonra: nesne olmalı, hassas alan (iç içe dahil) ve büyük özet reddedilir", () => {
    for (const before of [
      { email: "a@b.c" },
      { emailNormalized: "a@b.c" },
      { password_hash: "x" },
      { session: { tokenHash: "x" } },
      { ip: "1.1.1.1" },
      { user_agent: "x" },
      { votes: [{ optionId: TARGET }] },
      { fromOptionId: TARGET },
    ]) {
      assert.throws(() => assertAuditEntry(api({ before })), /hassas alan/, JSON.stringify(before));
    }
    assert.throws(() => assertAuditEntry(api({ after: ["ACTIVE"] as never })), /nesne olmalı/);
    assert.throws(() => assertAuditEntry(api({ after: "ACTIVE" as never })), /nesne olmalı/);
    assert.throws(() => assertAuditEntry(api({ after: { note: "x".repeat(AUDIT_SUMMARY_MAX_CHARS) } })), /en fazla/);
    const ok = assertAuditEntry(api({ before: { status: "ACTIVE", voteCount: 3 }, after: null }));
    assert.deepEqual([ok.before, ok.after], [{ status: "ACTIVE", voteCount: 3 }, null]);
  });

  test("normalleştirilmiş kayıt AuditEntry yanıt şemasının alanlarıyla uyumlu", () => {
    const e = assertAuditEntry(api());
    const row = {
      id: TARGET,
      actor: { id: ADMIN, username: "deniz", displayName: "Deniz", avatarUrl: null },
      source: e.source,
      action: e.action,
      operation: e.operation,
      target: e.target,
      before: e.before,
      after: e.after,
      reason: e.reason,
      requestId: e.requestId,
      createdAt: "2026-10-01T09:00:00.000Z",
    };
    assert.ok(AuditEntry.safeParse(row).success);
  });
});

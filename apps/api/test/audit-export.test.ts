/**
 * #185 sunucu audit export'u (admin.audit.export): yalnız SUPER_ADMIN, taze step-up (tek kullanımlık), ≤ 31 gün ve
 * ≤ AUDIT_EXPORT_MAX_ROWS kayıt; dosya admin.audit.list'in temizlenmiş görünümüdür, CSV formül koruması vardır ve
 * export'un kendisi aynı transaction'da audit'e yazılır. Sınır aşılınca step-up tüketilmez, kayıt yazılmaz.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { AUDIT_EXPORT_MAX_ROWS, AuditExportFile, ErrorBody } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { decodeBase32, hotp } from "../src/modules/security/totp.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";
import { rbacSeeds } from "./support/rbac-probe.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; email: string; password: string; secret?: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };

describe("audit export (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let root: User;
  let admin: User;
  let moderator: User;

  function send(method: "GET" | "POST", url: string, body?: unknown, cookie?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Promise<Res>;
  }
  const assertError = (res: Res, status: number, code: string, detail?: string) => {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
    if (detail) assert.equal(res.json().error.details[0]?.code, detail);
  };

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `aex_${id}@example.test`, username: `aex_${id}`, displayName: "Export", password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id, email: account.email, password: account.password };
  }
  const totp = (secret: string) => hotp(decodeBase32(secret), Math.floor(h.clock.now.getTime() / 30000));
  async function enroll(user: User) {
    const start = await send("POST", "/me/mfa/setup", { password: user.password }, user.cookie);
    assert.equal(start.statusCode, 200, start.body);
    user.secret = start.json().data.secret as string;
    assert.equal((await send("POST", "/me/mfa/confirm", { code: totp(user.secret) }, user.cookie)).statusCode, 200);
  }
  /** Taze, tek kullanımlık step-up (TOTP tekrarını önlemek için bir adım ilerletilir). */
  async function stepup(user: User) {
    h.clock.advance(30_000);
    assert.equal((await send("POST", "/me/mfa/step-up", { code: totp(user.secret!) }, user.cookie)).statusCode, 200);
  }
  const exportsBy = (actorId: string) => db.auditLog.findMany({ where: { action: "audit.export", actorId }, orderBy: { createdAt: "asc" } });
  const exportFile = (res: Res) => {
    assert.equal(res.statusCode, 200, res.body);
    return AuditExportFile.parse(res.json().data);
  };

  // Ayrı bir yılda, ayrı hedefle: başka testlerin kayıtları dosyaya karışmaz.
  const targetId = randomUUID();
  const range = { from: "2001-01-01T00:00:00.000Z", to: "2001-01-31T00:00:00.000Z" };

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    root = await signUp();
    admin = await signUp();
    moderator = await signUp();
    const seeds = rbacSeeds(h);
    await seeds.setRole(root.id, "SUPER_ADMIN", null);
    await seeds.setRole(admin.id, "ADMIN", root.id);
    await seeds.setRole(moderator.id, "MODERATOR", root.id);
    await enroll(root);
    await enroll(admin);
    // Eski/elle eklenmiş kaydı taklit eder: hassas anahtar ve formül benzeri gerekçe (yazma yolu bunları reddeder).
    await db.auditLog.createMany({
      data: [
        { source: "API", actorId: admin.id, action: "user.sanction", operation: "apply", targetType: "USER", targetId, reason: "=HYPERLINK(\"http://x.test\",\"tıkla\")", requestId: "req-aex-1", before: { status: "ACTIVE" }, after: { status: "SUSPENDED" }, createdAt: new Date("2001-01-10T00:00:00.000Z") },
        { source: "CLI", action: "user.status.sync", operation: "sync", targetType: "USER", targetId, reason: "@komut", before: { passwordHash: "$argon2id$gizli" }, after: { note: "-2+3" }, createdAt: new Date("2001-01-11T00:00:00.000Z") },
        { source: "CLI", action: "user.status.sync", operation: "sync", targetType: "USER", targetId, reason: "\tsekme ile", createdAt: new Date("2001-01-12T00:00:00.000Z") },
        // Aralık dışı (to hariç): dosyaya girmez.
        { source: "CLI", action: "user.status.sync", operation: "sync", targetType: "USER", targetId, createdAt: new Date(range.to) },
      ],
    });
  });
  after(async () => {
    await h?.close();
  });

  const body = (extra: Record<string, unknown> = {}) => ({ format: "json", ...range, targetId, reason: "Çeyrek audit denetimi", ...extra });

  test("yalnız SUPER_ADMIN: misafir 401; kullanıcı, moderatör ve step-up'lı ADMIN 403; iz oluşmaz", async () => {
    const user = await signUp();
    assertError(await send("POST", "/admin/audit/export", body()), 401, "UNAUTHENTICATED");
    assertError(await send("POST", "/admin/audit/export", body(), user.cookie), 403, "FORBIDDEN");
    assertError(await send("POST", "/admin/audit/export", body(), moderator.cookie), 403, "FORBIDDEN");
    await stepup(admin);
    assertError(await send("POST", "/admin/audit/export", body(), admin.cookie), 403, "FORBIDDEN");
    assert.equal(await db.auditLog.count({ where: { action: "audit.export", actorId: { in: [user.id, moderator.id, admin.id, root.id] } } }), 0);
  });

  test("sınırlar: from/to zorunlu, to > from, en çok 31 gün; gerekçe zorunlu; biçim csv|json", async () => {
    const bad = [
      { ...body(), from: undefined },
      { ...body(), to: range.from },
      { ...body(), to: "2001-02-02T00:00:01.000Z" },
      { ...body(), reason: undefined },
      { ...body(), reason: "  " },
      { ...body(), format: "xlsx" },
      { ...body(), unknown: 1 },
    ];
    for (const b of bad) assertError(await send("POST", "/admin/audit/export", b, root.cookie), 400, "VALIDATION_ERROR");
    assert.equal((await exportsBy(root.id)).length, 0);
  });

  test("step-up yoksa 403 stepup_required; kayıt yazılmaz", async () => {
    assertError(await send("POST", "/admin/audit/export", body(), root.cookie), 403, "FORBIDDEN", "stepup_required");
    assert.equal((await exportsBy(root.id)).length, 0);
  });

  test("JSON: aralık ve süzgeç, en yeni önce, temizlenmiş özet; export audit'e yazılır ve step-up tek kullanımlık", async () => {
    await stepup(root);
    const res = await send("POST", "/admin/audit/export", body(), root.cookie);
    const file = exportFile(res);
    assert.equal(file.count, 3);
    assert.equal(file.contentType, "application/json");
    assert.equal(file.filename, "kararver-audit-2001-01-01_2001-01-31.json");
    const doc = JSON.parse(file.content);
    assert.deepEqual([doc.scope, doc.from, doc.to, doc.filters, doc.count], ["server_range", range.from, range.to, { targetId }, 3]);
    assert.deepEqual(doc.records.map((r: any) => r.createdAt), ["2001-01-12T00:00:00.000Z", "2001-01-11T00:00:00.000Z", "2001-01-10T00:00:00.000Z"]);
    assert.deepEqual(doc.records[1].before, { passwordHash: "[gizli]" });
    assert.equal(doc.records[2].actorId, admin.id);
    assert.ok(!file.content.includes(admin.email) && !/avatar/i.test(file.content), "e-posta ve avatar bağlantısı dosyaya girmez");

    const [entry] = await exportsBy(root.id);
    assert.ok(entry);
    assert.deepEqual(
      [entry.source, entry.operation, entry.targetType, entry.targetId, entry.reason, entry.requestId],
      ["API", "export", "AUDIT", "audit_logs", "Çeyrek audit denetimi", res.headers["x-request-id"]],
    );
    assert.deepEqual(entry.after, { format: "json", from: range.from, to: range.to, filters: { targetId }, count: 3 });
    // Export kaydı dosyaya girmez ve kendi aralığına düşmez; step-up tüketildi.
    assertError(await send("POST", "/admin/audit/export", body(), root.cookie), 403, "FORBIDDEN", "stepup_required");
    assert.equal((await exportsBy(root.id)).length, 1);
  });

  test("CSV: BOM, başlık, her alan tırnaklı; formül ve kontrol karakteri başlangıçları apostrofla korunur", async () => {
    await stepup(root);
    const file = exportFile(await send("POST", "/admin/audit/export", body({ format: "csv" }), root.cookie));
    assert.equal(file.contentType, "text/csv;charset=utf-8");
    assert.ok(file.content.startsWith("﻿\"id\",\"createdAt UTC\",\"source\""));
    const lines = file.content.slice(1).split("\r\n");
    assert.equal(lines.length, 1 + 3);
    assert.ok(lines[3]!.includes(`"'=HYPERLINK(""http://x.test"",""tıkla"")"`), lines[3]);
    assert.ok(lines[2]!.includes(`"'@komut"`) && lines[2]!.includes(`"{""note"":""-2+3""}"`), lines[2]);
    assert.ok(lines[1]!.includes(`"'\tsekme ile"`), lines[1]);
    assert.ok(!file.content.includes("$argon2id$gizli"));
  });

  test(`sınır: ${AUDIT_EXPORT_MAX_ROWS} kaydı aşan aralık 400 too_many_rows; step-up tüketilmez, kayıt yazılmaz`, async () => {
    const bulk = randomUUID();
    const at = new Date("2002-01-01T00:00:00.000Z");
    await db.auditLog.createMany({
      data: Array.from({ length: AUDIT_EXPORT_MAX_ROWS + 1 }, () => ({ source: "CLI" as const, action: "user.status.sync", operation: "sync", targetType: "USER", targetId: bulk, createdAt: at })),
    });
    await stepup(root);
    const before = (await exportsBy(root.id)).length;
    const big = { format: "csv", from: "2001-12-31T00:00:00.000Z", to: "2002-01-02T00:00:00.000Z", targetId: bulk, reason: "Büyük aralık" };
    assertError(await send("POST", "/admin/audit/export", big, root.cookie), 400, "VALIDATION_ERROR", "too_many_rows");
    assert.equal((await exportsBy(root.id)).length, before);
    // Aynı step-up hâlâ geçerli: daraltılmış istek yeniden doğrulama olmadan geçer.
    assert.equal(exportFile(await send("POST", "/admin/audit/export", body(), root.cookie)).count, 3);
    assert.equal((await exportsBy(root.id)).length, before + 1);
  });
});

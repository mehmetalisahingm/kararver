/**
 * V1 #67 yayın puanı. Gerçek PostgreSQL gerekir: satır kilidi, koşullu bakiye düşümü,
 * idempotency ve append-only trigger bellek içinde yeterince güvenilir taklit edilemez.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody, PointsSummary } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

describe("yayın puanı (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let categoryId: string;
  let titleSeq = 0;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
    h.pollSettings.publishCostPoints = 10;
    categoryId = (await db.category.create({ data: { slug: `puan-${randomUUID().slice(0, 8)}`, name: "Puan Testi" } })).id;
  });

  after(async () => {
    await h?.close();
  });

  function send(method: "POST" | "GET", url: string, body?: unknown, cookie?: string, key?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function pollBody() {
    return {
      kind: "POLL",
      title: `Puan harcaması yapılan gerçek anket ${++titleSeq}`,
      categoryId,
      durationHours: 72,
      resultsVisibility: "ALWAYS",
      options: [{ label: "Evet" }, { label: "Hayır" }],
    };
  }

  async function registerVerified() {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `puan_${id}@example.test`, username: `puan_${id}`, displayName: "Puan", password: "guclu-bir-sifre-1" };
    const mailIndex = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailIndex]) })).statusCode, 200);
    return account;
  }

  async function login(account: { email: string; password: string }) {
    const response = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(response.statusCode, 200, response.body);
    return { cookie: sessionCookie(response.headers["set-cookie"]), id: response.json().data.id as string };
  }

  async function summary(cookie: string) {
    const response = await send("GET", "/me/points", undefined, cookie);
    assert.equal(response.statusCode, 200, response.body);
    return PointsSummary.parse(response.json().data);
  }

  test("ilk başarılı login +20 verir; tekrar ve paralel login grant'i çoğaltmaz", async () => {
    const account = await registerVerified();
    const [a, b] = await Promise.all([login(account), login(account)]);
    assert.equal(a.id, b.id);
    assert.deepEqual(await summary(a.cookie), { balance: 20, publishCost: 10 });

    const third = await login(account);
    assert.deepEqual(await summary(third.cookie), { balance: 20, publishCost: 10 });
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: a.id, reason: "INITIAL_GRANT" } }), 1);
  });

  test("iki başarılı yayın bakiyeyi 0 yapar; retry çift harcamaz; üçüncü yayın atomik reddedilir", async () => {
    const account = await registerVerified();
    const owner = await login(account);

    const firstKey = `points-${randomUUID()}`;
    const firstBody = pollBody();
    const first = await send("POST", "/polls", firstBody, owner.cookie, firstKey);
    assert.equal(first.statusCode, 201, first.body);
    assert.deepEqual(await summary(owner.cookie), { balance: 10, publishCost: 10 });

    const retry = await send("POST", "/polls", firstBody, owner.cookie, firstKey);
    assert.equal(retry.statusCode, 201, retry.body);
    assert.equal(retry.json().data.id, first.json().data.id);
    assert.deepEqual(await summary(owner.cookie), { balance: 10, publishCost: 10 });

    const second = await send("POST", "/polls", pollBody(), owner.cookie, `points-${randomUUID()}`);
    assert.equal(second.statusCode, 201, second.body);
    assert.deepEqual(await summary(owner.cookie), { balance: 0, publishCost: 10 });

    const beforeCount = await db.poll.count({ where: { authorId: owner.id } });
    const third = await send("POST", "/polls", pollBody(), owner.cookie, `points-${randomUUID()}`);
    assert.equal(third.statusCode, 409, third.body);
    ErrorBody.parse(third.json());
    assert.equal(third.json().error.code, "INSUFFICIENT_POINTS");
    assert.equal(await db.poll.count({ where: { authorId: owner.id } }), beforeCount, "reddedilen yayın DB'de kalmamalı");
    assert.deepEqual(await summary(owner.cookie), { balance: 0, publishCost: 10 });
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: owner.id, reason: "PUBLISH" } }), 2);
  });

  test("tartışma yayını da 10 puan harcar; retry çift harcamaz", async () => {
    const account = await registerVerified();
    const owner = await login(account);
    const key = `discussion-${randomUUID()}`;
    const body = {
      kind: "DISCUSSION",
      title: `Puan harcaması yapılan tartışma ${++titleSeq}`,
      description: "Seçeneksiz tartışma da yayın maliyetine tabidir.",
      categoryId,
      allowComments: true,
    };

    const first = await send("POST", "/polls", body, owner.cookie, key);
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(first.json().data.kind, "DISCUSSION");
    assert.deepEqual(await summary(owner.cookie), { balance: 10, publishCost: 10 });

    const retry = await send("POST", "/polls", body, owner.cookie, key);
    assert.equal(retry.statusCode, 201, retry.body);
    assert.equal(retry.json().data.id, first.json().data.id);
    assert.deepEqual(await summary(owner.cookie), { balance: 10, publishCost: 10 });
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: owner.id, reason: "PUBLISH" } }), 1);
  });

  test("son 10 puanla iki paralel yayın yarışırsa yalnız biri commit olur", async () => {
    const account = await registerVerified();
    const owner = await login(account);
    const warmup = await send("POST", "/polls", pollBody(), owner.cookie, `points-${randomUUID()}`);
    assert.equal(warmup.statusCode, 201, warmup.body);
    assert.equal((await summary(owner.cookie)).balance, 10);

    const [a, b] = await Promise.all([
      send("POST", "/polls", pollBody(), owner.cookie, `points-${randomUUID()}`),
      send("POST", "/polls", pollBody(), owner.cookie, `points-${randomUUID()}`),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409], `${a.body}\n${b.body}`);
    assert.equal((await summary(owner.cookie)).balance, 0);
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: owner.id, reason: "PUBLISH" } }), 2);
    assert.equal(await db.poll.count({ where: { authorId: owner.id } }), 2);
  });

  test("UNDER_REVIEW moderatör reddi gerçek yayın ücretini tek sefer iade eder; tekrar ve yanlış kaldırma iade etmez", async () => {
    const owner = await login(await registerVerified());
    const reviewer = await login(await registerVerified());
    await db.userRole.create({ data: { userId: reviewer.id, role: "SUPER_ADMIN" } });

    const pendingBody = {
      ...pollBody(),
      title: `Siyasi partilerin ulaşım projelerini değerlendirelim ${++titleSeq}`,
    };
    const pendingKey = `points-pending-${randomUUID()}`;
    const queued = await send("POST", "/polls", pendingBody, owner.cookie, pendingKey);
    assert.equal(queued.statusCode, 202, queued.body);
    const pollId: string = queued.json().data.id;
    assert.equal(queued.json().data.status, "UNDER_REVIEW");
    assert.equal((await summary(owner.cookie)).balance, 10);
    const publish = await db.pointLedgerEntry.findFirstOrThrow({
      where: { referenceId: pollId, userId: owner.id, reason: "PUBLISH" },
    });
    assert.equal(publish.delta, -10);

    const retries = await send("POST", "/polls", pendingBody, owner.cookie, pendingKey);
    assert.equal(retries.statusCode, 202, retries.body);
    assert.equal(retries.json().data.id, pollId);
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: owner.id, referenceId: pollId, reason: "PUBLISH" } }), 1);

    const denied = await send("POST", `/admin/polls/${pollId}/moderation`,
      { action: "REMOVE", reason: "İnceleme sonucunda uygunsuz içerik tespit edildi." }, owner.cookie);
    assert.equal(denied.statusCode, 403, denied.body);
    assert.equal((await summary(owner.cookie)).balance, 10);

    const rejection = await send("POST", `/admin/polls/${pollId}/moderation`,
      { action: "REMOVE", reason: "İnceleme sonucunda uygunsuz içerik tespit edildi." }, reviewer.cookie);
    assert.equal(rejection.statusCode, 200, rejection.body);
    assert.equal(rejection.json().data.status, "REMOVED");
    assert.equal((await summary(owner.cookie)).balance, 20, "reddedilen içerik için tek yayın ücreti iade edilir");

    const refund = await db.pointLedgerEntry.findFirstOrThrow({
      where: { userId: owner.id, referenceId: pollId, reason: "MODERATION_REFUND" },
    });
    assert.equal(refund.delta, 10);
    assert.equal(refund.balanceAfter, 20);
    assert.equal(refund.idempotencyKey, `moderation-refund:${pollId}`);
    const history = await send("GET", "/me/points/ledger?limit=10", undefined, owner.cookie);
    assert.equal(history.statusCode, 200, history.body);
    assert.ok(history.json().data.some((e: { referenceId: string; reason: string; delta: number }) =>
      e.referenceId === pollId && e.reason === "MODERATION_REFUND" && e.delta === 10));

    assert.equal(await db.pointLedgerEntry.count({ where: { userId: owner.id, referenceId: pollId, reason: "MODERATION_REFUND" } }), 1);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: pollId } })).status, "REMOVED");

    const duplicate = await send("POST", `/admin/polls/${pollId}/moderation`,
      { action: "REMOVE", reason: "Yinelenen reddetme talebi" }, reviewer.cookie);
    assert.equal(duplicate.statusCode, 200, duplicate.body);
    assert.equal((await summary(owner.cookie)).balance, 20);
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: owner.id, referenceId: pollId, reason: "MODERATION_REFUND" } }), 1);

    // A plain ADMIN RESTORE is NOT an accepted appeal. The reversal must
    // refer to the specific, still-latest human rejection via preview/digest.
    const restore = await send("POST", `/admin/polls/${pollId}/moderation`,
      { action: "RESTORE", reason: "Karara itiraz" }, reviewer.cookie);
    assert.equal(restore.statusCode, 409, restore.body);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: pollId } })).status, "REMOVED");
    assert.equal((await summary(owner.cookie)).balance, 20);

    const rejectedAction = await db.moderationAction.findFirstOrThrow({
      where: { pollId, action: "REMOVE", fromStatus: "UNDER_REVIEW", toStatus: "REMOVED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    // No in-app delivery proof or user filing: even the real ADMIN must not
    // freely reinstate the rejection with a forged appeal claim.
    const noDeliveryRead = await send("GET", `/me/moderation-appeals/${rejectedAction.id}`,
      undefined, owner.cookie);
    assert.equal(noDeliveryRead.statusCode, 404, noDeliveryRead.body);
    const inboxDeliveredAt = h.clock.now;
    const appealWindow = await db.moderationAppealWindow.create({
      data: {
        rejectionActionId: rejectedAction.id, recipientId: owner.id,
        notificationId: randomUUID(), deliveredAt: inboxDeliveredAt,
        deadlineAt: new Date(inboxDeliveredAt.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const otherViewer = await login(await registerVerified());
    const forbiddenRead = await send("GET", `/me/moderation-appeals/${rejectedAction.id}`, undefined, otherViewer.cookie);
    assert.equal(forbiddenRead.statusCode, 404, forbiddenRead.body);
    const beforeFiling = await send("GET", `/me/moderation-appeals/${rejectedAction.id}`, undefined, owner.cookie);
    assert.equal(beforeFiling.statusCode, 200, beforeFiling.body);
    assert.equal(beforeFiling.json().data.status, "OPEN");
    assert.equal(beforeFiling.json().data.deadlineAt, appealWindow.deadlineAt.toISOString());

    const submittedAppeal = await send("POST", `/me/moderation-appeals/${rejectedAction.id}`,
      { reason: "Yanlış ret kararı verildi; genel ulaşım hizmeti değerlendirmesi yapıyorum." }, owner.cookie);
    assert.equal(submittedAppeal.statusCode, 200, submittedAppeal.body);
    assert.equal(submittedAppeal.json().data.status, "FILED");
    assert.equal(submittedAppeal.json().data.filedAt, inboxDeliveredAt.toISOString());
    const duplicateFiling = await send("POST", `/me/moderation-appeals/${rejectedAction.id}`,
      { reason: "Tekrarlanan ve asıl gerekçeyi değiştirmemesi gereken başvuru." }, owner.cookie);
    assert.equal(duplicateFiling.statusCode, 200, duplicateFiling.body);
    assert.equal(duplicateFiling.json().data.filedAt, inboxDeliveredAt.toISOString());
    assert.equal((await db.moderationAppealWindow.findUniqueOrThrow({
      where: { rejectionActionId: rejectedAction.id },
    })).filedReason, "Yanlış ret kararı verildi; genel ulaşım hizmeti değerlendirmesi yapıyorum.");

    const preview = await send("GET", `/admin/moderation/actions/${rejectedAction.id}/undo/preview`,
      undefined, reviewer.cookie);
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().data.outcome, "WILL_UNDO");
    const digest: string = preview.json().data.digest;
    const unauthorizedUndo = await send("POST", `/admin/moderation/actions/${rejectedAction.id}/undo`,
      { digest, reason: "Karara itiraz kabul edildi" }, owner.cookie);
    assert.equal(unauthorizedUndo.statusCode, 403, unauthorizedUndo.body);

    // The same moderator must not accidentally restore a poll for a banned
    // user, nor one edited to solicit forbidden respondent details.
    await db.user.update({ where: { id: owner.id }, data: { status: "BANNED" } });
    const bannedUndo = await send("POST", `/admin/moderation/actions/${rejectedAction.id}/undo`,
      { digest, reason: "Bu kullanıcı yasaklıyken yayımlama denemesi" }, reviewer.cookie);
    assert.equal(bannedUndo.statusCode, 409, bannedUndo.body);
    await db.user.update({ where: { id: owner.id }, data: { status: "ACTIVE" } });

    await db.poll.update({ where: { id: pollId }, data: { title: "Hangi partiye oy verdin?" } });
    const sensitiveUndo = await send("POST", `/admin/moderation/actions/${rejectedAction.id}/undo`,
      { digest, reason: "Hassas veriyi açıkça soran anketi açma denemesi" }, reviewer.cookie);
    assert.equal(sensitiveUndo.statusCode, 409, sensitiveUndo.body);
    await db.poll.update({ where: { id: pollId }, data: { title: pendingBody.title } });
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: pollId } })).status, "REMOVED");
    assert.equal((await summary(owner.cookie)).balance, 20);

    const beforeRestore = await db.poll.findUniqueOrThrow({
      where: { id: pollId }, select: { opensAt: true, closesAt: true },
    });
    h.clock.advance(75 * 60 * 60 * 1000);
    const appealAccepted = await send("POST", `/admin/moderation/actions/${rejectedAction.id}/undo`,
      { digest, reason: "Yanlış ön moderasyon reddi: itiraz kabul edildi." }, reviewer.cookie);
    assert.equal(appealAccepted.statusCode, 200, appealAccepted.body);
    assert.equal(appealAccepted.json().data.outcome.status, "ACTIVE");
    const reopened = await db.poll.findUniqueOrThrow({ where: { id: pollId } });
    assert.equal(reopened.status, "ACTIVE");
    assert.equal(reopened.opensAt.getTime(), h.clock.now.getTime());
    assert.equal(reopened.closesAt!.getTime() - reopened.opensAt.getTime(),
      beforeRestore.closesAt!.getTime() - beforeRestore.opensAt.getTime(),
      "itirazla ücretsiz yayımlanan ankete tam oylama süresi verilir");
    assert.equal((await send("GET", `/polls/${pollId}`)).statusCode, 200);
    assert.equal((await summary(owner.cookie)).balance, 20,
      "yanlış ret iadesi kullanıcıda kalır, yeniden 10 puan kesilmez");

    const appealAction = await db.moderationAction.findFirstOrThrow({
      where: { pollId, action: "RESTORE", undoOfId: rejectedAction.id },
      select: { fromStatus: true, toStatus: true, undoOfId: true },
    });
    assert.deepEqual(appealAction, { fromStatus: "REMOVED", toStatus: "ACTIVE", undoOfId: rejectedAction.id });
    const duplicateAppeal = await send("POST", `/admin/moderation/actions/${rejectedAction.id}/undo`,
      { digest, reason: "Tekrarlanan itiraz kabulü" }, reviewer.cookie);
    assert.equal(duplicateAppeal.statusCode, 409, duplicateAppeal.body);
    assert.equal(await db.moderationAction.count({ where: { pollId, action: "RESTORE", undoOfId: rejectedAction.id } }), 1);
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: owner.id, referenceId: pollId, reason: "PUBLISH" } }), 1);
    assert.equal(await db.pointLedgerEntry.count({ where: { userId: owner.id, referenceId: pollId, reason: "MODERATION_REFUND" } }), 1);
    assert.equal((await summary(owner.cookie)).balance, 20);
    h.clock.advance(-75 * 60 * 60 * 1000);

    const normal = await send("POST", "/polls", pollBody(), owner.cookie, `normal-${randomUUID()}`);
    assert.equal(normal.statusCode, 201, normal.body);
    assert.equal((await summary(owner.cookie)).balance, 10);
    const normalId: string = normal.json().data.id;
    const takedown = await send("POST", `/admin/polls/${normalId}/moderation`,
      { action: "REMOVE", reason: "Yayımlandıktan sonra kaldırma" }, reviewer.cookie);
    assert.equal(takedown.statusCode, 200, takedown.body);
    assert.equal((await summary(owner.cookie)).balance, 10, "yayın sonrası kaldırmada iade yok");
    assert.equal(await db.pointLedgerEntry.count({ where: { referenceId: normalId, reason: "MODERATION_REFUND" } }), 0);
  });

  test("ledger sayfalı okunur ve DB'de UPDATE/DELETE edilemez", async () => {
    const account = await registerVerified();
    const owner = await login(account);
    assert.equal((await send("POST", "/polls", pollBody(), owner.cookie, `points-${randomUUID()}`)).statusCode, 201);

    const page1 = await send("GET", "/me/points/ledger?limit=1", undefined, owner.cookie);
    assert.equal(page1.statusCode, 200, page1.body);
    assert.equal(page1.json().data.length, 1);
    assert.equal(page1.json().page.hasMore, true);
    assert.ok(page1.json().page.nextCursor);
    const page2 = await send("GET", `/me/points/ledger?limit=1&cursor=${encodeURIComponent(page1.json().page.nextCursor)}`, undefined, owner.cookie);
    assert.equal(page2.statusCode, 200, page2.body);
    assert.equal(page2.json().data.length, 1);
    assert.notEqual(page2.json().data[0].id, page1.json().data[0].id);

    await assert.rejects(
      db.$executeRaw`UPDATE point_ledger_entries SET delta = 1 WHERE user_id = ${owner.id}::uuid`,
      /KV_POINT_LEDGER_APPEND_ONLY/,
    );
    await assert.rejects(
      db.$executeRaw`DELETE FROM point_ledger_entries WHERE user_id = ${owner.id}::uuid`,
      /KV_POINT_LEDGER_APPEND_ONLY/,
    );
  });
});

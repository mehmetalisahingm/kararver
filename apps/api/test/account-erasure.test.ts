/**
 * #181 hesap anonimleştirme ve yasal saklama (KV-33 §10): yetki, yazılı teyit, engeller, kişisel veri temizliği,
 * korunan içerik, idempotency, eşzamanlılık (yaptırım, sahip atama, çift tıklama) ve audit'te kişisel veri olmaması.
 * Gerçek PostgreSQL gerektirir (TEST_DATABASE_URL veya .env).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { AccountErasurePreview, AccountErasureResult, ErrorBody } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { tombstoneOf } from "../src/modules/account-erasure/store.ts";
import { decodeBase32, hotp } from "../src/modules/security/totp.ts";
import { snapshotDay } from "../../worker/src/jobs/snapshots/job.ts";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

type User = { cookie: string; id: string; username: string; email: string; password: string };
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json(): any };
const REASON = "KVKK silme talebi; kimlik destek kanalında doğrulandı";
const HOLD_REASON = "Devam eden hukuki süreç nedeniyle saklama";

describe("hesap anonimleştirme (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;
  let boss: User;
  let admin: User;
  let categoryId: string;
  let bossSecret: string;
  let gateQueue: Promise<void> = Promise.resolve();
  /** Bu dosyanın açtığı topluluklar ve veri paketi talepleri: paylaşılan test DB'sinde diğer dosyaların listelerini ve worker sırasını bozmasın. */
  const communityIds: string[] = [];
  const exportIds: string[] = [];

  before(async () => {
    h = await createHarness(backend!, { realSettings: true });
    db = h.prisma!;
    categoryId = (await db.category.create({ data: { slug: `erase-${randomUUID().slice(0, 8)}`, name: "Silme testi" } })).id;
    boss = await signUp();
    await db.userRole.create({ data: { userId: boss.id, role: "SUPER_ADMIN" } });
    admin = await signUp();
    await db.userRole.create({ data: { userId: admin.id, role: "ADMIN", grantedById: boss.id } });
    const setup = await send("POST","/me/mfa/setup",{ password: boss.password },boss.cookie);
    assert.equal(setup.statusCode,200,setup.body);
    bossSecret=setup.json().data.secret;
    const confirm=await send("POST","/me/mfa/confirm",{code:hotp(decodeBase32(bossSecret),Math.floor(h.clock.now.getTime()/30000))},boss.cookie);
    assert.equal(confirm.statusCode,200,confirm.body);
  });
  after(async () => {
    if (db) {
      await db.dataExport.updateMany({ where: { id: { in: exportIds }, status: { in: ["PENDING", "PROCESSING"] } }, data: { status: "FAILED", failure: "test_cleanup" } });
      await db.community.updateMany({ where: { id: { in: communityIds } }, data: { ownerId: null } });
      await db.communityMembership.deleteMany({ where: { communityId: { in: communityIds } } });
      await db.communityRequest.deleteMany({ where: { requester: { username: { startsWith: "er_" } } } });
      await db.community.deleteMany({ where: { id: { in: communityIds } } });
    }
    await h?.close();
  });

  // ─── Yardımcılar ────────────────────────────────────────────

  function send(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, cookie?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as Promise<Res>;
  }

  function assertError(res: Res, status: number, code: string, detail?: string) {
    assert.equal(res.statusCode, status, res.body);
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, code);
    if (detail) assert.equal(res.json().error.details[0]?.code, detail, res.body);
  }

  async function signUp(): Promise<User> {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = { email: `er_${id}@example.test`, username: `er_${id}`, displayName: `Ad ${id}`, password: "guclu-bir-sifre-1" };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"] as string), id: login.json().data.id, username: account.username, email: account.email, password: account.password };
  }

  const preview = (userId: string, cookie = boss.cookie) => send("GET", `/admin/users/${userId}/erasure`, undefined, cookie);
  const erase = async (user: { id: string; username: string }, cookie = boss.cookie, over: Record<string, unknown> = {}) => {
    if (cookie===boss.cookie) {
      gateQueue=gateQueue.then(async()=>{
        if ((await db.user.findUnique({where:{id:user.id},select:{deletedAt:true}}))?.deletedAt) return;
        const status=await send("GET","/me/mfa",undefined,boss.cookie);
        if (!status.json().data.stepUpExpiresAt) {
          h.clock.advance(30000);
          const gate=await send("POST","/me/mfa/step-up",{code:hotp(decodeBase32(bossSecret),Math.floor(h.clock.now.getTime()/30000))},boss.cookie);
          assert.equal(gate.statusCode,200,gate.body);
        }
      });
      await gateQueue;
    }
    return send("POST", `/admin/users/${user.id}/erasure`, { reason: REASON, confirmUsername: user.username, ...over }, cookie);
  };
  const putHold = (userId: string, cookie = boss.cookie, reason: unknown = HOLD_REASON) => send("PUT", `/admin/users/${userId}/legal-hold`, { reason }, cookie);
  const releaseHold = (userId: string, cookie = boss.cookie) => send("POST", `/admin/users/${userId}/legal-hold/release`, { reason: "Hukuki süreç sona erdi" }, cookie);
  const audits = (userId: string, action: string, operation?: string) =>
    db.auditLog.findMany({ where: { action, targetType: "USER", targetId: userId, ...(operation ? { operation } : {}) }, orderBy: { createdAt: "asc" } });
  const userRow = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
  const slug = () => `er${randomUUID().replaceAll("-", "").slice(0, 8)}`;

  async function setFlag(on: boolean) {
    const current = (await h.settings!.list()).find((e) => e.key === "communities.ownershipEnabled")!;
    if (current.value === on) return;
    const outcome = await h.settings!.update({ key: "communities.ownershipEnabled", value: on, version: current.version, reason: "Silme testi için bayrak", actorId: boss.id, requestId: randomUUID() });
    assert.equal(outcome.kind, "updated", JSON.stringify(outcome));
    h.settings!.invalidate();
  }

  async function track<T extends { id: string }>(created: Promise<T>): Promise<T> {
    const row = await created;
    communityIds.push(row.id);
    return row;
  }

  async function poll(authorId: string, title = "Silme testi anketi") {
    return db.poll.create({
      data: {
        authorId,
        categoryId,
        publicId: randomUUID().replaceAll("-", "").slice(0, 12),
        slug: "silme-testi",
        title,
        closesAt: new Date("2031-01-01T00:00:00Z"),
        options: { create: [{ position: 0, label: "Evet" }, { position: 1, label: "Hayır" }] },
      },
      select: { id: true, options: { orderBy: { position: "asc" }, select: { id: true } } },
    });
  }

  /** Kişisel verisi ve bağlantısı olan bir hesap: her silme/koruma kuralı için bir kayıt. */
  async function rich() {
    const user = await signUp();
    const other = await signUp();
    await db.user.update({ where: { id: user.id }, data: { bio: "KISISEL-BIYOGRAFI", lastLoginAt: new Date() } });
    const own = await poll(user.id, "Kullanıcının anketi");
    const othersPoll = await poll(other.id, "Başkasının anketi");
    const comment = await db.comment.create({ data: { pollId: own.id, authorId: user.id, body: "Kullanıcının yorumu" } });
    await db.comment.create({ data: { pollId: own.id, authorId: other.id, body: "BASKASININ-YORUMU" } });
    const vote=await db.vote.create({ data: { pollId: othersPoll.id, optionId: othersPoll.options[0]!.id, userId: user.id } });
    await db.voteEvent.create({data:{voteId:vote.id,pollId:othersPoll.id,userId:user.id,type:"CAST",toOptionId:vote.optionId,occurredAt:vote.createdAt}});
    await db.poll.update({where:{id:own.id},data:{commentCount:2}});
    await db.poll.update({where:{id:othersPoll.id},data:{voteCount:1}});
    await db.pollOption.update({where:{id:vote.optionId},data:{voteCount:1}});
    await db.report.create({ data: { reporterId: user.id, pollId: othersPoll.id, reason: "OTHER", details: "kendi raporum" } });
    // Kayıt listesi (sayaçla), takip, sessize alma, ilgi alanı, bildirim tercihi, bildirim, idempotency anahtarı.
    await db.bookmark.create({ data: { userId: user.id, pollId: othersPoll.id } });
    await db.poll.update({ where: { id: othersPoll.id }, data: { saveCount: { increment: 1 } } });
    await db.pollFollow.create({ data: { userId: user.id, pollId: othersPoll.id } });
    await db.notificationPollMute.create({ data: { userId: user.id, pollId: othersPoll.id } });
    await db.userInterest.create({ data: { userId: user.id, categoryId } });
    await db.notificationTypeOptOut.create({ data: { userId: user.id, type: "POLL_TRENDING" } });
    await db.notification.create({
      data: { recipientId: user.id, type: "POLL_CLOSED", eventId: randomUUID(), subjectType: "POLL", subjectId: own.id, pollId: own.id, dedupeKey: `d-${randomUUID()}` },
    });
    await db.idempotencyKey.create({
      data: { userId: user.id, route: "test", key: randomUUID(), requestHash: "a".repeat(64), responseStatus: 201, resourceId: own.id, expiresAt: new Date("2031-01-01T00:00:00Z") },
    });
    // Topluluk: üye olduğu biri (sayaçla) ve sahibi olduğu biri.
    const member = await track(db.community.create({ data: { slug: slug(), name: "Üye olduğu", createdById: admin.id, memberCount: 2 } }));
    await db.communityMembership.createMany({ data: [{ communityId: member.id, userId: user.id }, { communityId: member.id, userId: other.id }] });
    const owned = await track(db.community.create({ data: { slug: slug(), name: "Sahibi olduğu", createdById: admin.id, memberCount: 1 } }));
    await db.communityMembership.create({ data: { communityId: owned.id, userId: user.id } });
    await db.community.update({ where: { id: owned.id }, data: { ownerId: user.id } });
    const request = await db.communityRequest.create({ data: { requesterId: user.id, name: "Bekleyen başvuru", slug: slug() } });
    // Avatar + hazır veri paketi.
    const avatar = await db.mediaAsset.create({
      data: { uploaderId: user.id, purpose: "AVATAR", status: "APPROVED", originalObjectKey: `orig/${randomUUID()}`, processedObjectKey: `proc/${randomUUID()}`, publicObjectKey: `m/${randomUUID()}.webp` },
    });
    await db.user.update({ where: { id: user.id }, data: { avatarMediaId: avatar.id } });
    const exportRow = await db.dataExport.create({
      data: {
        userId: user.id,
        requestedById: boss.id,
        status: "READY",
        objectKey: `exports/${randomUUID()}`,
        sizeBytes: 1024,
        encKey: Buffer.alloc(32, 1),
        tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        tokenExpiresAt: new Date("2031-01-01T00:00:00Z"),
        expiresAt: new Date("2031-01-01T00:00:00Z"),
        readyAt: new Date(),
      },
    });
    return { user, other, own, othersPoll, comment, member, owned, request, avatar, exportRow };
  }

  // ─── Yetki ve doğrulama ─────────────────────────────────────

  test("yetki: misafir 401; kullanıcı ve ADMIN 403 (yalnız SUPER_ADMIN); olmayan kullanıcı 404; dört endpoint de aynı", async () => {
    const user = await signUp();
    const calls: Array<(cookie: string) => Promise<Res>> = [
      (c) => preview(user.id, c),
      (c) => erase(user, c),
      (c) => putHold(user.id, c),
      (c) => releaseHold(user.id, c),
    ];
    for (const call of calls) {
      assertError(await call(""), 401, "UNAUTHENTICATED");
      assertError(await call(user.cookie), 403, "FORBIDDEN");
      assertError(await call(admin.cookie), 403, "FORBIDDEN");
    }
    const ghost = { id: randomUUID(), username: "yok" };
    assertError(await preview(ghost.id), 404, "NOT_FOUND");
    assertError(await erase(ghost), 404, "NOT_FOUND");
    assertError(await putHold(ghost.id), 404, "NOT_FOUND");
    assertError(await releaseHold(ghost.id), 404, "NOT_FOUND");
    const row = await userRow(user.id);
    assert.equal(row.deletedAt, null);
    assert.equal(row.email, user.email);
    assert.equal(await db.accountErasure.count({ where: { userId: user.id } }), 0);
    assert.equal(await db.userLegalHold.count({ where: { userId: user.id } }), 0);
  });

  test("kendi hesabını anonimleştiremez (403); rolü olan hesap önce rolü bırakmalı (409 has_role)", async () => {
    assertError(await erase(boss), 403, "FORBIDDEN");
    assertError(await preview(boss.id), 403, "FORBIDDEN");
    assert.equal((await userRow(boss.id)).deletedAt, null);
    assertError(await erase(admin), 409, "CONFLICT", "has_role");
    assert.equal((await userRow(admin.id)).deletedAt, null);
    const pv = AccountErasurePreview.parse((await preview(admin.id)).json().data);
    assert.deepEqual(pv.blockers, ["has_role"]);
    assert.equal(pv.canAnonymize, false);
  });

  test("gövde doğrulaması: gerekçe ve teyit zorunlu, kısa gerekçe ve fazladan alan 400; iz bırakmaz", async () => {
    const user = await signUp();
    for (const body of [{}, { reason: REASON }, { confirmUsername: user.username }, { reason: "ab", confirmUsername: user.username }, { reason: REASON, confirmUsername: user.username, force: true }]) {
      assertError(await send("POST", `/admin/users/${user.id}/erasure`, body, boss.cookie), 400, "VALIDATION_ERROR");
    }
    assertError(await putHold(user.id, boss.cookie, "ab"), 400, "VALIDATION_ERROR");
    assert.equal((await userRow(user.id)).deletedAt, null);
    assert.equal((await audits(user.id, "user.anonymize")).length, 0);
  });

  test("yazılı teyit eşleşmezse 409 confirmation_mismatch ve hiçbir şey değişmez; büyük/küçük harf ve baştaki @ önemsiz", async () => {
    const { user } = await rich();
    assertError(await erase(user, boss.cookie, { confirmUsername: "baska_biri" }), 409, "CONFLICT", "confirmation_mismatch");
    assertError(await erase(user, boss.cookie, { confirmUsername: user.email }), 409, "CONFLICT", "confirmation_mismatch");
    const unchanged = await userRow(user.id);
    assert.equal(unchanged.deletedAt, null);
    assert.equal(unchanged.email, user.email);
    assert.equal(await db.session.count({ where: { userId: user.id } }) > 0, true);
    assert.equal(await db.accountErasure.count({ where: { userId: user.id } }), 0);
    const ok = await erase(user, boss.cookie, { confirmUsername: `  @${user.username.toUpperCase()} ` });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(AccountErasureResult.parse(ok.json().data).status, "anonymized");
  });

  // ─── Önizleme ───────────────────────────────────────────────

  test("erasure needs fresh MFA from the executing session and consumes it once", async () => {
    const user=await signUp();
    await db.sessionMfaStepup.updateMany({where:{session:{userId:boss.id}},data:{consumedAt:h.clock.now}});
    const body={reason:REASON,confirmUsername:user.username};
    assertError(await send("POST",`/admin/users/${user.id}/erasure`,body,boss.cookie),409,"CONFLICT","mfa_required");
    assert.equal((await userRow(user.id)).deletedAt,null);
    const result=await erase(user);assert.equal(result.statusCode,200,result.body);
    const another=await signUp();
    assertError(await send("POST",`/admin/users/${another.id}/erasure`,{reason:REASON,confirmUsername:another.username},boss.cookie),409,"CONFLICT","mfa_required");
    assert.equal((await userRow(another.id)).deletedAt,null);
  });

  test("önizleme salt okunur: sayılar doğru, hiçbir şey yazmaz; anonimleştirmeden sonra sıfırlanır", async () => {
    const { user } = await rich();
    const auditCount = await db.auditLog.count();
    const res = await preview(user.id);
    assert.equal(res.statusCode, 200, res.body);
    const pv = AccountErasurePreview.parse(res.json().data);
    assert.equal(pv.username, user.username);
    assert.equal(pv.canAnonymize, true);
    assert.deepEqual(pv.blockers, []);
    assert.equal(pv.anonymized, false);
    assert.deepEqual(pv.willRemove, { polls: 1, comments: 1, media: 1, sessions: 1, dataExports: 1, avatar: 1, communityMemberships: 2, ownedCommunities: 1, pendingCommunityRequests: 1, preferences: 6 });
    assert.deepEqual(pv.willRetain, { polls: 0, comments: 0, votes: 1, reportsFiled: 1 });
    assert.equal(await db.auditLog.count(), auditCount, "önizleme audit yazmaz");
    assert.equal((await userRow(user.id)).deletedAt, null);

    assert.equal((await erase(user)).statusCode, 200);
    const after = AccountErasurePreview.parse((await preview(user.id)).json().data);
    assert.equal(after.anonymized, true);
    assert.equal(after.canAnonymize, false);
    assert.notEqual(after.anonymizedAt, null);
    assert.deepEqual(after.willRemove, { polls: 0, comments: 0, media: 0, sessions: 0, dataExports: 0, avatar: 0, communityMemberships: 0, ownedCommunities: 0, pendingCommunityRequests: 0, preferences: 0 });
    assert.equal(after.username, tombstoneOf(user.id).username);
    assert.deepEqual(after.willRetain, { polls: 0, comments: 0, votes: 0, reportsFiled: 1 });
  });

  // ─── Anonimleştirme ─────────────────────────────────────────

  test("kişisel alanlar tombstone olur; eski e-posta, ad ve biyografi hiçbir kullanıcı satırında kalmaz; giriş ve eski oturum kapanır", async () => {
    const { user } = await rich();
    const res = await erase(user);
    assert.equal(res.statusCode, 200, res.body);
    const data = AccountErasureResult.parse(res.json().data);
    assert.equal(data.status, "anonymized");

    const row = await userRow(user.id);
    const tomb = tombstoneOf(user.id);
    assert.equal(row.email, tomb.email);
    assert.equal(row.emailNormalized, tomb.email);
    assert.equal(row.username, tomb.username);
    assert.equal(row.usernameNormalized, tomb.username);
    assert.equal(row.displayName, "Silinmiş hesap");
    assert.equal(row.bio, null);
    assert.equal(row.avatarMediaId, null);
    assert.equal(row.emailVerifiedAt, null);
    assert.equal(row.lastLoginAt, null);
    assert.equal(row.passwordHash, "!anonymized");
    assert.notEqual(row.deletedAt, null);
    assert.equal(row.deletedAt!.toISOString(), data.anonymizedAt);
    assert.equal(await db.user.count({ where: { OR: [{ email: user.email }, { emailNormalized: user.email }, { username: user.username }, { usernameNormalized: user.username }] } }), 0);

    // Eski oturum çerezi artık kimlik değil; eski bilgilerle giriş yapılamaz.
    assertError(await send("GET", "/me", undefined, user.cookie), 401, "UNAUTHENTICATED");
    assertError(await send("POST", "/auth/login", { email: user.email, password: user.password }), 401, "INVALID_CREDENTIALS");
    assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
    assert.equal(await db.authToken.count({ where: { userId: user.id } }), 0);

    // Eski e-posta ve kullanıcı adı yeniden kullanılabilir (yeni kişi, yeni hesap).
    const again = await send("POST", "/auth/register", { email: user.email, username: user.username, displayName: "Yeni kişi", password: "guclu-bir-sifre-1" });
    assert.equal(again.statusCode, 202, again.body);
    const fresh = await db.user.findUnique({ where: { emailNormalized: user.email } });
    assert.notEqual(fresh, null);
    assert.notEqual(fresh!.id, user.id);
  });

  test("şifre sıfırlama ve profil: anonimleştirilmiş hesap için bağlantı gitmez, herkese açık profil 404", async () => {
    const { user } = await rich();
    assert.equal((await erase(user)).statusCode, 200);
    const mails = h.mails.length;
    assert.equal((await send("POST", "/auth/password/forgot", { email: user.email })).statusCode, 202);
    assert.equal(h.mails.length, mails, "eski adrese bağlantı gönderilmez");
    assertError(await send("GET", `/profiles/${user.username}`), 404, "NOT_FOUND");
    assertError(await send("GET", `/profiles/${tombstoneOf(user.id).username}`), 404, "NOT_FOUND");
    assertError(await send("POST", `/admin/users/${user.id}/data-exports`, { reason: REASON }, boss.cookie), 409, "CONFLICT", "user_deleted");
  });

  test("authored content is scrubbed and cannot be restored; anonymous voting totals and snapshots stay equal", async () => {
    const { user, other, own, othersPoll, comment } = await rich();
    const othersVote=await db.vote.create({data:{pollId:own.id,optionId:own.options[0]!.id,userId:other.id}});
    await db.voteEvent.create({data:{voteId:othersVote.id,pollId:own.id,userId:other.id,type:"CAST",toOptionId:othersVote.optionId,occurredAt:othersVote.createdAt}});
    await db.poll.update({where:{id:own.id},data:{voteCount:1}});
    await db.pollOption.update({where:{id:othersVote.optionId},data:{voteCount:1}});
    const votes = await db.vote.count({ where: { userId: user.id } });
    const originalVote=await db.vote.findFirstOrThrow({where:{userId:user.id}});
    await db.pollRevision.create({data:{id:randomUUID(),pollId:own.id,version:1,editorId:user.id,editedAt:new Date(),snapshot:{title:"PERSONAL-TEXT"}}});
    await db.commentRevision.create({data:{id:randomUUID(),commentId:comment.id,version:1,editorId:user.id,editedAt:new Date(),snapshot:{body:"PERSONAL-TEXT"}}});
    const localDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Istanbul",year:"numeric",month:"2-digit",day:"2-digit"}).format(originalVote.createdAt);
    const snapshotDeps={prisma:db,now:()=>new Date(originalVote.createdAt.getTime()+48*3600000),log:()=>{}};
    await snapshotDay(snapshotDeps,localDate,[othersPoll.id]);
    const beforeSnapshot=await db.pollDailySnapshot.findUniqueOrThrow({where:{pollId_localDate:{pollId:othersPoll.id,localDate:new Date(localDate)}}});
    const beforeOptions=await db.pollOptionDailySnapshot.findMany({where:{pollId:othersPoll.id,localDate:new Date(localDate)},orderBy:{optionId:"asc"}});
    const gone=await erase(user); assert.equal(gone.statusCode,200,gone.body);
    assert.equal(await db.poll.count({ where: { id: own.id, authorId: user.id, status: "REMOVED" } }), 1);
    assert.equal((await db.poll.findUniqueOrThrow({where:{id:own.id}})).title,"Silinmiş içerik");
    const scrubbed=await db.comment.findUniqueOrThrow({where:{id:comment.id}});
    assert.equal(scrubbed.status,"REMOVED"); assert.equal(scrubbed.body,"[Silinmiş yorum]");
    assert.equal(await db.pollRevision.count({where:{pollId:own.id}}),0);
    assert.equal(await db.commentRevision.count({where:{commentId:comment.id}}),0);
    assert.equal(await db.vote.count({ where: { userId: user.id } }), 0);
    assert.equal(await db.voteEvent.count({where:{userId:user.id}}),0);
    assert.equal(await db.vote.count({where:{id:othersVote.id,userId:other.id}}),1);
    const aggregate=await db.anonymousVoteGroup.findMany({where:{pollId:othersPoll.id}});
    assert.equal(aggregate.reduce((n,g)=>n+g.multiplicity,0),votes);
    assert.equal(JSON.stringify(aggregate).includes(user.id),false);
    assert.equal(JSON.stringify(aggregate).includes(originalVote.id),false);
    await snapshotDay(snapshotDeps,localDate,[othersPoll.id]);
    const afterSnapshot=await db.pollDailySnapshot.findUniqueOrThrow({where:{pollId_localDate:{pollId:othersPoll.id,localDate:new Date(localDate)}}});
    assert.equal(afterSnapshot.totalValidVotes,beforeSnapshot.totalValidVotes);
    assert.deepEqual(await db.pollOptionDailySnapshot.findMany({where:{pollId:othersPoll.id,localDate:new Date(localDate)},orderBy:{optionId:"asc"}}),beforeOptions);
    assert.equal((await db.poll.findUniqueOrThrow({where:{id:othersPoll.id}})).voteCount,1);
    await assert.rejects(db.poll.update({where:{id:own.id},data:{status:"ACTIVE",deletedAt:null}}),/KV_ERASED_CONTENT/);
    assert.equal(await db.report.count({ where: { reporterId: user.id } }), 1);
    assert.equal(await db.comment.count({ where: { pollId: own.id, body: "BASKASININ-YORUMU" } }), 1);
    assert.equal((await userRow(other.id)).email, other.email);
    const shown = await send("GET", `/polls/${own.id}`);
    assert.equal(shown.statusCode, 404, shown.body);
    assert.equal(JSON.stringify(shown.json()).includes(user.username), false, "eski kullanıcı adı yanıtta yok");
    void othersPoll;
  });

  test("topluluk: üyelikler çıkar ve sayaçlar düşer, sahiplik yönetici yönetimine döner (audit auto_release/anonymize), bekleyen başvuru reddedilir", async () => {
    const { user, other, member, owned, request } = await rich();
    assert.equal((await erase(user)).statusCode, 200);
    assert.equal(await db.communityMembership.count({ where: { userId: user.id } }), 0);
    assert.equal(await db.communityMembership.count({ where: { communityId: member.id, userId: other.id } }), 1, "başkasının üyeliği kalır");
    assert.equal((await db.community.findUniqueOrThrow({ where: { id: member.id } })).memberCount, 1);
    const ownedAfter = await db.community.findUniqueOrThrow({ where: { id: owned.id } });
    assert.equal(ownedAfter.ownerId, null);
    assert.equal(ownedAfter.memberCount, 0);
    const releases = await db.auditLog.findMany({ where: { action: "community.owner.assign", operation: "auto_release", targetId: owned.id } });
    assert.equal(releases.length, 1);
    assert.deepEqual(releases[0]!.after, { ownerId: null, trigger: "anonymize" });
    assert.equal(releases[0]!.actorId, boss.id);
    const req = await db.communityRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(req.status, "REJECTED");
    assert.match(req.rejectionReason ?? "", /anonimleştirildi/);
  });

  test("kayıt listesi sayaçla birlikte silinir; takip, sessize alma, ilgi alanı, bildirim tercihi, bildirim ve idempotency anahtarı gider", async () => {
    const { user, othersPoll } = await rich();
    const saveBefore = (await db.poll.findUniqueOrThrow({ where: { id: othersPoll.id } })).saveCount;
    assert.equal(saveBefore, 1);
    assert.equal((await erase(user)).statusCode, 200);
    assert.equal((await db.poll.findUniqueOrThrow({ where: { id: othersPoll.id } })).saveCount, 0);
    for (const n of [
      await db.bookmark.count({ where: { userId: user.id } }),
      await db.pollFollow.count({ where: { userId: user.id } }),
      await db.notificationPollMute.count({ where: { userId: user.id } }),
      await db.userInterest.count({ where: { userId: user.id } }),
      await db.notificationTypeOptOut.count({ where: { userId: user.id } }),
      await db.notification.count({ where: { recipientId: user.id } }),
      await db.idempotencyKey.count({ where: { userId: user.id } }),
    ]) {
      assert.equal(n, 0);
    }
  });

  test("avatar yayından kalkar (REJECTED, public anahtar boş) ve hazır veri paketi geçersiz olur (anahtar ve token silinir)", async () => {
    const { user, avatar, exportRow } = await rich();
    assert.equal((await erase(user)).statusCode, 200);
    const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: avatar.id } });
    assert.equal(asset.status, "REJECTED");
    assert.equal(asset.publicObjectKey, null);
    assert.equal(asset.reviewedById, boss.id);
    const pack = await db.dataExport.findUniqueOrThrow({ where: { id: exportRow.id } });
    assert.equal(pack.status, "EXPIRED");
    assert.equal(pack.encKey, null);
    assert.equal(pack.tokenHash, null);
    assert.equal(pack.tokenExpiresAt, null);
    assert.notEqual(pack.objectKey, null, "şifreli nesneyi worker depodan siler");
    const record = await db.accountErasure.findUniqueOrThrow({ where: { userId: user.id } });
    assert.equal(record.storageCleanedAt, null, "dosya temizliği worker'ı bekler");
    assert.equal(record.requestedById, boss.id);
  });

  test("audit: tek kayıt, gerekçe ve sayılar var; ad, e-posta ve biyografi hiçbir yerde yok; kalıcı kayıt yalnız sayı taşır", async () => {
    const { user } = await rich();
    assert.equal((await erase(user)).statusCode, 200);
    const rows = await audits(user.id, "user.anonymize", "anonymize");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.actorId, boss.id);
    assert.equal(rows[0]!.reason, REASON);
    assert.equal(rows[0]!.source, "API");
    const record = await db.accountErasure.findUniqueOrThrow({ where: { userId: user.id } });
    const text = JSON.stringify([rows[0]!.before, rows[0]!.after, record.summary]);
    for (const secret of [user.email, user.username, "KISISEL-BIYOGRAFI", "Kullanıcının"]) assert.equal(text.includes(secret), false, `${secret} audit/kayıtta olmamalı`);
    assert.equal((rows[0]!.after as any).erasureId, record.id);
    assert.equal((record.summary as any).removed.communityMemberships, 2);
    assert.equal((record.summary as any).retained.polls, 0);
    assert.equal((record.summary as any).removed.polls, 1);
  });

  // ─── Idempotency ve yarışlar ────────────────────────────────

  test("idempotent: ikinci istek 200 unchanged, aynı an; yeni audit, kayıt veya değişiklik yok (yanlış teyitle bile)", async () => {
    const { user } = await rich();
    const first = await erase(user);
    assert.equal(first.json().data.status, "anonymized");
    const second = await erase(user);
    assert.equal(second.statusCode, 200, second.body);
    assert.deepEqual(second.json().data, { status: "unchanged", anonymizedAt: first.json().data.anonymizedAt });
    assert.equal((await erase(user, boss.cookie, { confirmUsername: "baska" })).json().data.status, "unchanged");
    assert.equal((await audits(user.id, "user.anonymize")).length, 1);
    assert.equal(await db.accountErasure.count({ where: { userId: user.id } }), 1);
    // Yetkisiz çağıran bu yoldan da bilgi alamaz.
    assertError(await erase(user, admin.cookie), 403, "FORBIDDEN");
  });

  test("çift tıklama: aynı anda beş istekten biri uygular, kalanı unchanged; tek audit, tek kayıt, sayaçlar bir kez düşer", async () => {
    const { user, member } = await rich();
    const results = await Promise.all(Array.from({ length: 5 }, () => erase(user)));
    assert.deepEqual(results.map((r) => r.statusCode), [200, 200, 200, 200, 200], results.map((r) => r.body).join("|"));
    const kinds = results.map((r) => r.json().data.status as string).sort();
    assert.deepEqual(kinds, ["anonymized", "unchanged", "unchanged", "unchanged", "unchanged"]);
    assert.equal((await audits(user.id, "user.anonymize")).length, 1);
    assert.equal(await db.accountErasure.count({ where: { userId: user.id } }), 1);
    assert.equal((await db.community.findUniqueOrThrow({ where: { id: member.id } })).memberCount, 1);
  });

  // ─── Engeller ───────────────────────────────────────────────

  test("engeller: aktif BAN, SUSPEND ve kısıtlama 409 active_sanction; UYARI, kaldırılmış ve süresi dolmuş yaptırım engel değil", async () => {
    const mk = async (type: "BAN" | "SUSPEND" | "RESTRICT_COMMENTS" | "RESTRICT_POSTING" | "WARNING", extra: Record<string, unknown> = {}) => {
      const user = await signUp();
      const startsAt = new Date(h.clock.now.getTime() - 48 * 3600_000);
      const endsAt = type === "SUSPEND" ? new Date(h.clock.now.getTime() + 24 * 3600_000) : null;
      await db.sanction.create({ data: { userId: user.id, type, reason: "test: yaptırım", createdById: boss.id, startsAt, createdAt: startsAt, endsAt, ...extra } });
      return user;
    };
    for (const type of ["BAN", "SUSPEND", "RESTRICT_COMMENTS", "RESTRICT_POSTING"] as const) {
      const blocked = await mk(type);
      assertError(await erase(blocked), 409, "CONFLICT", "active_sanction");
      assert.deepEqual(AccountErasurePreview.parse((await preview(blocked.id)).json().data).blockers, ["active_sanction"]);
      assert.equal((await userRow(blocked.id)).deletedAt, null);
    }
    const warned = await mk("WARNING");
    assert.equal((await erase(warned)).statusCode, 200);
    const lifted = await mk("BAN", { liftedAt: h.clock.now, liftedById: boss.id, liftReason: "test: kaldırıldı" });
    assert.equal((await erase(lifted)).statusCode, 200);
    const expired = await mk("SUSPEND", { endsAt: new Date(h.clock.now.getTime() - 3600_000) });
    assert.equal((await erase(expired)).statusCode, 200);
  });

  test("engeller: bekleyen veya işlenen veri paketi talebi 409 export_in_progress (erişim hakkı önce); hazır/başarısız paket engel değil", async () => {
    for (const status of ["PENDING", "PROCESSING"] as const) {
      const user = await signUp();
      exportIds.push((await db.dataExport.create({ data: { userId: user.id, requestedById: boss.id, status }, select: { id: true } })).id);
      assertError(await erase(user), 409, "CONFLICT", "export_in_progress");
      assert.deepEqual(AccountErasurePreview.parse((await preview(user.id)).json().data).blockers, ["export_in_progress"]);
      assert.equal((await userRow(user.id)).deletedAt, null);
    }
    const failed = await signUp();
    await db.dataExport.create({ data: { userId: failed.id, requestedById: boss.id, status: "FAILED", failure: "too_large" } });
    assert.equal((await erase(failed)).statusCode, 200);
  });

  test("yasal saklama: koyma idempotent, açıkken anonimleştirme 409 legal_hold; bırakınca serbest; kayıtlar silinmez", async () => {
    const { user } = await rich();
    const put = await putHold(user.id);
    assert.equal(put.statusCode, 200, put.body);
    const hold = put.json().data.legalHold;
    assert.equal(hold.reason, HOLD_REASON);
    assert.equal(hold.placedById, boss.id);

    const again = await putHold(user.id, boss.cookie, "Başka bir gerekçe yazıldı");
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().data.legalHold.id, hold.id, "açık kayıt döner");
    assert.equal(again.json().data.legalHold.reason, HOLD_REASON, "gerekçe değişmez");
    assert.equal((await audits(user.id, "user.legalHold.manage", "place")).length, 1, "ikinci koyma audit yazmaz");

    assertError(await erase(user), 409, "CONFLICT", "legal_hold");
    const pv = AccountErasurePreview.parse((await preview(user.id)).json().data);
    assert.deepEqual(pv.blockers, ["legal_hold"]);
    assert.equal(pv.legalHold?.id, hold.id);
    assert.equal((await userRow(user.id)).deletedAt, null);
    assert.equal(await db.session.count({ where: { userId: user.id } }) > 0, true, "engellenen işlemde hiçbir veri silinmez");

    const released = await releaseHold(user.id);
    assert.deepEqual(released.json().data, { legalHold: null });
    assert.equal((await audits(user.id, "user.legalHold.manage", "release")).length, 1);
    assert.equal((await releaseHold(user.id)).statusCode, 200, "açık kayıt yoksa no-op");
    assert.equal((await audits(user.id, "user.legalHold.manage", "release")).length, 1, "ikinci bırakma audit yazmaz");
    const record = await db.userLegalHold.findUniqueOrThrow({ where: { id: hold.id } });
    assert.notEqual(record.releasedAt, null);
    assert.equal(record.releasedById, boss.id);

    assert.equal((await erase(user)).statusCode, 200);
    assertError(await putHold(user.id), 409, "CONFLICT", "user_deleted");
  });

  test("yasal saklama: eşzamanlı dört koyma tek açık kayıt bırakır", async () => {
    const user = await signUp();
    const results = await Promise.all(Array.from({ length: 4 }, () => putHold(user.id)));
    assert.deepEqual(results.map((r) => r.statusCode), [200, 200, 200, 200], results.map((r) => r.body).join("|"));
    assert.equal(new Set(results.map((r) => r.json().data.legalHold.id)).size, 1);
    assert.equal(await db.userLegalHold.count({ where: { userId: user.id, releasedAt: null } }), 1);
    assert.equal((await audits(user.id, "user.legalHold.manage", "place")).length, 1);
    // DB kuralı: ikinci açık kayıt doğrudan SQL ile de yazılamaz.
    await assert.rejects(db.userLegalHold.create({ data: { userId: user.id, reason: "ikinci açık kayıt", placedById: boss.id } }), /unique|Unique/i);
  });

  test("yarış: anonimleştirme ile yaptırım aynı anda — ya yaptırım engeller ya silinmiş hesaba yaptırım reddedilir, ikisi birden olmaz", async () => {
    for (let round = 0; round < 3; round++) {
      const user = await signUp();
      const [gone, sanction] = await Promise.all([
        erase(user),
        send("POST", `/admin/users/${user.id}/sanctions`, { type: "BAN", reason: "Yarış testi için yaptırım", endsAt: null }, boss.cookie),
      ]);
      const erased = gone.statusCode === 200 && (await userRow(user.id)).deletedAt !== null;
      if (erased) {
        assertError(sanction, 409, "CONFLICT", "user_deleted");
        assert.equal(await db.sanction.count({ where: { userId: user.id, type: "BAN", liftedAt: null } }), 0);
      } else {
        assertError(gone, 409, "CONFLICT", "active_sanction");
        assert.equal(sanction.statusCode, 201, sanction.body);
        assert.equal((await userRow(user.id)).deletedAt, null);
      }
    }
  });

  test("yarış: anonimleştirme ile sahip atama aynı anda — anonimleştirilmiş hesap asla sahip kalmaz", async () => {
    await setFlag(true);
    try {
      for (let round = 0; round < 3; round++) {
        const user = await signUp();
        const c = await track(db.community.create({ data: { slug: slug(), name: "Yarış topluluğu", createdById: admin.id } }));
        const [gone, assign] = await Promise.all([
          erase(user),
          send("PUT", `/admin/communities/${c.id}/owner`, { userId: user.id, reason: "Yarış testi için sahip ataması" }, boss.cookie),
        ]);
        assert.equal(gone.statusCode, 200, gone.body);
        assert.ok([200, 409].includes(assign.statusCode), assign.body);
        const community = await db.community.findUniqueOrThrow({ where: { id: c.id } });
        assert.equal(community.ownerId, null, "silinmiş hesap sahip kalamaz");
        assert.equal(await db.communityMembership.count({ where: { communityId: c.id, userId: user.id } }), 0);
        assert.equal(community.memberCount, 0);
      }
    } finally {
      await setFlag(false);
    }
  });

  test("yarış: anonimleştirme ile topluluktan ayrılma aynı anda — sayaç iki kez düşmez, negatife inmez", async () => {
    for (let round = 0; round < 3; round++) {
      const user = await signUp();
      const other = await signUp();
      const c = await track(db.community.create({ data: { slug: slug(), name: "Ayrılma yarışı", createdById: admin.id, memberCount: 2 } }));
      await db.communityMembership.createMany({ data: [{ communityId: c.id, userId: user.id }, { communityId: c.id, userId: other.id }] });
      const [gone, left] = await Promise.all([erase(user), send("DELETE", `/communities/${c.id}/membership`, undefined, user.cookie)]);
      assert.equal(gone.statusCode, 200, gone.body);
      assert.ok([200, 204, 401].includes(left.statusCode), left.body);
      assert.equal((await db.community.findUniqueOrThrow({ where: { id: c.id } })).memberCount, 1);
      assert.equal(await db.communityMembership.count({ where: { communityId: c.id } }), 1);
    }
  });
});

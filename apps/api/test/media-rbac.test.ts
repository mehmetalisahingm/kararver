/** KV-12 (#14): mediaPurpose tabanlı RESTRICT_POSTING regresyon testleri. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ErrorBody } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { createHarness, prismaBackend, sessionCookie, tokenFrom, WEB_ORIGIN, type Harness } from "./support/harness.ts";

const backend = prismaBackend();

describe("media RBAC / RESTRICT_POSTING (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let h: Harness;
  let db: PrismaClient;

  before(async () => {
    h = await createHarness(backend!);
    db = h.prisma!;
  });

  after(async () => {
    await h?.close();
  });

  function send(method: "POST", url: string, body: unknown, cookie?: string) {
    return h.app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function assertRestricted(res: { statusCode: number; json(): any }, action: "media.upload" | "media.complete") {
    assert.equal(res.statusCode, 403, JSON.stringify(res.json()));
    ErrorBody.parse(res.json());
    assert.equal(res.json().error.code, "ACCOUNT_RESTRICTED");
    assert.equal(res.json().error.details[0]?.code, action);
  }

  async function signUp() {
    const id = randomUUID().replaceAll("-", "").slice(0, 10);
    const account = {
      email: `media_rbac_${id}@example.test`,
      username: `media_rbac_${id}`,
      displayName: "RBAC Test",
      password: "guclu-bir-sifre-1",
    };
    const mailCount = h.mails.length;
    assert.equal((await send("POST", "/auth/register", account)).statusCode, 202);
    assert.equal((await send("POST", "/auth/email/verify", { token: tokenFrom(h.mails[mailCount]) })).statusCode, 200);
    const login = await send("POST", "/auth/login", { email: account.email, password: account.password });
    assert.equal(login.statusCode, 200, login.body);
    return { cookie: sessionCookie(login.headers["set-cookie"]), id: login.json().data.id as string };
  }

  async function restrictPosting(userId: string, createdById: string) {
    await db.sanction.create({
      data: {
        userId,
        type: "RESTRICT_POSTING",
        reason: "Medya RBAC regresyon testi",
        createdById,
      },
    });
  }

  test("RESTRICT_POSTING içerik görselini engeller, AVATAR yüklemesini engellemez", async () => {
    const user = await signUp();
    const issuer = await signUp();
    await restrictPosting(user.id, issuer.id);

    const pollUpload = await send(
      "POST",
      "/media/uploads",
      { purpose: "POLL", mimeType: "image/jpeg", sizeBytes: 1024 },
      user.cookie,
    );
    assertRestricted(pollUpload, "media.upload");

    const communityUpload = await send(
      "POST",
      "/media/uploads",
      { purpose: "COMMUNITY", mimeType: "image/jpeg", sizeBytes: 1024 },
      user.cookie,
    );
    assertRestricted(communityUpload, "media.upload");

    const avatarUpload = await send(
      "POST",
      "/media/uploads",
      { purpose: "AVATAR", mimeType: "image/jpeg", sizeBytes: 1024 },
      user.cookie,
    );
    assert.equal(avatarUpload.statusCode, 201, avatarUpload.body);
  });

  test("upload sonrası gelen RESTRICT_POSTING, içerik görselinin complete adımını da engeller", async () => {
    const user = await signUp();
    const issuer = await signUp();

    const created = await send(
      "POST",
      "/media/uploads",
      { purpose: "POLL", mimeType: "image/jpeg", sizeBytes: 1024 },
      user.cookie,
    );
    assert.equal(created.statusCode, 201, created.body);
    const mediaId = created.json().data.mediaId as string;
    const media = await db.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } });
    h.storage.put(media.originalObjectKey, 1024, "image/jpeg");

    await restrictPosting(user.id, issuer.id);

    const completed = await send("POST", `/media/${mediaId}/complete`, undefined, user.cookie);
    assertRestricted(completed, "media.complete");
    assert.ok(!h.queue.enqueued.includes(mediaId));
  });
});

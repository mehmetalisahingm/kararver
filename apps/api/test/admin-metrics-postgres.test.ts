import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { PrismaClient } from "@kararver/db";
import { createPrismaMetricsStore } from "../src/modules/metrics/store.ts";
import { prismaBackend } from "./support/harness.ts";

const backend = prismaBackend();
describe("operational admin metrics (postgres)", { skip: backend ? false : "TEST_DATABASE_URL yok" }, () => {
  let db: PrismaClient;
  before(async () => { db = (await backend!.create()).prisma!; });
  after(async () => { await db?.$disconnect(); });

  test("Istanbul midnight, unique active accounts, media and community counts match persisted data", async () => {
    // A fixed future window separates this test from the shared database's historical fixtures.
    const at = new Date("2041-05-12T21:30:00Z"); // Istanbul 13 May 00:30
    const store = createPrismaMetricsStore(db, () => at);
    const baseline = await store.get("7d");
    async function user(createdAt: Date, status: "ACTIVE" | "SUSPENDED" = "ACTIVE", deletedAt: Date | null = null) {
      const name = `met_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      return db.user.create({ data: { email: `${name}@example.test`, emailNormalized: `${name}@example.test`, username: name, usernameNormalized: name, displayName: "Metrics fixture", passwordHash: "unused-test-hash", createdAt, status, deletedAt } });
    }
    const yesterday = await user(new Date("2041-05-12T20:59:59Z"));
    const today = await user(new Date("2041-05-12T21:00:00Z"));
    const suspended = await user(new Date("2041-05-12T21:00:00Z"), "SUSPENDED");
    const deleted = await user(new Date("2041-05-12T21:00:00Z"), "ACTIVE", at);
    const future = await user(new Date("2041-05-12T22:00:00Z"));
    const old = await user(new Date("2041-05-10T21:00:00Z"));
    async function session(userId: string, data: { createdAt?: Date; lastSeenAt?: Date | null; expiresAt?: Date; revokedAt?: Date | null } = {}) {
      return db.session.create({ data: { userId, tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), createdAt: new Date("2041-05-12T21:00:00Z"), expiresAt: new Date("2041-05-14T21:00:00Z"), ...data } });
    }
    await session(today.id);
    await session(today.id); // two sessions count as one active account
    await session(suspended.id);
    await session(deleted.id);
    await session(future.id, { createdAt: future.createdAt });
    await session(yesterday.id, { revokedAt: at });
    await session(yesterday.id, { expiresAt: at });
    await session(old.id, { createdAt: old.createdAt, lastSeenAt: new Date("2041-05-12T21:15:00Z") });
    const tag = randomUUID().slice(0, 8);
    const a = await db.community.create({ data: { slug: `met-a-${tag}`, name: "Metrics A", createdById: today.id } });
    const b = await db.community.create({ data: { slug: `met-b-${tag}`, name: "Metrics B", createdById: today.id } });
    const hidden = await db.community.create({ data: { slug: `met-c-${tag}`, name: "Metrics hidden", status: "HIDDEN", createdById: today.id } });
    await db.communityMembership.createMany({ data: [
      { communityId: a.id, userId: today.id }, { communityId: b.id, userId: today.id },
      { communityId: a.id, userId: old.id }, { communityId: b.id, userId: suspended.id },
      { communityId: hidden.id, userId: yesterday.id },
    ] });
    for (const status of ["PENDING", "QUARANTINED"] as const) await db.mediaAsset.create({ data: { uploaderId: today.id, purpose: "AVATAR", status, originalObjectKey: `metrics/${randomUUID()}` } });
    const metrics = await store.get("7d");
    assert.equal(metrics.generatedAt, at.toISOString());
    assert.equal(metrics.totals.users, baseline.totals.users + 5);
    assert.equal(metrics.totals.activeAccounts, baseline.totals.activeAccounts + 4);
    assert.equal(metrics.totals.suspendedAccounts, baseline.totals.suspendedAccounts + 1);
    assert.equal(metrics.totals.registrations24h, baseline.totals.registrations24h + 3);
    assert.equal(metrics.totals.activeUsers24h, baseline.totals.activeUsers24h + 2);
    assert.equal(metrics.totals.communityMembers, baseline.totals.communityMembers + 2);
    assert.equal(metrics.totals.activeCommunities, baseline.totals.activeCommunities + 2);
    assert.equal(metrics.totals.pendingMedia, baseline.totals.pendingMedia + 1);
    assert.equal(metrics.totals.quarantinedMedia, baseline.totals.quarantinedMedia + 1);
    assert.deepEqual(metrics.series.map(d => d.localDate), ["2041-05-07", "2041-05-08", "2041-05-09", "2041-05-10", "2041-05-11", "2041-05-12", "2041-05-13"]);
    assert.equal(metrics.series.at(-1)!.registrations - baseline.series.at(-1)!.registrations, 2);
    assert.equal(metrics.series.at(-2)!.registrations - baseline.series.at(-2)!.registrations, 1);
    const month = await store.get("30d");
    assert.equal(new Set(month.series.map(d => d.localDate)).size, 30);
    assert.equal(month.series.at(-1)!.localDate, "2041-05-13");
  });
});

// Yönetici içerik ekranının saf kuralları (KV-37): durum → sunulan işlemler, taşıma farkı, askı süresi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { availableActions, placementDiff, suspendUntil } from "../src/features/admin/content-model.ts";

const poll = (over: Partial<{ status: "ACTIVE" | "HIDDEN" | "LOCKED" | "REMOVED" | "UNDER_REVIEW"; trendExcluded: boolean; commentsClosed: boolean }> = {}) => ({
  status: "ACTIVE" as const,
  trendExcluded: false,
  commentsClosed: false,
  ...over,
});

test("yayındaki ankette gizle, kilitle, kaldır, trend ve yorum kapatma sunulur", () => {
  assert.deepEqual(availableActions("polls", poll(), false), ["HIDE", "LOCK", "REMOVE", "EXCLUDE_FROM_TRENDS", "CLOSE_COMMENTS"]);
});

test("trend ve yorum işlemleri şimdiki duruma göre tersini sunar", () => {
  const actions = availableActions("polls", poll({ trendExcluded: true, commentsClosed: true }), false);
  assert.ok(actions.includes("INCLUDE_IN_TRENDS") && actions.includes("OPEN_COMMENTS"));
  assert.ok(!actions.includes("EXCLUDE_FROM_TRENDS") && !actions.includes("CLOSE_COMMENTS"));
});

test("kilitli ankette kilidi aç ve geri yükle; gizli ankette geri yükle", () => {
  assert.deepEqual(availableActions("polls", poll({ status: "LOCKED" }), false).slice(0, 2), ["UNLOCK", "RESTORE"]);
  assert.ok(availableActions("polls", poll({ status: "HIDDEN" }), false).includes("RESTORE"));
});

test("kaldırılmış içeriği yalnız yönetici geri yükler; trend ve yorum kapatma sunulmaz", () => {
  assert.deepEqual(availableActions("polls", poll({ status: "REMOVED" }), false), []);
  assert.deepEqual(availableActions("polls", poll({ status: "REMOVED" }), true), ["RESTORE"]);
});

test("yorumda kilit, trend ve yorum kapatma yok", () => {
  assert.deepEqual(availableActions("comments", { status: "ACTIVE" }, false), ["HIDE", "REMOVE"]);
  assert.deepEqual(availableActions("comments", { status: "HIDDEN" }, false), ["RESTORE", "REMOVE"]);
});

test("taşıma farkı yalnız değişen alanları taşır; değişiklik yoksa null", () => {
  const current = { categoryId: "c1", communityId: "k1" };
  assert.equal(placementDiff(current, { categoryId: "c1", communityId: "k1" }), null);
  assert.deepEqual(placementDiff(current, { categoryId: "c2", communityId: "k1" }), { categoryId: "c2" });
  assert.deepEqual(placementDiff(current, { categoryId: "c1", communityId: null }), { communityId: null });
  assert.deepEqual(placementDiff({ categoryId: "c1", communityId: null }, { categoryId: "c2", communityId: "k2" }), { categoryId: "c2", communityId: "k2" });
});

test("askı bitişi gün sayısı kadar ileridedir", () => {
  const now = new Date("2026-10-06T10:00:00.000Z");
  assert.equal(suspendUntil(7, now), "2026-10-13T10:00:00.000Z");
});

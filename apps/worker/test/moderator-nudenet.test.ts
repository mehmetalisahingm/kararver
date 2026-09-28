// Gerçek NudeNet modeliyle python/moderate.py. Sadece MODERATION_PYTHON, requirements.txt kurulu bir
// yorumlayıcıyı gösteriyorsa çalışır (CI'da Python ortamı yok; deploy imajında zorunlu).
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { createSubprocessModerator } from "../src/jobs/media/moderator.ts";

const python = process.env.MODERATION_PYTHON;

test("gerçek model: protokol çalışır, zararsız görselde yüksek risk sınıfı yok", { skip: python ? false : "MODERATION_PYTHON yok" }, async () => {
  const moderator = createSubprocessModerator({
    command: python!,
    args: [path.resolve(import.meta.dirname, "../python/moderate.py")],
    timeoutMs: 8_000,
    startupTimeoutMs: 60_000,
  });
  try {
    const image = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#3a6ea5" } }).webp().toBuffer();
    const detections = await moderator.classify(image);
    assert.ok(Array.isArray(detections));
    assert.ok(detections.every((d) => typeof d.class === "string" && d.score >= 0 && d.score <= 1));
    assert.ok(!detections.some((d) => d.class.endsWith("_EXPOSED")));

    const started = Date.now();
    await moderator.classify(image);
    assert.ok(Date.now() - started < 2_000, "sıcak süreçte görsel başına 2 sn'den kısa");

    await assert.rejects(moderator.classify(Buffer.from("görsel değil")), /Error/);
    assert.ok(Array.isArray(await moderator.classify(image)), "model hatası süreci düşürmez");
  } finally {
    await moderator.close();
  }
});

// Moderasyon alt-süreci protokolü, zaman aşımı ve yeniden başlatma. Python yerine aynı protokolü
// konuşan sahte bir süreç kullanılır (test/support/fake-moderator.mjs); gerçek model testi:
// moderator-nudenet.test.ts (MODERATION_PYTHON tanımlıysa).
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { createSubprocessModerator, ModerationFailedError, ModerationTimeoutError } from "../src/jobs/media/moderator.ts";

const script = path.resolve(import.meta.dirname, "support/fake-moderator.mjs");
const moderator = (mode: string, timeoutMs = 1_000, startupTimeoutMs = 2_000) => {
  const stderr: string[] = [];
  const m = createSubprocessModerator({
    command: process.execPath,
    args: [script, mode],
    timeoutMs,
    startupTimeoutMs,
    onStderr: (line) => stderr.push(line),
  });
  return Object.assign(m, { stderr });
};

test("süreç bir kez başlar, istekler id ile eşleşir, protokol dışı satırlar yok sayılır", async () => {
  const m = moderator("ok");
  try {
    const [a, b] = await Promise.all([m.classify(Buffer.alloc(10)), m.classify(Buffer.alloc(20))]);
    assert.equal(a.find((d) => d.class === "SIZE")!.score, 10);
    assert.equal(b.find((d) => d.class === "SIZE")!.score, 20);
    assert.ok(m.stderr.some((l) => l.includes("model yüklendi")));
    assert.ok(m.stderr.some((l) => l.includes("protokol dışı")));
  } finally {
    await m.close();
  }
});

test("cevap gelmezse ModerationTimeoutError; takılan süreç öldürülür ve sonraki istekte yeniden başlar", async () => {
  const m = moderator("slow", 200);
  try {
    const started = Date.now();
    await assert.rejects(m.classify(Buffer.alloc(1)), ModerationTimeoutError);
    assert.ok(Date.now() - started < 1_500);
    await assert.rejects(m.classify(Buffer.alloc(1)), ModerationTimeoutError);
  } finally {
    await m.close();
  }
});

test("hiç hazır olmayan süreç başlangıç zaman aşımı verir", async () => {
  const m = moderator("never-ready", 200, 300);
  try {
    await assert.rejects(m.classify(Buffer.alloc(1)), ModerationTimeoutError);
  } finally {
    await m.close();
  }
});

test("model hatası ve süreç çökmesi ModerationFailedError; çökme sonrası yeniden başlatılır", async () => {
  const failing = moderator("error");
  try {
    await assert.rejects(failing.classify(Buffer.alloc(1)), /bozuk görsel/);
  } finally {
    await failing.close();
  }

  const crashing = moderator("crash");
  try {
    await assert.rejects(crashing.classify(Buffer.alloc(1)), ModerationFailedError);
    await assert.rejects(crashing.classify(Buffer.alloc(1)), ModerationFailedError);
  } finally {
    await crashing.close();
  }
});

test("olmayan yorumlayıcı ModerationFailedError verir, worker'ı düşürmez", async () => {
  const m = createSubprocessModerator({ command: "kararver-olmayan-python", args: [], timeoutMs: 200, startupTimeoutMs: 1_000 });
  try {
    await assert.rejects(m.classify(Buffer.alloc(1)), ModerationFailedError);
  } finally {
    await m.close();
  }
});

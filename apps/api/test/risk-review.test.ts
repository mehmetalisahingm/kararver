import assert from "node:assert/strict";
import { test } from "node:test";
import { screenV1Publication } from "../src/modules/polls/risk-review.ts";

test("only relevant uncertain content enters review; normal poll and discussion publish directly", () => {
  for (const input of [
    { kind: "POLL" as const, title: "Bu telefonu satın almak mantıklı mı?", options: [{ label: "Evet" }, { label: "Hayır" }] },
    { kind: "DISCUSSION" as const, title: "En güzel yürüyüş parkuru nerededir?" },
    { kind: "POLL" as const, title: "Hastane otoparkı daha ucuz olmalı mı?", options: [{ label: "Olmalı" }, { label: "Olmamalı" }] },
  ]) assert.deepEqual(screenV1Publication(input), { action: "PUBLISH", signals: [] });
});

test("media, external links and ambiguous sensitive contexts are queued, not automatically public", () => {
  assert.deepEqual(screenV1Publication({ kind: "POLL", title: "En iyi fotoğraf hangisi?", mediaIds: ["not-a-real-id"] }),
    { action: "REVIEW", signals: ["MEDIA_PENDING_HUMAN_CONTEXT"] });
  assert.deepEqual(screenV1Publication({ kind: "DISCUSSION", title: "Daha fazla bilgi için https://example.com adresini kullan" }),
    { action: "REVIEW", signals: ["EXTERNAL_LINK"] });
  assert.deepEqual(screenV1Publication({ kind: "POLL", title: "Siyasi partilerin kamuya sunduğu vaatleri konuşalım" }),
    { action: "REVIEW", signals: ["POSSIBLE_SENSITIVE_CONTEXT"] });
});

test("multiple risk signals are de-duplicated and contain no user text or sensitive inferred attributes", () => {
  const out = screenV1Publication({
    kind: "POLL", title: "Siyasi tartışma için https://example.com", mediaIds: ["media"],
    options: [{ label: "https://another.test.com" }, { label: "Başka" }],
  });
  assert.equal(out.action, "REVIEW");
  assert.deepEqual(out.signals, ["MEDIA_PENDING_HUMAN_CONTEXT", "EXTERNAL_LINK", "POSSIBLE_SENSITIVE_CONTEXT"]);
  assert.doesNotMatch(JSON.stringify(out), /example\.com|Siyasi tartışma/i);
});

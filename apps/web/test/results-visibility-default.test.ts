import assert from "node:assert/strict";
import { test } from "node:test";
import { CreatePollBody } from "@kararver/contracts";
import { emptyDraft } from "../src/lib/model.ts";

const validNewPoll = () => ({
  kind: "POLL" as const,
  title: "Öğrenciler hangi seçeneği tercih ediyor?",
  categoryId: "00000000-0000-4000-8000-000000000001",
  durationHours: 72,
  options: [{ label: "Birinci seçenek" }, { label: "İkinci seçenek" }],
});

test("new composer drafts start public, resetting a draft also returns to public default", () => {
  const first = emptyDraft();
  assert.equal(first.visibility, "always");
  first.visibility = "after_vote";
  assert.equal(emptyDraft().visibility, "always");
});

test("API applies ALWAYS only when missing; explicit AFTER_VOTE is still valid", () => {
  const noChoice = CreatePollBody.parse(validNewPoll());
  if (noChoice.kind !== "POLL") throw new Error("not_poll");
  assert.equal(noChoice.resultsVisibility, "ALWAYS");
  const privateChoice = CreatePollBody.parse({ ...validNewPoll(), resultsVisibility: "AFTER_VOTE" });
  if (privateChoice.kind !== "POLL") throw new Error("not_poll");
  assert.equal(privateChoice.resultsVisibility, "AFTER_VOTE");
  assert.equal(CreatePollBody.safeParse({ ...validNewPoll(), resultsVisibility: "PUBLIC" }).success, false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { triageSensitiveContent, type TriageHit } from "../src/modules/polls/sensitive-triage.ts";

test("poll inventory detects combined choices and addendum without duplicate poll hits", async () => {
  const poll = { id: "p1", status: "ACTIVE", title: "Genel bir soru", description: null, extraInfo: null,
    options: [{ label: "Alevi" }, { label: "Sünni" }], addenda: [{ body: "Hangisisin?" }, { body: "Hangisisin?" }] };
  let requestedAddenda = false;
  const tx = {
    poll: { findMany: async (args: { select: { addenda?: unknown } }) => { requestedAddenda = Boolean(args.select.addenda); return [poll]; } },
    pollAddendum: { findMany: async () => [{ id: "a1", pollId: "p1", body: "Hangisisin?", poll: { status: "ACTIVE" } }] },
    comment: { findMany: async () => [] },
  };
  const hits: TriageHit[] = [];
  const summary = await triageSensitiveContent(tx as never, hit => { hits.push(hit); });
  assert.equal(requestedAddenda, true);
  assert.deepEqual(hits, [{ kind: "poll", id: "p1", pollId: "p1", status: "ACTIVE", category: "belief", field: "options.0.label" }]);
  assert.equal(summary.poll.flagged, 1);
  assert.equal(summary.addendum.scanned, 1);
  assert.equal(summary.addendum.flagged, 0);
});

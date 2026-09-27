import test from "node:test";
import assert from "node:assert/strict";
import { DemoClient } from "../src/lib/demo-client.ts";
import { emptyDraft, safeReturnTo, validateDraft } from "../src/lib/model.ts";
const draft = () => ({
  ...emptyDraft(),
  title: "Bir sonraki bilgisayarım hangisi olmalı?",
  options: ["Laptop", "Masaüstü"],
});
test("guest projection omits hidden vote counts; closed results are visible", async () => {
  const client = new DemoClient(0);
  const poll = await client.get("calisma-sekli");
  assert.deepEqual(poll.results, { visible: false });
  assert.equal("counts" in poll, false);
  assert.equal("votes" in poll, false);
  assert.equal((await client.get("kapali-anket")).results.visible, true);
});
test("login does not vote, repeated/concurrent votes are idempotent and cannot change", async () => {
  const client = new DemoClient(0);
  await client.login("umit@example.test", "Demo12345!");
  assert.equal((await client.get("calisma-sekli")).ownVote, null);
  const results = await Promise.all(
    Array.from({ length: 20 }, () => client.vote("calisma-sekli", "remote")),
  );
  const last = results.at(-1)!;
  assert.ok(last.results.visible);
  assert.equal(last.results.total, 101);
  await assert.rejects(client.vote("calisma-sekli", "office"), {
    code: "CONFLICT",
  });
  await assert.rejects(client.vote("kapali-anket", "film"), {
    code: "POLL_CLOSED",
  });
  await assert.rejects(client.vote("kilitli-anket", "yes"), {
    code: "POLL_CLOSED",
  });
  assert.equal(client.current()?.balance, 20);
});
test("first login grant only once, duplicate create charges once, balance cannot go negative", async () => {
  const client = new DemoClient(0);
  await client.login("umit@example.test", "Demo12345!");
  const result = await Promise.all([
    client.create(draft(), "one"),
    client.create(draft(), "one"),
  ]);
  assert.equal(result[0].id, result[1].id);
  assert.equal(client.current()?.balance, 10);
  await client.logout();
  await client.login("umit@example.test", "Demo12345!");
  assert.equal(client.current()?.balance, 10);
  await client.create({ ...draft(), kind: "discussion", options: [] }, "two");
  assert.equal(client.current()?.balance, 0);
  await assert.rejects(client.create(draft(), "three"), {
    code: "INSUFFICIENT_BALANCE",
  });
});
test("failed publish preserves balance and can retry with the same request identity", async () => {
  const client = new DemoClient(0);
  await client.login("umit@example.test", "Demo12345!");
  client.failNext("create");
  await assert.rejects(client.create(draft(), "retry"), {
    code: "INTERNAL_ERROR",
  });
  assert.equal(client.current()?.balance, 20);
  await client.create(draft(), "retry");
  assert.equal(client.current()?.balance, 10);
  await assert.rejects(
    client.create(
      { ...draft(), title: "Tamamen farklı bir örnek soru?" },
      "retry",
    ),
    { code: "CONFLICT" },
  );
});
test("registration, one-time demo verification and reset; no real account input", async () => {
  const client = new DemoClient(0);
  await assert.rejects(
    client.register("Test", "real@example.com", "password"),
    { code: "VALIDATION_ERROR" },
  );
  await client.register("Yeni", "yeni@example.test", "Demo12345!");
  await assert.rejects(client.login("yeni@example.test", "Demo12345!"), {
    code: "EMAIL_UNVERIFIED",
  });
  await client.verify("yeni@example.test", "123456");
  await assert.rejects(client.verify("yeni@example.test", "123456"), {
    code: "INVALID_TOKEN",
  });
  await client.login("yeni@example.test", "Demo12345!");
  assert.equal(client.current()?.balance, 20);
  await client.requestReset("yeni@example.test");
  await client.reset("yeni@example.test", "123456", "NewDemo123!");
  assert.equal(client.current(), null);
  await assert.rejects(
    client.reset("yeni@example.test", "123456", "NewDemo123!"),
    { code: "INVALID_TOKEN" },
  );
  await client.login("yeni@example.test", "NewDemo123!");
  assert.equal(client.current()?.balance, 20);
});
test("draft guards and return target never allow external or ambiguous navigation", () => {
  assert.equal(Object.keys(validateDraft(draft())).length, 0);
  assert.ok(validateDraft({ ...draft(), options: ["İZMİR", "izmir"] }).options);
  assert.ok(validateDraft({ ...draft(), options: Array(7).fill("a") }).options);
  assert.ok(validateDraft({ ...draft(), hours: 721 }).hours);
  for (const path of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/giris",
    "/karar/../giris",
    "/karar/a?next=x",
    "/%2f%2fevil.test",
  ])
    assert.equal(safeReturnTo(path), "/");
  assert.equal(safeReturnTo("/karar/calisma-sekli"), "/karar/calisma-sekli");
});
test("two demo accounts keep individual votes; logout removes private result visibility", async () => {
  const client = new DemoClient(0);
  await client.login("umit@example.test", "Demo12345!");
  await client.vote("calisma-sekli", "remote");
  await client.logout();
  assert.deepEqual((await client.get("calisma-sekli")).results, {
    visible: false,
  });
  await client.login("deniz@example.test", "Demo12345!");
  assert.equal((await client.get("calisma-sekli")).ownVote, null);
  const poll = await client.vote("calisma-sekli", "office");
  assert.equal(poll.results.visible && poll.results.total, 102);
});

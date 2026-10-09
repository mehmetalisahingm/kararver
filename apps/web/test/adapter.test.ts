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

test("social reactions switch, remove and stay separate from votes and points", async () => {
  const client = new DemoClient(0);
  await assert.rejects(client.react("calisma-sekli", null, "like"), {
    code: "UNAUTHENTICATED",
  });
  await client.login("umit@example.test", "Demo12345!");
  await Promise.all(
    Array.from({ length: 10 }, () =>
      client.react("calisma-sekli", null, "like"),
    ),
  );
  assert.deepEqual((await client.getEngagement("calisma-sekli")).reaction, {
    likes: 1,
    dislikes: 0,
    own: "like",
  });
  assert.deepEqual(
    (await client.react("calisma-sekli", null, "dislike")).reaction,
    { likes: 0, dislikes: 1, own: "dislike" },
  );
  assert.deepEqual((await client.react("calisma-sekli", null, null)).reaction, {
    likes: 0,
    dislikes: 0,
    own: null,
  });
  assert.equal((await client.get("calisma-sekli")).ownVote, null);
  assert.deepEqual((await client.get("calisma-sekli")).results, {
    visible: false,
  });
  assert.equal(client.current()?.balance, 20);
});
test("comment retries create once; alternatives and replies stay distinct; ownership enforced", async () => {
  const client = new DemoClient(0);
  await client.login("umit@example.test", "Demo12345!");
  const draft = {
    text: "Hibrit çalışma da düşünülebilir.",
    kind: "alternative" as const,
    parentId: null,
  };
  await Promise.all([
    client.addComment("calisma-sekli", draft, "same"),
    client.addComment("calisma-sekli", draft, "same"),
  ]);
  const initial = await client.getEngagement("calisma-sekli");
  assert.equal(initial.comments.length, 2);
  const root = initial.comments.find((c) => c.kind === "alternative")!;
  assert.equal(root.canEdit, true);
  await assert.rejects(
    client.addComment(
      "calisma-sekli",
      { ...draft, text: "Başka bir fikir" },
      "same",
    ),
    { code: "CONFLICT" },
  );
  const next = await client.addComment(
    "calisma-sekli",
    { text: "Katılıyorum.", parentId: root.id, kind: "comment" },
    "reply",
  );
  const reply = next.comments.find((c) => c.parentId)!;
  await assert.rejects(
    client.addComment(
      "calisma-sekli",
      { text: "İkinci seviye", kind: "comment", parentId: reply.id },
      "nested",
    ),
    { code: "COMMENT_DEPTH_EXCEEDED" },
  );
  await client.editComment(
    "calisma-sekli",
    root.id,
    "Haftada iki gün hibrit çalışma.",
  );
  await client.logout();
  await client.login("deniz@example.test", "Demo12345!");
  assert.equal(
    (await client.getEngagement("calisma-sekli")).comments.find(
      (c) => c.id === root.id,
    )?.canEdit,
    false,
  );
  await assert.rejects(
    client.editComment("calisma-sekli", root.id, "Değiştir"),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(client.deleteComment("calisma-sekli", root.id), {
    code: "FORBIDDEN",
  });
  await client.react("calisma-sekli", root.id, "like");
  await client.logout();
  await client.login("umit@example.test", "Demo12345!");
  const deleted = await client.deleteComment("calisma-sekli", root.id);
  assert.equal(deleted.comments.find((c) => c.id === root.id)?.text, "");
  assert.equal(deleted.comments.find((c) => c.id === root.id)?.author, "");
  assert.equal(
    deleted.comments.find((c) => c.id === reply.id)?.parentId,
    root.id,
  );
  assert.equal((await client.get("calisma-sekli")).commentCount, 2);
  assert.equal(client.current()?.balance, 20);
});
test("social request failures preserve data and retry identity", async () => {
  const client = new DemoClient(0);
  await client.login("umit@example.test", "Demo12345!");
  const before = await client.getEngagement("ilk-bisiklet");
  const draft = {
    text: "Kadro boyunu denemelisin.",
    kind: "comment" as const,
    parentId: null,
  };
  client.failNext("comment");
  await assert.rejects(client.addComment("ilk-bisiklet", draft, "retry"), {
    code: "INTERNAL_ERROR",
  });
  assert.deepEqual(await client.getEngagement("ilk-bisiklet"), before);
  const result = await client.addComment("ilk-bisiklet", draft, "retry");
  const own = result.comments.find((c) => c.canEdit)!;
  for (const operation of ["reaction", "editComment", "deleteComment"]) {
    client.failNext(operation);
    const call =
      operation === "reaction"
        ? client.react("ilk-bisiklet", null, "like")
        : operation === "editComment"
          ? client.editComment("ilk-bisiklet", own.id, "Yeni metin")
          : client.deleteComment("ilk-bisiklet", own.id);
    await assert.rejects(call, { code: "INTERNAL_ERROR" });
    assert.deepEqual(await client.getEngagement("ilk-bisiklet"), result);
  }
});
test("locked/disabled comments reject writes; voting closure does not close comments", async () => {
  const client = new DemoClient(0);
  await client.login("umit@example.test", "Demo12345!");
  const comment = {
    text: "Bir önerim var.",
    kind: "comment" as const,
    parentId: null,
  };
  await assert.rejects(client.addComment("kilitli-anket", comment, "locked"), {
    code: "CONTENT_LOCKED",
  });
  await assert.rejects(client.react("kilitli-anket", null, "like"), {
    code: "CONTENT_LOCKED",
  });
  await client.addComment("kapali-anket", comment, "closed");
  const poll = await client.create(
    { ...draft(), commentsEnabled: false },
    "disabled",
  );
  await assert.rejects(client.addComment(poll.id, comment, "disabled"), {
    code: "COMMENTS_DISABLED",
  });
  await assert.rejects(
    client.addComment("ilk-bisiklet", { ...comment, text: " " }, "empty"),
    { code: "VALIDATION_ERROR" },
  );
  await assert.rejects(
    client.addComment(
      "ilk-bisiklet",
      { ...comment, text: "a".repeat(2001) },
      "long",
    ),
    { code: "VALIDATION_ERROR" },
  );
  assert.equal(client.current()?.balance, 10);
});
test("gallery pending/removed items carry no public source", async () => {
  const client = new DemoClient(0);
  const poll = await client.get("tatil-rotasi");
  assert.equal(poll.price?.amount, "12000.00");
  for (const item of poll.gallery || [])
    if (item.status !== "ready") assert.equal("src" in item, false);
});

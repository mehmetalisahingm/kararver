import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHarness, prismaBackend, tokenFrom, WEB_ORIGIN } from "../../api/test/support/harness.ts";
import { ApiClient } from "../src/lib/api-client.ts";
import { emptyDraft } from "../src/lib/model.ts";

const backend = prismaBackend();
test("KV-18 real HTTP/PostgreSQL: two accounts, comments, replies, alternatives, reactions and visibility", {
  skip: backend ? false : "TEST_DATABASE_URL required; executed in database CI job", timeout: 120000,
}, async () => {
  const h = await createHarness(backend);
  try {
    const origin = await h.app.listen({ host: "127.0.0.1", port: 0 });
    async function account() {
      let cookie = "";
      const client = new ApiClient(origin, async (url, init) => {
        const response = await fetch(url, { ...init,
          headers: { ...init?.headers, origin: WEB_ORIGIN, ...(cookie ? {cookie} : {}) },
        });
        const setCookie = response.headers.getSetCookie()[0];
        if (setCookie) cookie = setCookie.split(";")[0];
        return response;
      });
      const key = randomUUID().replaceAll("-", "").slice(0, 10);
      await client.register("Sosyal Test", `social_${key}@example.test`, "secure-password-123", `soc_${key}`);
      await client.verify("", tokenFrom(h.mails.at(-1)));
      await client.login(`social_${key}@example.test`, "secure-password-123");
      return client;
    }
    const author = await account();
    const reader = await account();
    const guest = new ApiClient(origin);
    const categoryId = (await author.getCategories())[0].id;
    const poll = await author.create({ ...emptyDraft(), categoryId, title: "Sosyal entegrasyon anketi",
      options: ["Birinci", "İkinci"], visibility: "after_vote", hours: 336,
    }, randomUUID());
    assert.deepEqual((await guest.get(poll.id)).results, {visible:false});
    await author.getEngagement(poll.id);
    await reader.getEngagement(poll.id);
    const draft = {text:"Ana yorum", kind:"comment", parentId:null};
    const key = randomUUID();
    let state = await author.addComment(poll.id, draft, key);
    const root = state.comments.find(c => c.text === draft.text);
    state = await author.addComment(poll.id, draft, key);
    assert.equal(state.comments.filter(c => c.id === root.id).length, 1);
    state = await reader.addComment(poll.id, {text:"Yanıt", kind:"comment", parentId:root.id}, randomUUID());
    const reply = state.comments.find(c => c.text === "Yanıt");
    state = await author.addComment(poll.id, {text:"Başka seçenek", kind:"alternative", parentId:null}, randomUUID());
    assert.equal(state.comments.find(c => c.text === "Başka seçenek").kind, "alternative");
    state = await reader.react(poll.id, null, "like");
    assert.deepEqual(state.reaction, {likes:1, dislikes:0, own:"like"});
    state = await reader.react(poll.id, null, "dislike");
    assert.deepEqual(state.reaction, {likes:0, dislikes:1, own:"dislike"});
    state = await reader.react(poll.id, null, null);
    assert.deepEqual(state.reaction, {likes:0, dislikes:0, own:null});
    state = await author.react(poll.id, root.id, "like");
    assert.equal(state.comments.find(c => c.id === root.id).reaction.likes, 1);
    await assert.rejects(reader.editComment(poll.id, root.id, "Yetkisiz değişiklik"), error => error.code === "FORBIDDEN");
    state = await author.editComment(poll.id, root.id, "Düzenlendi");
    assert.equal(state.comments.find(c => c.id === root.id).text, "Düzenlendi");
    await author.deleteComment(poll.id, root.id);
    state = await guest.getEngagement(poll.id);
    while (state.hasMore) state = await guest.loadMoreEngagement(poll.id);
    assert.equal(state.comments.find(c => c.id === root.id).deleted, true);
    assert.equal(state.comments.find(c => c.id === reply.id).text, "Yanıt");
    assert.ok(state.comments.every(c => !c.canEdit));
    // Closing voting does not close discussion; locking the content does.
    await h.prisma.poll.update({where:{id:poll.id}, data:{closesAt:new Date(h.clock.now.getTime()-1000)}});
    assert.equal((await guest.get(poll.id)).status, "CLOSED");
    assert.equal((await guest.get(poll.id)).results.visible, true);
    await reader.addComment(poll.id, {text:"Oylama sonrası yorum",kind:"comment",parentId:null}, randomUUID());
    await h.prisma.poll.update({where:{id:poll.id}, data:{status:"LOCKED"}});
    assert.equal((await guest.get(poll.id)).status, "LOCKED");
    await assert.rejects(reader.addComment(poll.id, draft, randomUUID()), error => error.code === "CONTENT_LOCKED");
    await reader.logout();
    await reader.getEngagement(poll.id);
    assert.ok((await reader.getEngagement(poll.id)).comments.every(c => !c.canEdit));
  } finally { await h.close(); }
});

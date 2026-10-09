import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { ApiClient, mapPoll } from "../src/lib/api-client.ts";
import { PollDetail } from "@kararver/contracts";
import { UiError } from "../src/lib/model.ts";
function example(endpoint: string,name?: string) { return structuredClone(examples.find(e=>e.endpoint===endpoint && (name ? e.name===name : e.status<300))!); }
const pollId=(example("polls.get").request!.params as {id:string}).id;

test("poll details preserve public addenda and decimal price", () => {
  const wire = PollDetail.parse((example("polls.get").body as {data:unknown}).data);
  wire.extraInfo = "İlk bilgi";
  wire.price = {amount:"1234.50",currency:"TRY"};
  wire.addenda = [{id:crypto.randomUUID(),body:"Sonradan eklenen açıklama",createdAt:"2026-10-01T09:00:00.000Z"}];
  const poll = mapPoll(wire);
  assert.equal(poll.price?.amount,"1234.50");
  assert.deepEqual(poll.details?.map(item=>item.value),["İlk bilgi","Sonradan eklenen açıklama"]);
  assert.match(poll.details![1].label,/12:00/);
});
test("social adapter uses paginated comments/replies and preserves pending pages on failure",async()=>{
  const calls:string[]=[];let fail=true;
  const client=new ApiClient("http://api.test",async(url)=>{
    const u=new URL(String(url));calls.push(u.pathname+u.search);
    if(u.pathname.endsWith("/comments") && u.searchParams.get("cursor")) {
      if(fail) { fail=false; throw new Error("offline"); }
      return Response.json({data:[],page:{hasMore:false,nextCursor:null}});
    }
    if(u.pathname.endsWith("/replies")) return Response.json({data:[],page:{hasMore:false,nextCursor:null}});
    const e=example(u.pathname.endsWith("/comments") ? "comments.list" : "polls.get");
    if(u.searchParams.get("kind")==="ALTERNATIVE") return Response.json({data:[],page:{hasMore:false,nextCursor:null}});
    if(u.pathname.endsWith("/comments")) (e.body as {page:unknown}).page={hasMore:true,nextCursor:"opaque_page_2"};
    return Response.json(e.body,{status:e.status});
  });
  const first=await client.getEngagement(pollId);assert.equal(first.hasMore,true);
  await assert.rejects(client.loadMoreEngagement(pollId),(e:UiError)=>e.code==="NETWORK_ERROR");
  const second=await client.loadMoreEngagement(pollId);assert.deepEqual(second.comments,first.comments);
  assert.equal(calls.filter(c=>c.includes("cursor=opaque_page_2")).length,2);
});
test("comment writes use contract body and key; successful write needs no fallible refetch",async()=>{
  const methods:string[]=[];
  const client=new ApiClient("http://api.test",async(url,init)=>{
    const method=init!.method!; methods.push(method);
    if(method==="POST") {
      assert.deepEqual(JSON.parse(init!.body as string),{body:"Yeni yorum",kind:"COMMENT"});
      assert.equal((init!.headers as Record<string,string>)["Idempotency-Key"],"comment-key");
      const e=example("comments.create");return Response.json(e.body,{status:e.status});
    }
    if(String(url).includes("/comments")) return Response.json({data:[],page:{hasMore:false,nextCursor:null}});
    const e=example("polls.get");return Response.json(e.body);
  });
  await client.getEngagement(pollId);
  const result=await client.addComment(pollId,{text:" Yeni yorum ",kind:"comment",parentId:null},"comment-key");
  assert.equal(result.comments.length,1);assert.equal(methods.at(-1),"POST");assert.equal(methods.length,4);
});
test("aborted social load cannot publish stale viewer state",async()=>{
  const controller=new AbortController();
  const client=new ApiClient("http://api.test",async(url)=>{
    if(String(url).includes("/comments")) {controller.abort();return Response.json({data:[],page:{hasMore:false,nextCursor:null}});}
    return Response.json(example("polls.get").body);
  });
  await assert.rejects(client.getEngagement(pollId,controller.signal),{name:"AbortError"});
});

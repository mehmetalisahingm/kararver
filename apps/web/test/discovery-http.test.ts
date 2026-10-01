import { test } from "node:test";
import assert from "node:assert/strict";
import { examples } from "@kararver/contracts/fixtures";
import { ApiClient } from "../src/lib/api-client.ts";
import { formats } from "../src/features/discovery/model.ts";
function example(endpoint: string,name?: string) { return structuredClone(examples.find(e=>e.endpoint===endpoint && (name?e.name===name:e.status<300))!); }
test("discovery sends category UUIDs and opaque cursors, preserves metadata and public search types", async()=>{
  const urls:URL[]=[];
  const client=new ApiClient("http://api.test",async(url)=>{
    const u=new URL(String(url));urls.push(u);
    const endpoint=u.pathname.endsWith("categories")?"categories.list":u.pathname.endsWith("feed")?"feed.list":"search.query";
    return Response.json(example(endpoint).body);
  });
  const categories=await client.getCategories();assert.ok(categories[0].id);assert.equal(typeof categories[0].description,"string");
  await client.getFeed("new",categories[0].id,"opaque_cursor");
  assert.equal(urls.at(-1)!.searchParams.get("categoryId"),categories[0].id);assert.equal(urls.at(-1)!.searchParams.get("cursor"),"opaque_cursor");
  for(const type of ["polls","users","categories","communities"] as const) {
    await client.search("sıcak ışık",type);assert.equal(urls.at(-1)!.searchParams.get("q"),"sıcak ışık");assert.equal(urls.at(-1)!.searchParams.get("type"),type);
  }
});
test("all five trend formats keep server rank and dates while hydrating option labels",async()=>{
  for(const format of Object.keys(formats) as (keyof typeof formats)[]) {
    const body=example("trends.list","movers").body as any;
    body.meta.format=format;
    if(format!=="WEEKLY_MOVERS")body.data.forEach((i:any)=>i.movement=null);
    const client=new ApiClient("http://api.test",async(url)=>{
      if(String(url).includes("/trends/")) {assert.ok(String(url).includes(format));return Response.json(body);}
      const detail=example("polls.get","voter-visible").body as any;
      detail.data.resultsVisibility="ALWAYS";return Response.json(detail);
    });
    const result=await client.getTrends(format);
    assert.equal(result.meta?.computedAt,body.meta.computedAt);assert.equal(result.data[0].rank,body.data[0].rank);assert.ok(result.data[0].poll.options[0].label);
  }
});
test("trend detail privacy overrides a stale visible card and suppresses movement",async()=>{
  const client=new ApiClient("http://api.test",async(url)=>Response.json(example(String(url).includes("/trends/")?"trends.list":"polls.get",String(url).includes("/trends/")?"movers":"guest-hidden").body));
  const result=await client.getTrends("WEEKLY_MOVERS");
  assert.deepEqual(result.data[0].poll.results,{visible:false});assert.equal(result.data[0].movement,null);
});

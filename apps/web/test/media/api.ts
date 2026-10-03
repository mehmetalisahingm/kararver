import { endpoints } from "@kararver/contracts";
import { examples } from "@kararver/contracts/fixtures";
import type { Page, Route } from "@playwright/test";
export const sample = (id:string,name?:string): any => structuredClone(examples.find(e=>e.endpoint===id && (name?e.name===name:e.status>=200&&e.status<300))!.body);
export const empty = () => ({data:[],page:{hasMore:false,nextCursor:null}});
export const failure = (code="INTERNAL_ERROR") => ({error:{code,message:"İstek tamamlanamadı.",details:[]},requestId:"kv18-test"});
export type Handler = (route:Route,url:URL) => Promise<void>;
export async function api(page:Page) {
  const handlers = new Map<string,Handler>();
  const unexpected:string[]=[];
  await page.route("http://127.0.0.1:4013/**",async route=>{
    const request=route.request(); const url=new URL(request.url());
    if(request.method()==="OPTIONS") {await route.fulfill({status:204,headers:{"access-control-allow-origin":"http://127.0.0.1:3004","access-control-allow-credentials":"true","access-control-allow-methods":"GET,POST,PUT,PATCH,DELETE","access-control-allow-headers":"content-type,idempotency-key"}});return;}
    const endpoint=endpoints.find(e=>e.method===request.method() && new RegExp(`^/v1${e.path.replace(/:[^/]+/g,"[^/]+")}$`).test(url.pathname));
    if(!endpoint) {unexpected.push(request.method()+" "+url.pathname);await route.fulfill({status:500,json:failure()});return;}
    const custom=handlers.get(endpoint.id);
    if(custom) return custom(route,url);
    const body=sample(endpoint.id);
    if(endpoint.id==="me.get") {body.data.avatarUrl=null;body.data.roles=["SUPER_ADMIN"];}
    if(endpoint.id==="profiles.get") body.data.avatarUrl=null;
    await route.fulfill({json:body});
  });
  // Fixtures reference a synthetic CDN; don't contact it during browser tests.
  await page.route("https://cdn.kararver.test/**",r=>r.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#777"/></svg>'}));
  return {handlers,unexpected};
}

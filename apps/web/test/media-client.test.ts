import test from "node:test";
import assert from "node:assert/strict";
import {HttpClient} from "../src/lib/http-client.ts";
import {MediaClient} from "../src/lib/media-client.ts";
import {UiError} from "../src/lib/model.ts";

const ticket={mediaId:"test",upload:{method:"PUT" as const,url:"https://storage.test/upload?signature=private",headers:{"Content-Type":"image/png"},expiresAt:"2030-01-01T00:00:00Z"}};
const file=new File(["test"],"test.png",{type:"image/png"});
test("storage HTTP failure reports only status and never signed URL or response body",async()=>{
  let options:RequestInit|undefined;
  const client=new MediaClient(new HttpClient("https://api.test"),async(_input,init)=>{options=init;return new Response("private-storage-details",{status:403});});
  await assert.rejects(()=>client.put(ticket,file),error=>{
    assert.ok(error instanceof UiError);assert.equal(error.code,"UPLOAD_FAILED");
    assert.match(error.message,/HTTP 403/);assert.doesNotMatch(error.message,/signature|private-storage-details/);return true;
  });
  assert.equal(options?.credentials,"omit");
});
test("network upload failure is distinct from storage HTTP rejection and masks low-level details",async()=>{
  const client=new MediaClient(new HttpClient("https://api.test"),async()=>{throw new TypeError("private signed URL or network detail");});
  await assert.rejects(()=>client.put(ticket,file),error=>{
    assert.ok(error instanceof UiError);assert.match(error.message,/ulaşılamadı/);
    assert.doesNotMatch(error.message,/private|HTTP/);return true;
  });
});

import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { createS3MediaStorage, readBoundedObject } from "../src/modules/media/storage.ts";
import type { S3Client } from "@aws-sdk/client-s3";
const env = { APP_ENV: "test", WEB_URL: "http://web.test", API_URL: "http://api.test", AUTH_TOKEN_PEPPER: "a".repeat(32), MAIL_FROM: "test@example.test", MEDIA_PUBLIC_BASE_URL: "http://api.test/media-public", S3_ENDPOINT: "http://s3.test", S3_ACCESS_KEY_ID: "private-key", S3_SECRET_ACCESS_KEY: "private-secret", S3_BUCKET_PRIVATE: "private", S3_BUCKET_PUBLIC: "public" };

test("bucket-specific public credentials are optional but must be paired; secrets stay out of errors", () => {
  assert.equal(loadConfig(env).storage?.publicCredentials, undefined);
  assert.deepEqual(loadConfig({ ...env, S3_PUBLIC_ACCESS_KEY_ID: "pub", S3_PUBLIC_SECRET_ACCESS_KEY: "pub-secret" }).storage?.publicCredentials, { accessKeyId: "pub", secretAccessKey: "pub-secret" });
  for (const extra of [{ S3_PUBLIC_ACCESS_KEY_ID: "pub" }, { S3_PUBLIC_SECRET_ACCESS_KEY: "pub-secret" }]) {
    assert.throws(() => loadConfig({ ...env, ...extra }), e => e instanceof Error && e.message.includes("S3_PUBLIC_") && !e.message.includes("pub-secret"));
  }
});

test("separate credentials read source privately and publish/read/delete with destination key", async t => {
  const calls: { method: string; path: string; credential: string; cache: string | undefined }[] = [];
  const server = createServer((req, res) => {
    calls.push({ method: req.method!, path: req.url!.split("?")[0]!, credential: req.headers.authorization ?? "", cache: req.headers["cache-control"] });
    req.resume();
    req.on("end", () => {
      if (req.method === "GET") res.writeHead(200, { "content-type": "image/webp" }).end("RIFFtestWEBP");
      else res.writeHead(req.method === "DELETE" ? 204 : 200).end();
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise<void>(r => server.close(() => r())));
  const storage = createS3MediaStorage(loadConfig({ ...env, S3_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, S3_FORCE_PATH_STYLE: "true", S3_PUBLIC_ACCESS_KEY_ID: "public-key", S3_PUBLIC_SECRET_ACCESS_KEY: "public-secret" }).storage!);
  await storage.publishFromPrivate("processed/test.webp", "m/test.webp");
  assert.equal((await storage.readPublic("m/test.webp"))?.toString(), "RIFFtestWEBP");
  await storage.deletePublic("m/test.webp");
  assert.deepEqual(calls.map(c => [c.method, c.path]), [["GET", "/private/processed/test.webp"], ["PUT", "/public/m/test.webp"], ["GET", "/public/m/test.webp"], ["DELETE", "/public/m/test.webp"]]);
  assert.match(calls[0]!.credential, /Credential=private-key\//);
  for (const call of calls.slice(1)) assert.match(call.credential, /Credential=public-key\//);
  assert.equal(calls[1]!.cache, "no-store");
});

test("actual streamed bytes are bounded even without Content-Length", async () => {
  let closed = false;
  async function* body() { try { yield Buffer.alloc(4); yield Buffer.alloc(4); } finally { closed = true; } }
  const client = { send: async () => ({ Body: body() }) } as unknown as S3Client;
  await assert.rejects(readBoundedObject(client, "private", "key", 6), /read limit/);
  assert.equal(closed, true);
});

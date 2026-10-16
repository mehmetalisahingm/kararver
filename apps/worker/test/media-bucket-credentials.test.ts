import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { loadWorkerConfig } from "../src/config.ts";
import { createS3WorkerStorage } from "../src/jobs/media/storage.ts";
import { s3Client } from "../scripts/media-consistency.ts";
const env = { APP_ENV: "test", DATABASE_URL: "postgres://unused", S3_ENDPOINT: "http://unused", S3_FORCE_PATH_STYLE: "true", S3_ACCESS_KEY_ID: "private-key", S3_SECRET_ACCESS_KEY: "private-secret", S3_BUCKET_PRIVATE: "private", S3_BUCKET_PUBLIC: "public" };

test("worker rejects a partial destination key without echoing secrets", () => {
  assert.throws(() => loadWorkerConfig({ ...env, S3_PUBLIC_SECRET_ACCESS_KEY: "public-secret" }), e => e instanceof Error && e.message.includes("S3_PUBLIC_") && !e.message.includes("public-secret"));
  assert.equal(loadWorkerConfig(env).storage.publicCredentials, undefined);
});

test("worker writes original/processed privately and publishes/deletes with bucket-scoped key; audit agrees", async t => {
  const calls: { path: string; credential: string }[] = [];
  const server = createServer((req, res) => { calls.push({ path: req.url!, credential: req.headers.authorization ?? "" }); req.resume(); req.on("end", () => res.writeHead(req.method === "DELETE" ? 204 : 200).end()); });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise<void>(r => server.close(() => r())));
  const config = loadWorkerConfig({ ...env, S3_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, S3_PUBLIC_ACCESS_KEY_ID: "public-key", S3_PUBLIC_SECRET_ACCESS_KEY: "public-secret" }).storage;
  const storage = createS3WorkerStorage(config);
  await storage.writePrivate("processed/one.webp", Buffer.from("one"), "image/webp");
  await storage.writePublic("m/one.webp", Buffer.from("one"), "image/webp");
  await storage.deletePublic("m/one.webp");
  assert.match(calls[0]!.credential, /Credential=private-key\//);
  assert.match(calls[0]!.path, /^\/private\//);
  for (const c of calls.slice(1)) { assert.match(c.credential, /Credential=public-key\//); assert.match(c.path, /^\/public\//); }
  assert.equal((await s3Client(config, "public").config.credentials()).accessKeyId, "public-key");
  assert.equal((await s3Client(config).config.credentials()).accessKeyId, "private-key");
});

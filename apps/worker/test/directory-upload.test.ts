// #186 — yedeği klasöre yazan yükleme (GitHub Actions artifact'ı için): yol, ekleme-yalnız ve klasör dışına çıkmama.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createDirectoryBackupUpload } from "../src/jobs/backup/directory-upload.ts";

let dir: string;
let source: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "kv-dir-upload-"));
  source = path.join(dir, "kaynak.bin");
  await writeFile(source, "şifreli-içerik");
});
after(async () => rm(dir, { recursive: true, force: true }));

test("anahtar klasör altında aynı yola yazılır", async () => {
  const upload = createDirectoryBackupUpload(path.join(dir, "out"));
  await upload("db/staging/2026/11/04/x.dump.enc", source, "application/octet-stream");
  assert.equal(await readFile(path.join(dir, "out/db/staging/2026/11/04/x.dump.enc"), "utf8"), "şifreli-içerik");
});

test("mevcut yedeğin üzerine yazılmaz (ekleme-yalnız)", async () => {
  const upload = createDirectoryBackupUpload(path.join(dir, "out"));
  await assert.rejects(upload("db/staging/2026/11/04/x.dump.enc", source, "application/octet-stream"), /EEXIST/);
});

test("klasör dışına çıkan anahtar reddedilir", async () => {
  const upload = createDirectoryBackupUpload(path.join(dir, "out"));
  await assert.rejects(upload("../kacak.dump.enc", source, "application/octet-stream"), /dışına çıkıyor/);
  await assert.rejects(upload("db/../../kacak.dump.enc", source, "application/octet-stream"), /dışına çıkıyor/);
});

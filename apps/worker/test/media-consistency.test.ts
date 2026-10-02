/**
 * KV-48 (#50) DB ↔ object storage tutarlılık denetimi. S3 listelemesi süreç içi sahte bir ListObjectsV2 sunucusuyla
 * (sayfalama dahil) sınanır; ağ ve gerçek bucket gerekmez.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { compareMedia, isHealthy, listKeys, s3Client, type MediaRow } from "../scripts/media-consistency.ts";

const row = (id: string, status: MediaRow["status"], keys: Partial<MediaRow> = {}): MediaRow => ({
  id,
  status,
  originalObjectKey: `uploads/${id}/original`,
  processedObjectKey: null,
  publicObjectKey: null,
  ...keys,
});

describe("medya tutarlılığı", () => {
  test("eksik nesneler, sahipsiz public nesne ve tamamlanmamış yükleme ayrılır", () => {
    const rows = [
      row("ok", "APPROVED", { processedObjectKey: "processed/ok.webp", publicObjectKey: "m/ok.webp" }),
      row("nopublic", "APPROVED", { processedObjectKey: "processed/nopublic.webp", publicObjectKey: "m/nopublic.webp" }),
      row("noprocessed", "QUARANTINED", { processedObjectKey: "processed/noprocessed.webp" }),
      row("nooriginal", "REJECTED"),
      row("pending", "PENDING"),
    ];
    const privateKeys = new Set([
      "uploads/ok/original",
      "processed/ok.webp",
      "uploads/nopublic/original",
      "processed/nopublic.webp",
      "uploads/noprocessed/original",
      "uploads/abandoned/original",
    ]);
    const publicKeys = new Set(["m/ok.webp", "m/rejected-leftover.webp"]);
    const r = compareMedia(rows, privateKeys, publicKeys);
    assert.deepEqual(r, {
      missingPublic: ["nopublic"],
      missingProcessed: ["noprocessed"],
      missingOriginal: ["nooriginal"],
      publicOrphans: ["m/rejected-leftover.webp"],
      privateOrphans: ["uploads/abandoned/original"],
      pendingUploads: ["pending"],
    });
    assert.equal(isHealthy(r), false);
  });

  test("bilgi niteliğindeki bulgular sağlığı bozmaz", () => {
    const r = compareMedia([row("pending", "PENDING")], new Set(["uploads/abandoned/original"]), new Set());
    assert.equal(isHealthy(r), true);
    assert.deepEqual([r.pendingUploads, r.privateOrphans], [["pending"], ["uploads/abandoned/original"]]);
  });
});

describe("S3 listeleme (sahte ListObjectsV2)", () => {
  const buckets: Record<string, string[]> = { priv: Array.from({ length: 7 }, (_, i) => `uploads/${i}/original`) };
  const requests: string[] = [];
  let server: Server;
  let endpoint: string;

  before(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, "http://x");
      requests.push(url.search);
      const bucket = url.pathname.replace(/^\/+|\/+$/g, "");
      const all = buckets[bucket];
      if (!all || url.searchParams.get("list-type") !== "2") {
        res.writeHead(404).end();
        return;
      }
      const max = Number(url.searchParams.get("max-keys") ?? 1000);
      const start = Number(url.searchParams.get("continuation-token") ?? 0);
      const page = all.slice(start, start + max);
      const truncated = start + max < all.length;
      res.writeHead(200, { "content-type": "application/xml" }).end(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
          `<Name>${bucket}</Name><KeyCount>${page.length}</KeyCount><MaxKeys>${max}</MaxKeys><IsTruncated>${truncated}</IsTruncated>` +
          (truncated ? `<NextContinuationToken>${start + max}</NextContinuationToken>` : "") +
          page.map((k) => `<Contents><Key>${k}</Key><Size>1</Size></Contents>`).join("") +
          `</ListBucketResult>`,
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  test("bütün sayfaları okur", async () => {
    const client = s3Client({
      endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      accessKeyId: "k",
      secretAccessKey: "s",
      privateBucket: "priv",
      publicBucket: "pub",
    });
    const keys = await listKeys(client, "priv", 3);
    assert.deepEqual([...keys].sort(), [...buckets.priv!].sort());
    assert.equal(requests.length, 3, "7 nesne, sayfa başına 3 → 3 istek");
  });
});

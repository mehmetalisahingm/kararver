// KV-48 (#50) — veritabanı ↔ object storage tutarlılık denetimi (salt-okur):
//   pnpm --filter @kararver/worker media:check      (worker ile aynı DATABASE_URL ve S3_* değişkenleri)
//
// DB yedeği ve bucket'lar ayrı yedeklenir/geri yüklenir (docs/KV-48_BACKUP_RESTORE.md); restore sonrası ikisinin aynı
// ana ait olduğu buradan doğrulanır. Canlıda da periyodik çalıştırılabilir.
//
// Hata (çıkış kodu 1):
// - public_object_key dolu ama public bucket'ta nesne yok (kullanıcı kırık görsel görür)
// - processed_object_key dolu ama private bucket'ta yok (moderasyon önizlemesi/onay kopyası çalışmaz)
// - orijinal yok; yükleme tamamlanmamış PENDING kayıt hariç
// - public bucket'ta hiçbir kaydın göstermediği nesne: reddedilmiş/kaldırılmış içerik hâlâ herkese açık olabilir
// Bilgi: private bucket'ta sahipsiz nesne (yarım kalmış yükleme; temizlik ayrı iş), yüklemesi tamamlanmamış PENDING kayıt.
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { createPrismaClient } from "@kararver/db";
import type { StorageConfig } from "../src/config.ts";

export type MediaRow = {
  id: string;
  status: "PENDING" | "APPROVED" | "QUARANTINED" | "REJECTED";
  originalObjectKey: string;
  processedObjectKey: string | null;
  publicObjectKey: string | null;
};

export type MediaReport = {
  missingPublic: string[];
  missingProcessed: string[];
  missingOriginal: string[];
  publicOrphans: string[];
  privateOrphans: string[];
  pendingUploads: string[];
};

export function compareMedia(rows: MediaRow[], privateKeys: ReadonlySet<string>, publicKeys: ReadonlySet<string>): MediaReport {
  const report: MediaReport = {
    missingPublic: [],
    missingProcessed: [],
    missingOriginal: [],
    publicOrphans: [],
    privateOrphans: [],
    pendingUploads: [],
  };
  const referencedPrivate = new Set<string>();
  const referencedPublic = new Set<string>();
  for (const r of rows) {
    referencedPrivate.add(r.originalObjectKey);
    if (r.processedObjectKey) referencedPrivate.add(r.processedObjectKey);
    if (r.publicObjectKey) referencedPublic.add(r.publicObjectKey);

    if (r.publicObjectKey && !publicKeys.has(r.publicObjectKey)) report.missingPublic.push(r.id);
    if (r.processedObjectKey && !privateKeys.has(r.processedObjectKey)) report.missingProcessed.push(r.id);
    if (!privateKeys.has(r.originalObjectKey)) {
      if (r.status === "PENDING" && !r.processedObjectKey) report.pendingUploads.push(r.id);
      else report.missingOriginal.push(r.id);
    }
  }
  for (const k of publicKeys) if (!referencedPublic.has(k)) report.publicOrphans.push(k);
  for (const k of privateKeys) if (!referencedPrivate.has(k)) report.privateOrphans.push(k);
  return report;
}

export const isHealthy = (r: MediaReport) =>
  r.missingPublic.length + r.missingProcessed.length + r.missingOriginal.length + r.publicOrphans.length === 0;

export async function listKeys(client: S3Client, bucket: string, pageSize = 1000): Promise<Set<string>> {
  const keys = new Set<string>();
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: pageSize }));
    for (const o of res.Contents ?? []) if (o.Key) keys.add(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export function s3Client(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

if (import.meta.main) {
  const { loadWorkerConfig } = await import("../src/config.ts");
  const config = loadWorkerConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    const rows = await prisma.mediaAsset.findMany({
      select: { id: true, status: true, originalObjectKey: true, processedObjectKey: true, publicObjectKey: true },
    });
    const client = s3Client(config.storage);
    const [privateKeys, publicKeys] = await Promise.all([
      listKeys(client, config.storage.privateBucket),
      listKeys(client, config.storage.publicBucket),
    ]);
    const report = compareMedia(rows, privateKeys, publicKeys);
    console.log(`medya: ${rows.length} kayıt, private ${privateKeys.size} nesne, public ${publicKeys.size} nesne`);
    const line = (bad: boolean, label: string, items: string[]) =>
      console.log(`  ${items.length === 0 ? "✔" : bad ? "✖" : "ℹ"} ${label}: ${items.length}${items.length ? ` (ör. ${items.slice(0, 5).join(", ")})` : ""}`);
    line(true, "public nesnesi eksik kayıt", report.missingPublic);
    line(true, "işlenmiş kopyası eksik kayıt", report.missingProcessed);
    line(true, "orijinali eksik kayıt", report.missingOriginal);
    line(true, "public bucket'ta sahipsiz nesne", report.publicOrphans);
    line(false, "private bucket'ta sahipsiz nesne", report.privateOrphans);
    line(false, "yüklemesi tamamlanmamış PENDING kayıt", report.pendingUploads);
    console.log(isHealthy(report) ? "SONUÇ: tutarlı" : "SONUÇ: tutarsız");
    process.exitCode = isHealthy(report) ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

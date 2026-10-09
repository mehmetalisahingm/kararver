// Private bucket erişimi (TECH_DECISIONS §3.6, docs/MEDIA_MODERATION.md §7).
// API private bucket'a presigned URL üretir ve nesneyi yoklar. Public bucket'a otomatik onayda worker,
// moderatör kararında (admin.media.decide) API yazar/siler; ikisi de aynı deterministik anahtarı kullanır.
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageConfig } from "../../config.ts";

export type PresignedUpload = { url: string; headers: Record<string, string>; expiresAt: Date };
export type StoredObject = { sizeBytes: number; contentType: string | null };

export interface MediaStorage {
  /** Content-Type ve Content-Length imzaya dahildir; istemci farklı boyut/tür gönderirse storage reddeder. */
  presignUpload(key: string, file: { contentType: string; sizeBytes: number }, now: Date): Promise<PresignedUpload>;
  headPrivate(key: string): Promise<StoredObject | null>;
  presignPrivateRead(key: string, now: Date): Promise<{ url: string; expiresAt: Date }>;
  /** Moderatör onayı: işlenmiş (EXIF'siz) kopyayı private bucket'tan public bucket'a kopyalar. Tekrarı zararsızdır. */
  publishFromPrivate(privateKey: string, publicKey: string): Promise<void>;
  /** Onaylı görselin kaldırılması: public kopyayı siler. Nesne yoksa hata vermez. */
  deletePublic(publicKey: string): Promise<void>;
}

/** Worker ile aynı kural (apps/worker/src/jobs/media/job.ts publicKey): anahtar görsel id'sinden türer. */
export const publicObjectKeyFor = (mediaId: string) => `m/${mediaId}.webp`;

export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
/** MEDIA_MODERATION §7: bekleyen görselin önizlemesi kısa ömürlüdür. */
export const PREVIEW_URL_TTL_SECONDS = 5 * 60;
/** Moderasyonla sonradan kaldırılabilen public medya V1'de cache'lenmez; stale CDN/browser kopyası bırakmayız. */
export const PUBLIC_MEDIA_CACHE_CONTROL = "no-store";

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

/** S3/R2 bağlantı kurma ve istek (8 MB indirme/yükleme dahil) üst sınırları. SDK varsayılanı sınırsızdır. */
export const S3_CONNECTION_TIMEOUT_MS = 5_000;
export const S3_REQUEST_TIMEOUT_MS = 30_000;

export function createS3MediaStorage(config: StorageConfig): MediaStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    // Takılan bağlantı işi sonsuza dek bekletmesin (KV-47 ölçümü: docs/KV-47_PERFORMANCE.md → Medya).
    requestHandler: { connectionTimeout: S3_CONNECTION_TIMEOUT_MS, requestTimeout: S3_REQUEST_TIMEOUT_MS },
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const Bucket = config.privateBucket;

  return {
    async presignUpload(key, file, now) {
      const command = new PutObjectCommand({ Bucket, Key: key, ContentType: file.contentType, ContentLength: file.sizeBytes });
      const url = await getSignedUrl(client, command, {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        signableHeaders: new Set(["content-type", "content-length"]),
      });
      return {
        url,
        headers: { "Content-Type": file.contentType },
        expiresAt: new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000),
      };
    },

    async headPrivate(key) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { sizeBytes: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async presignPrivateRead(key, now) {
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: PREVIEW_URL_TTL_SECONDS });
      return { url, expiresAt: new Date(now.getTime() + PREVIEW_URL_TTL_SECONDS * 1000) };
    },

    async publishFromPrivate(privateKey, publicKey) {
      await client.send(
        new CopyObjectCommand({
          Bucket: config.publicBucket,
          Key: publicKey,
          CopySource: `${encodeURIComponent(config.privateBucket)}/${privateKey.split("/").map(encodeURIComponent).join("/")}`,
          MetadataDirective: "REPLACE",
          ContentType: "image/webp",
          CacheControl: PUBLIC_MEDIA_CACHE_CONTROL,
        }),
      );
    },

    async deletePublic(publicKey) {
      await client.send(new DeleteObjectCommand({ Bucket: config.publicBucket, Key: publicKey }));
    },
  };
}

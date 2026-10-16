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
  /** Private nesneyi okur (KVKK veri paketi, #181: şifreli paket API'de çözülür). Nesne yoksa null. */
  readPrivate(key: string): Promise<Buffer | null>;
  /** Only processed approved copies; never an original or an export package. */
  readPublic(key: string): Promise<Buffer | null>;
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
/** readPrivate üst sınırı: şifreli veri paketi (worker en çok 25 MB JSON üretir, gzip küçültür). */
export const MAX_PRIVATE_READ_BYTES = 40 * 1024 * 1024;
export const MAX_PUBLIC_READ_BYTES = 8 * 1024 * 1024;

/** Bound actual bytes too: Content-Length may be absent or incorrect. */
export async function readBoundedObject(client: S3Client, bucket: string, key: string, maxBytes: number): Promise<Buffer | null> {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = res.Body;
    if (!body) return null;
    if ((res.ContentLength ?? 0) > maxBytes) {
      (body as { destroy?: () => void }).destroy?.();
      throw new Error("Storage object exceeds read limit");
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) throw new Error("Storage object exceeds read limit");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, bytes);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

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
  const publicClient = config.publicCredentials ? new S3Client({
    endpoint: config.endpoint, region: config.region, forcePathStyle: config.forcePathStyle,
    requestHandler: { connectionTimeout: S3_CONNECTION_TIMEOUT_MS, requestTimeout: S3_REQUEST_TIMEOUT_MS },
    credentials: config.publicCredentials,
  }) : client;
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

    async readPrivate(key) {
      return readBoundedObject(client, Bucket, key, MAX_PRIVATE_READ_BYTES);
    },

    async readPublic(key) {
      return readBoundedObject(publicClient, config.publicBucket, key, MAX_PUBLIC_READ_BYTES);
    },

    async presignPrivateRead(key, now) {
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: PREVIEW_URL_TTL_SECONDS });
      return { url, expiresAt: new Date(now.getTime() + PREVIEW_URL_TTL_SECONDS * 1000) };
    },

    async publishFromPrivate(privateKey, publicKey) {
      if (config.publicCredentials) {
        // A destination-bucket key cannot authenticate CopySource in another private bucket.
        const data = await readBoundedObject(client, Bucket, privateKey, MAX_PUBLIC_READ_BYTES);
        if (!data) throw new Error("Processed media object is missing");
        await publicClient.send(new PutObjectCommand({ Bucket: config.publicBucket, Key: publicKey, Body: data,
          ContentType: "image/webp", CacheControl: PUBLIC_MEDIA_CACHE_CONTROL }));
        return;
      }
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
      await publicClient.send(new DeleteObjectCommand({ Bucket: config.publicBucket, Key: publicKey }));
    },
  };
}

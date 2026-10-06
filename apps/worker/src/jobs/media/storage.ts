// Worker'ın object storage erişimi (TECH_DECISIONS §3.6). Private: orijinal ve işlenmiş kopya;
// public: sadece onaylanmış görsel. Local: SeaweedFS, staging/prod: R2 (S3 API).
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { StorageConfig } from "../../config.ts";

export interface WorkerStorage {
  /** Nesne yoksa null. `maxBytes`'tan büyük nesne indirilmez (Error). */
  readPrivate(key: string, maxBytes: number): Promise<Buffer | null>;
  writePrivate(key: string, data: Buffer, contentType: string): Promise<void>;
  writePublic(key: string, data: Buffer, contentType: string): Promise<void>;
  deletePublic(key: string): Promise<void>;
}

export class ObjectTooLargeError extends Error {}
/** Moderasyonla sonradan kaldırılabilen public medya stale CDN/browser kopyası bırakmamalı. */
export const PUBLIC_MEDIA_CACHE_CONTROL = "no-store";

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

/** S3/R2 bağlantı kurma ve istek (8 MB indirme/yükleme dahil) üst sınırları. SDK varsayılanı sınırsızdır. */
export const S3_CONNECTION_TIMEOUT_MS = 5_000;
export const S3_REQUEST_TIMEOUT_MS = 30_000;

export function createS3WorkerStorage(config: StorageConfig): WorkerStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    // Takılan bağlantı işi sonsuza dek bekletmesin (KV-47 ölçümü: docs/KV-47_PERFORMANCE.md → Medya).
    requestHandler: { connectionTimeout: S3_CONNECTION_TIMEOUT_MS, requestTimeout: S3_REQUEST_TIMEOUT_MS },
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  return {
    async readPrivate(key, maxBytes) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: config.privateBucket, Key: key }));
        if ((res.ContentLength ?? 0) > maxBytes) {
          res.Body?.transformToWebStream().cancel();
          throw new ObjectTooLargeError(`${res.ContentLength} bayt > ${maxBytes}`);
        }
        return Buffer.from(await res.Body!.transformToByteArray());
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async writePrivate(key, data, contentType) {
      await client.send(new PutObjectCommand({ Bucket: config.privateBucket, Key: key, Body: data, ContentType: contentType }));
    },
    async writePublic(key, data, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.publicBucket,
          Key: key,
          Body: data,
          ContentType: contentType,
          CacheControl: PUBLIC_MEDIA_CACHE_CONTROL,
        }),
      );
    },
    async deletePublic(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.publicBucket, Key: key }));
    },
  };
}

// Private bucket erişimi (TECH_DECISIONS §3.6, docs/MEDIA_MODERATION.md §7).
// API sadece private bucket'a presigned URL üretir ve nesneyi yoklar; public bucket'a sadece worker yazar.
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageConfig } from "../../config.ts";

export type PresignedUpload = { url: string; headers: Record<string, string>; expiresAt: Date };
export type StoredObject = { sizeBytes: number; contentType: string | null };

export interface MediaStorage {
  /** Content-Type ve Content-Length imzaya dahildir; istemci farklı boyut/tür gönderirse storage reddeder. */
  presignUpload(key: string, file: { contentType: string; sizeBytes: number }, now: Date): Promise<PresignedUpload>;
  headPrivate(key: string): Promise<StoredObject | null>;
  presignPrivateRead(key: string, now: Date): Promise<{ url: string; expiresAt: Date }>;
}

export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
/** MEDIA_MODERATION §7: bekleyen görselin önizlemesi kısa ömürlüdür. */
export const PREVIEW_URL_TTL_SECONDS = 5 * 60;

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

export function createS3MediaStorage(config: StorageConfig): MediaStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
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
  };
}

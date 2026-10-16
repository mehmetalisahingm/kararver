// Yedek bucket'ına yükleme (S3 uyumlu: R2, Railway bucket). Anahtar yalnız PutObject yetkilidir; okuma/silme gerekmez.
// Hata mesajında adres, anahtar ya da bucket ayrıntısı yoktur (log'a düşer).
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { BackupUpload } from "./scheduled.ts";

export type BackupBucketConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export function createS3BackupUpload(config: BackupBucketConfig): BackupUpload {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 30 * 60_000 },
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return async (key, file, contentType) => {
    const size = (await stat(file)).size;
    try {
      await client.send(
        new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: createReadStream(file), ContentLength: size, ContentType: contentType }),
      );
    } catch (err) {
      const name = err instanceof Error ? err.name : "UnknownError";
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      throw new Error(`yedek yüklenemedi (${name}${status ? `, HTTP ${status}` : ""})`);
    }
  };
}

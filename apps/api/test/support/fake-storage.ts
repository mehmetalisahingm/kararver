// Testler için bellek içi private bucket ve kuyruk. Gerçek S3 uygulaması: src/modules/media/storage.ts
import type { MediaQueue } from "../../src/modules/media/queue.ts";
import { PREVIEW_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS, type MediaStorage } from "../../src/modules/media/storage.ts";

export type FakeStorage = MediaStorage & {
  /** İstemcinin presigned URL'e yaptığı PUT'u taklit eder. */
  put(key: string, sizeBytes: number, contentType: string): void;
  objects: Map<string, { sizeBytes: number; contentType: string }>;
};

export function createFakeStorage(): FakeStorage {
  const objects = new Map<string, { sizeBytes: number; contentType: string }>();
  return {
    objects,
    put(key, sizeBytes, contentType) {
      objects.set(key, { sizeBytes, contentType });
    },
    async presignUpload(key, file, now) {
      return {
        url: `http://storage.test/private/${key}?X-Amz-Signature=upload&len=${file.sizeBytes}`,
        headers: { "Content-Type": file.contentType },
        expiresAt: new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000),
      };
    },
    async headPrivate(key) {
      return objects.get(key) ?? null;
    },
    async presignPrivateRead(key, now) {
      return {
        url: `http://storage.test/private/${key}?X-Amz-Signature=read`,
        expiresAt: new Date(now.getTime() + PREVIEW_URL_TTL_SECONDS * 1000),
      };
    },
  };
}

export function createFakeQueue(): MediaQueue & { enqueued: string[] } {
  const enqueued: string[] = [];
  return {
    enqueued,
    async enqueueProcessing(mediaId) {
      enqueued.push(mediaId);
    },
  };
}

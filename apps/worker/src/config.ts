// Worker yapılandırması. Değişkenler: .env.example / .env.staging.example
// Yanlış veya eksik değerle servis açılmaz; hangi değişkenin sorunlu olduğu yazılır (değeri yazılmaz).
import path from "node:path";
import { z } from "zod";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const Env = z.object({
  APP_ENV: z.enum(["local", "test", "staging", "production"]),
  DATABASE_URL: z.string().min(1),
  JOBS_ENABLED: bool.default(true),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_FORCE_PATH_STYLE: bool.default(false),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_PRIVATE: z.string().min(3),
  S3_BUCKET_PUBLIC: z.string().min(3),
  /** apps/worker/python/requirements.txt kurulu Python yorumlayıcısı. */
  MODERATION_PYTHON: z.string().min(1).default("python3"),
  MEDIA_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
});

export type StorageConfig = {
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  privateBucket: string;
  publicBucket: string;
};

export type WorkerConfig = {
  appEnv: string;
  databaseUrl: string;
  jobsEnabled: boolean;
  storage: StorageConfig;
  moderation: { python: string; script: string };
  mediaConcurrency: number;
};

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Worker yapılandırması geçersiz → ${problems}`);
  }
  const e = parsed.data;
  return {
    appEnv: e.APP_ENV,
    databaseUrl: e.DATABASE_URL,
    jobsEnabled: e.JOBS_ENABLED,
    storage: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      privateBucket: e.S3_BUCKET_PRIVATE,
      publicBucket: e.S3_BUCKET_PUBLIC,
    },
    moderation: { python: e.MODERATION_PYTHON, script: path.resolve(import.meta.dirname, "../python/moderate.py") },
    mediaConcurrency: e.MEDIA_WORKER_CONCURRENCY,
  };
}

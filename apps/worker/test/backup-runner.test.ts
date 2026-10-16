import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { BACKUP_CRON, BACKUP_QUEUE, loadBackupRunner, registerBackupRunner } from "../src/jobs/backup/runner.ts";
import type { ScheduledBackupDeps, ScheduledBackupResult } from "../src/jobs/backup/scheduled.ts";

const keys = generateKeyPairSync("rsa", { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const env = { BACKUP_ENABLED: "true", APP_ENV: "staging", DATABASE_URL: "postgresql://user:private-password@private.internal/staging",
  BACKUP_PUBLIC_KEY: keys.publicKey.replaceAll("\n", "\\n"), BACKUP_S3_ENDPOINT: "https://backup.example.test", BACKUP_S3_BUCKET: "isolated-backups",
  BACKUP_S3_ACCESS_KEY_ID: "write-only", BACKUP_S3_SECRET_ACCESS_KEY: "private-bucket-key", S3_BUCKET_PRIVATE: "uploads", S3_BUCKET_PUBLIC: "public-media" };

test("backup defaults off, accepts only explicit true, and never requires credentials while off", () => {
  assert.equal(loadBackupRunner({}), null);
  assert.equal(loadBackupRunner({ BACKUP_ENABLED: "false" }), null);
  assert.throws(() => loadBackupRunner({ BACKUP_ENABLED: "yes" }), /BACKUP_ENABLED/);
  assert.throws(() => loadBackupRunner({ BACKUP_ENABLED: "true", APP_ENV: "staging" }), /BACKUP_PUBLIC_KEY/);
});

test("enabled backup requires a public key, separate bucket and TLS without credentials in endpoint", () => {
  const config = loadBackupRunner(env)!;
  assert.equal(config.prefix, "db/staging");
  assert.equal(config.publicKeyPem, keys.publicKey);
  for (const patch of [
    { BACKUP_PUBLIC_KEY: keys.privateKey }, { BACKUP_PUBLIC_KEY: "not-a-key" },
    { BACKUP_S3_ENDPOINT: "http://backup.example.test" }, { BACKUP_S3_ENDPOINT: "https://user:private-password@backup.example.test" },
    { BACKUP_S3_BUCKET: "uploads" }, { BACKUP_S3_BUCKET: "public-media" }, { BACKUP_S3_FORCE_PATH_STYLE: "maybe" },
  ]) {
    assert.throws(() => loadBackupRunner({ ...env, ...patch }), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes("private-password") && !error.message.includes("PRIVATE KEY"));
      return true;
    });
  }
});

function scheduler() {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  let handler!: () => Promise<void>;
  const boss = {
    unschedule: async (...args: unknown[]) => { calls.push({ name: "unschedule", args }); },
    createQueue: async (...args: unknown[]) => { calls.push({ name: "createQueue", args }); },
    schedule: async (...args: unknown[]) => { calls.push({ name: "schedule", args }); },
    work: async (...args: unknown[]) => { calls.push({ name: "work", args: args.slice(0, 2) }); handler = args[2] as () => Promise<void>; },
  } as unknown as Parameters<typeof registerBackupRunner>[0];
  return { boss, calls, run: () => handler() };
}

test("disabled backup unschedules previous cron and does not register a consumer or run a backup", async () => {
  const s = scheduler();
  assert.equal(await registerBackupRunner(s.boss, null, () => {}, async () => { throw new Error("must not run"); }), false);
  assert.deepEqual(s.calls, [{ name: "unschedule", args: [BACKUP_QUEUE] }]);
});

test("backup uses existing boss, one active job and UTC daily schedule; startup doesn't dump the DB", async () => {
  const s = scheduler(), config = loadBackupRunner(env)!;
  let runs = 0;
  const logs: unknown[] = [];
  const log: ScheduledBackupDeps["log"] = (...event) => { logs.push(event); };
  const run = async (deps: ScheduledBackupDeps) => { runs++; assert.equal(deps.databaseUrl, env.DATABASE_URL); assert.equal(deps.log, log); return {} as ScheduledBackupResult; };
  assert.equal(await registerBackupRunner(s.boss, config, log, run), true);
  assert.equal(runs, 0);
  assert.deepEqual(s.calls[0], { name: "createQueue", args: [BACKUP_QUEUE, { policy: "stately", retryLimit: 2, retryDelay: 300, expireInSeconds: 28800 }] });
  assert.deepEqual(s.calls[1], { name: "schedule", args: [BACKUP_QUEUE, BACKUP_CRON, null, { tz: "UTC" }] });
  await s.run();
  assert.equal(runs, 1);
});

test("failed backup reaches pg-boss retry without persisting upstream credential-bearing exception", async () => {
  const s = scheduler(), logs: unknown[] = [];
  await registerBackupRunner(s.boss, loadBackupRunner(env), (...event) => { logs.push(event); }, async () => { throw new Error(env.DATABASE_URL); });
  await assert.rejects(s.run(), error => {
    assert.ok(error instanceof Error && error.message.includes("backup.scheduled"));
    assert.ok(!error.message.includes("private-password") && !("cause" in error));
    return true;
  });
  assert.ok(!JSON.stringify(logs).includes("private-password"));
});

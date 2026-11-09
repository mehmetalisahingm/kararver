// #327 salt-okuma hassas içerik envanteri: doğru bulgular, yazma reddi ve CLI'ın metin sızdırmaması.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createPrismaClient, type PrismaClient } from "@kararver/db";
import { runReadOnlyTriage, withReadOnly, type TriageHit } from "../src/modules/polls/sensitive-triage.ts";
import { prismaBackend } from "./support/harness.ts";
import { resolveTestDatabaseUrl } from "./support/test-db.ts";

const backend = prismaBackend();
const url = resolveTestDatabaseUrl(path.resolve(import.meta.dirname, "../../.."));

describe("hassas içerik envanteri (postgres)", { skip: backend && url ? false : "TEST_DATABASE_URL yok (CI'da çalışır)" }, () => {
  let db: PrismaClient;
  let dir: string;
  const ids = { user: "", category: "", sensitivePoll: "", neutralPoll: "", addendum: "", sensitiveComment: "", neutralComment: "" };
  const SECRET_TEXT = "Hangisisin TRIAGE-METNI";

  before(async () => {
    await (await backend!.create()).close?.();
    db = createPrismaClient(url!);
    dir = await mkdtemp(path.join(tmpdir(), "kv-triage-"));
    const tag = randomUUID().replaceAll("-", "").slice(0, 10);
    ids.user = (await db.user.create({
      data: { email: `triage-${tag}@example.test`, emailNormalized: `triage-${tag}@example.test`, username: `tr${tag}`, usernameNormalized: `tr${tag}`, displayName: "Triage", passwordHash: "!test" },
    })).id;
    ids.category = (await db.category.create({ data: { slug: `triage-${tag}`, name: "Triage testi" } })).id;
    const poll = (title: string, labels: string[]) => db.poll.create({
      data: {
        authorId: ids.user, categoryId: ids.category, publicId: randomUUID().replaceAll("-", "").slice(0, 12), slug: "triage", title,
        closesAt: new Date("2031-01-01T00:00:00Z"), options: { create: labels.map((label, position) => ({ position, label })) },
      },
      select: { id: true },
    });
    // API (#326) artık bunları kabul etmez; bu satırlar kuraldan ÖNCE yazılmış eski içeriği temsil eder.
    ids.sensitivePoll = (await poll(`${SECRET_TEXT}?`, ["Alevi", "Sünni"])).id;
    ids.neutralPoll = (await poll("Hangi kahveyi seversin?", ["Filtre", "Türk kahvesi"])).id;
    ids.addendum = (await db.pollAddendum.create({ data: { pollId: ids.neutralPoll, body: "Bu arada siyasi görüşün ne?" } })).id;
    ids.sensitiveComment = (await db.comment.create({ data: { pollId: ids.neutralPoll, authorId: ids.user, body: "Sen kime oy verdin?" } })).id;
    ids.neutralComment = (await db.comment.create({ data: { pollId: ids.neutralPoll, authorId: ids.user, body: "Ben filtre kahve içerim." } })).id;
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
    if (!db) return;
    await db.comment.deleteMany({ where: { authorId: ids.user } });
    await db.pollAddendum.deleteMany({ where: { pollId: { in: [ids.sensitivePoll, ids.neutralPoll] } } });
    await db.pollOption.deleteMany({ where: { pollId: { in: [ids.sensitivePoll, ids.neutralPoll] } } });
    await db.poll.deleteMany({ where: { authorId: ids.user } });
    await db.category.deleteMany({ where: { id: ids.category } });
    await db.user.deleteMany({ where: { id: ids.user } });
    await db.$disconnect();
  });

  test("eski anket, ek açıklama ve yorumlardaki hassas veri istekleri bulunur; nötr içerik bulunmaz", async () => {
    const hits: TriageHit[] = [];
    const summary = await runReadOnlyTriage(db, (h) => void hits.push(h));
    const mine = new Map(hits.filter((h) => Object.values(ids).includes(h.id)).map((h) => [h.id, h]));
    assert.deepEqual(
      [...mine.values()].map((h) => [h.kind, h.category]).sort(),
      [["addendum", "political"], ["comment", "political"], ["poll", "belief"]],
    );
    assert.equal(mine.get(ids.sensitivePoll)?.field, "options.0.label");
    assert.equal(mine.get(ids.sensitivePoll)?.status, "ACTIVE");
    assert.equal(mine.has(ids.neutralPoll), false);
    assert.equal(mine.has(ids.neutralComment), false);
    assert.ok(summary.poll.scanned >= 2 && summary.comment.scanned >= 2 && summary.addendum.scanned >= 1);
    assert.ok(summary.poll.flagged >= 1 && summary.poll.byCategory.belief! >= 1);
  });

  test("tarama transaction'ı salt okuma: yazma denemesi PostgreSQL tarafından reddedilir", async () => {
    await assert.rejects(
      withReadOnly(db, (tx) => tx.pollAddendum.create({ data: { pollId: ids.neutralPoll, body: "yazılmamalı" } })),
      /read-only transaction|25006/,
    );
    assert.equal(await db.pollAddendum.count({ where: { pollId: ids.neutralPoll, body: "yazılmamalı" } }), 0);
  });

  test("CLI metin basmaz, listeyi yalnız yeni 0600 dosyaya yazar ve var olan dosyanın üzerine yazmaz", async () => {
    const cli = path.resolve(import.meta.dirname, "../src/modules/polls/sensitive-triage-cli.ts");
    const out = path.join(dir, "hits.csv");
    const env = { PATH: process.env.PATH ?? "", TRIAGE_DATABASE_URL: url! };
    const run = spawnSync(process.execPath, [cli, "--out", out], { encoding: "utf8", env });
    assert.equal(run.status, 0, run.stderr);
    const printed = run.stdout + run.stderr;
    for (const leaked of [SECRET_TEXT, "Alevi", "kime oy verdin", "siyasi görüşün", "example.test", "postgresql:"]) {
      assert.ok(!printed.includes(leaked), `stdout/stderr '${leaked}' içermemeli`);
    }
    const parsed = JSON.parse(run.stdout.trim().split("\n").at(-1)!);
    assert.equal(parsed.readOnly, true);
    const csv = await readFile(out, "utf8");
    assert.ok(csv.startsWith("kind,id,pollId,status,category,field\n"));
    assert.ok(csv.includes(`poll,${ids.sensitivePoll},${ids.sensitivePoll},ACTIVE,belief,options.0.label`));
    assert.ok(!csv.includes(SECRET_TEXT) && !csv.includes("Alevi"), "liste metin içermez");
    if (process.platform !== "win32") assert.equal((await stat(out)).mode & 0o777, 0o600);

    const again = spawnSync(process.execPath, [cli, "--out", out], { encoding: "utf8", env });
    assert.notEqual(again.status, 0, "var olan liste dosyası ezilmez");
    assert.equal(await readFile(out, "utf8"), csv);

    const noUrl = spawnSync(process.execPath, [cli], { encoding: "utf8", env: { PATH: env.PATH } });
    assert.equal(noUrl.status, 2);
  });
});

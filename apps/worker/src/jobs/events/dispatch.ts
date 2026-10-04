// Olay dağıtıcısı — KV-21 PR-2 (#23). Outbox'taki olayları (domain_events) kayıtlı tüketicilere verir.
// Kurallar: docs/DATA_MODEL.md §9.4, docs/KV-21_NOTIFICATIONS.md §5.
//
// İki adım:
// 1) Dağıtma (dispatchBatch): dağıtılmamış olaylar FOR UPDATE SKIP LOCKED ile alınır (iki dağıtıcı aynı olayı alamaz,
//    producer'ın commit etmemiş satırı görünmez); tipine abone her tüketici için bir teslim satırı açılır
//    (PK event_id + consumer, ON CONFLICT DO NOTHING) ve dispatched_at dolar. Abonesi olmayan olay teslimsiz dağıtılmış
//    sayılır. Ayrıştırılamayan satır dispatch_error alır: döngüye girmez, saklamada silinmez.
// 2) İşleme (processNext): vadesi gelen teslim SKIP LOCKED ile kiralanır: deneme sayısı handler'dan ÖNCE artar ve
//    next_attempt_at kira süresi kadar ileri atılır (çökme de deneme sayılır; kira dolunca satır başka işleyiciye geçer).
//    İşleme transaction'ı önce teslimi DONE yapar (yalnız kiradaki deneme numarası hâlâ geçerliyse: fencing), sonra
//    tüketiciyi aynı transaction'da çağırır. Hata olursa ikisi de geri alınır ve ayrı transaction'da backoff ya da
//    DEAD yazılır. Bir tüketicinin hatası yalnız kendi teslim satırını etkiler.
//
// Kilit: dağıtıcı yalnız outbox satırlarını kilitler ve kilitli satırı beklemez (SKIP LOCKED); KV-33'ün users /
// user_roles kilitleriyle bekleme ilişkisi yoktur. İşleme transaction'ında kilit sırası: teslim satırı, sonra
// tüketicinin satırları.
import { setTimeout as sleep } from "node:timers/promises";
import { parseEvent, type DomainEvent } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { PermanentEventError, type EventConsumer, type EventLog } from "./consumers.ts";

/** Bir dağıtma transaction'ında en fazla alınan olay. */
export const DISPATCH_BATCH = 100;
/** Kira: tüketici transaction'ının süre sınırından (HANDLER_TIMEOUT_MS) büyük olmalı. */
export const LEASE_MS = 2 * 60_000;
export const HANDLER_TIMEOUT_MS = 30_000;
/** Toplam deneme; sonuncusu da başarısız olursa DEAD. */
export const MAX_ATTEMPTS = 8;
/** n. başarısız denemeden sonraki bekleme (n = 1..7); toplam ≈ 4,7 saat. */
export const RETRY_DELAYS_MS = Object.freeze([10_000, 30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000, 3 * 60 * 60_000]);
const ERROR_MAX = 1000;

export type DispatchDeps = {
  prisma: PrismaClient;
  consumers: readonly EventConsumer[];
  now: () => Date;
  log: EventLog;
  /** Sadece test: teslim kiralandıktan sonra, işleme transaction'ından önce çağrılır. */
  afterClaim?: (claim: Claim) => Promise<void>;
};

type EventRow = {
  id: string;
  type: string;
  version: number;
  occurredAt: Date;
  actorId: string | null;
  subjectType: string;
  subjectId: string;
  payload: unknown;
};

const errorText = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, ERROR_MAX);

/** Satırı olaya çevirir; zarf ve payload contracts parseEvent ile yeniden doğrulanır. */
export function eventFromRow(row: EventRow): DomainEvent {
  return parseEvent({
    version: row.version,
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    actorId: row.actorId,
    subject: { type: row.subjectType, id: row.subjectId },
    payload: row.payload,
  });
}

const eventColumns = `id::text AS id, type, version, occurred_at AS "occurredAt", actor_id::text AS "actorId",
  subject_type AS "subjectType", subject_id AS "subjectId", payload`;

export type DispatchResult = { events: number; deliveries: number; unparseable: number };

export async function dispatchBatch(deps: DispatchDeps, batchSize = DISPATCH_BATCH): Promise<DispatchResult> {
  const now = deps.now();
  return deps.prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<EventRow[]>(
      `SELECT ${eventColumns} FROM domain_events WHERE dispatched_at IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      batchSize,
    );
    const result: DispatchResult = { events: rows.length, deliveries: 0, unparseable: 0 };
    const dispatched: string[] = [];
    for (const row of rows) {
      let event: DomainEvent;
      try {
        event = eventFromRow(row);
      } catch (err) {
        result.unparseable++;
        await tx.domainEvent.update({ where: { id: row.id }, data: { dispatchedAt: now, dispatchError: errorText(err) } });
        deps.log("error", "olay ayrıştırılamadı, dağıtılmadı", { eventId: row.id, type: row.type, error: errorText(err) });
        continue;
      }
      const consumers = deps.consumers.filter((c) => c.types.includes(event.type));
      if (consumers.length > 0) {
        const { count } = await tx.eventDelivery.createMany({
          data: consumers.map((c) => ({ eventId: event.id, consumer: c.name, nextAttemptAt: now })),
          skipDuplicates: true,
        });
        result.deliveries += count;
      }
      dispatched.push(row.id);
    }
    if (dispatched.length > 0) await tx.domainEvent.updateMany({ where: { id: { in: dispatched } }, data: { dispatchedAt: now } });
    return result;
  }, { maxWait: 10_000, timeout: 30_000 });
}

export type Claim = { eventId: string; consumer: string; attempt: number };

/** Vadesi gelen bir teslimi kiralar (deneme +1, vade = şimdi + kira). Yalnız bu işleyicinin tanıdığı tüketiciler. */
async function claimNext(deps: DispatchDeps): Promise<Claim | null> {
  const names = deps.consumers.map((c) => c.name);
  if (names.length === 0) return null;
  const now = deps.now();
  return deps.prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ eventId: string; consumer: string; attempts: number }[]>`
      SELECT event_id::text AS "eventId", consumer, attempts FROM domain_event_deliveries
      WHERE status = 'PENDING' AND next_attempt_at <= ${now.toISOString()}::timestamptz AND consumer = ANY(${names}::text[])
      ORDER BY next_attempt_at, event_id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!row) return null;
    await tx.$executeRaw`
      UPDATE domain_event_deliveries SET attempts = attempts + 1, next_attempt_at = ${new Date(now.getTime() + LEASE_MS).toISOString()}::timestamptz
      WHERE event_id = ${row.eventId}::uuid AND consumer = ${row.consumer}`;
    return { eventId: row.eventId, consumer: row.consumer, attempt: row.attempts + 1 };
  }, { maxWait: 10_000, timeout: 10_000 });
}

class LeaseLost extends Error {
  override name = "LeaseLost";
}

export type ProcessOutcome = "none" | "done" | "retry" | "dead" | "lost";

export async function processNext(deps: DispatchDeps): Promise<ProcessOutcome> {
  const claim = await claimNext(deps);
  if (!claim) return "none";
  const { eventId, consumer: name, attempt } = claim;
  const consumer = deps.consumers.find((c) => c.name === name)!;
  await deps.afterClaim?.(claim);
  try {
    await deps.prisma.$transaction(async (tx) => {
      // Fencing: kira dolup satır başka işleyiciye geçtiyse deneme numarası değişmiştir; bu işleyici hiçbir şey yazmaz.
      const marked = await tx.$executeRaw`
        UPDATE domain_event_deliveries SET status = 'DONE', processed_at = ${deps.now().toISOString()}::timestamptz
        WHERE event_id = ${eventId}::uuid AND consumer = ${name} AND status = 'PENDING' AND attempts = ${attempt}`;
      if (marked !== 1) throw new LeaseLost(`${name}:${eventId} deneme ${attempt}`);
      const [row] = await tx.$queryRawUnsafe<EventRow[]>(`SELECT ${eventColumns} FROM domain_events WHERE id = $1::uuid`, eventId);
      if (!row) throw new PermanentEventError("olay satırı yok");
      let event: DomainEvent;
      try {
        event = eventFromRow(row);
      } catch (err) {
        throw new PermanentEventError(errorText(err));
      }
      await consumer.handle(event, { tx, attempt, log: deps.log });
    }, { maxWait: 10_000, timeout: HANDLER_TIMEOUT_MS });
    return "done";
  } catch (err) {
    if (err instanceof LeaseLost) {
      deps.log("warn", "olay teslimi kirası başka işleyiciye geçti; yazılmadı", { eventId, consumer: name, attempt });
      return "lost";
    }
    return recordFailure(deps, claim, err);
  }
}

async function recordFailure(deps: DispatchDeps, { eventId, consumer, attempt }: Claim, err: unknown): Promise<ProcessOutcome> {
  const permanent = err instanceof PermanentEventError;
  const dead = permanent || attempt >= MAX_ATTEMPTS;
  const now = deps.now();
  const next = dead ? now : new Date(now.getTime() + RETRY_DELAYS_MS[attempt - 1]!);
  const error = errorText(err);
  const updated = await deps.prisma.$executeRaw`
    UPDATE domain_event_deliveries
    SET status = CASE WHEN ${dead} THEN 'DEAD'::event_delivery_status ELSE 'PENDING'::event_delivery_status END,
        last_error = ${error}, next_attempt_at = ${next.toISOString()}::timestamptz
    WHERE event_id = ${eventId}::uuid AND consumer = ${consumer} AND status = 'PENDING' AND attempts = ${attempt}`;
  if (updated !== 1) {
    deps.log("warn", "olay teslimi kirası başka işleyiciye geçti; hata yazılmadı", { eventId, consumer, attempt, error });
    return "lost";
  }
  if (dead) {
    deps.log("error", "olay teslimi DEAD", { eventId, consumer, attempt, permanent, error });
    return "dead";
  }
  deps.log("warn", "olay teslimi başarısız, yeniden denenecek", { eventId, consumer, attempt, nextAttemptAt: next.toISOString(), error });
  return "retry";
}

export type LoopDeps = DispatchDeps & {
  signal?: AbortSignal;
  /** Döngünün en uzun süresi (gerçek saat). */
  maxMs: number;
  /** İş yokken bekleme. */
  idleMs?: number;
  /** Bir turda en fazla işlenen teslim (dağıtma aç kalmasın). */
  processPerTurn?: number;
};

export type LoopResult = { turns: number; dispatched: number; outcomes: Record<ProcessOutcome, number> };

/**
 * events.dispatch job'unun gövdesi: maxMs dolana veya durdurulana kadar dağıt → işle → iş yoksa bekle.
 * Bir turdaki beklenmeyen hata (ör. bağlantı) loglanır, döngü bekleyip devam eder.
 */
export async function runDispatchLoop(deps: LoopDeps): Promise<LoopResult> {
  const started = performance.now();
  const idleMs = deps.idleMs ?? 1000;
  const perTurn = deps.processPerTurn ?? 50;
  const result: LoopResult = { turns: 0, dispatched: 0, outcomes: { none: 0, done: 0, retry: 0, dead: 0, lost: 0 } };
  while (!deps.signal?.aborted && performance.now() - started < deps.maxMs) {
    result.turns++;
    let busy = false;
    try {
      const d = await dispatchBatch(deps);
      result.dispatched += d.events;
      busy = d.events > 0;
      for (let i = 0; i < perTurn && !deps.signal?.aborted; i++) {
        const outcome = await processNext(deps);
        if (outcome === "none") break;
        result.outcomes[outcome]++;
        busy = true;
      }
    } catch (err) {
      deps.log("error", "events.dispatch turu başarısız", { error: errorText(err) });
    }
    if (!busy) await sleep(idleMs, undefined, { signal: deps.signal }).catch(() => undefined);
  }
  return result;
}

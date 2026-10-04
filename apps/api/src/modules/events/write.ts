// Olay outbox'ına yazım — KV-21 PR-2 (#23). Kritik işlem bunu kendi transaction'ının içinden çağırır (audit/write.ts ile
// aynı kalıp): işlem commit olursa olay vardır, geri alınırsa yoktur. Dağıtım worker'dadır (apps/worker/src/jobs/events).
//
// Olay contracts `parseEvent` ile yeniden doğrulanır (zarf, UUIDv7, konu tipi, aktör kuralı, strict payload): createEvent
// dışında elle kurulmuş nesne de yazılmadan reddedilir. İhlal TypeError'dur (kod hatası); çağıranın transaction'ı onunla
// birlikte geri alınır.
//
// Doğal anahtarı (contracts naturalKey) olan olay ikinci kez yazılmaz: aynı anahtarla satır varsa INSERT hiçbir şey
// yapmaz ve `written: false` döner; mutation devam eder (aynı iş olgusu zaten outbox'ta). Bu koruma işlenmiş satırlar
// saklanırken (30 gün) geçerlidir; kalıcı koruma tüketicinin kendi anahtarıdır (docs/DATA_MODEL.md §9.4).
import { naturalKey, parseEvent, type DomainEvent } from "@kararver/contracts";
import type { Prisma } from "@kararver/db";

export type EventTx = {
  domainEvent: { createMany(args: { data: Prisma.DomainEventCreateManyInput[]; skipDuplicates: true }): PromiseLike<{ count: number }> };
};

export async function writeEvent(tx: EventTx, event: DomainEvent): Promise<{ written: boolean }> {
  const e = parseEvent(event);
  const { count } = await tx.domainEvent.createMany({
    data: [
      {
        id: e.id,
        type: e.type,
        version: e.version,
        occurredAt: new Date(e.occurredAt),
        actorId: e.actorId,
        subjectType: e.subject.type,
        subjectId: e.subject.id,
        payload: e.payload as Prisma.InputJsonObject,
        naturalKey: naturalKey(e),
      },
    ],
    skipDuplicates: true,
  });
  return { written: count === 1 };
}

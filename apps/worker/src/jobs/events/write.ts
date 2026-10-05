// Worker'ın olay yazıcısı — KV-21 PR-4 (#23). API'deki writeEvent ile aynı iş (apps/api/src/modules/events/write.ts);
// worker apps/api'yi import etmediği için burada küçük bir eşi var (writeWorkerAudit emsali). Doğrulama tek yerdedir:
// contracts parseEvent (zarf, UUIDv7, konu tipi, aktör kuralı, strict payload) ve naturalKey. Kolon eşlemesinin API ile
// aynı kaldığını apps/worker/test/kv21-producers.test.ts sabitler.
//
// Çağıranın transaction'ında yazar: job'un değişikliği commit olursa olay vardır, geri alınırsa yoktur. Doğal anahtarı
// olan olay ikinci kez yazılmaz (ON CONFLICT DO NOTHING → written: false).
import { naturalKey, parseEvent, type DomainEvent } from "@kararver/contracts";
import type { Prisma } from "@kararver/db";

export async function writeWorkerEvent(tx: Prisma.TransactionClient, event: DomainEvent): Promise<{ written: boolean }> {
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

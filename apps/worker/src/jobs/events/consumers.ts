// Olay tüketicisi arayüzü — KV-21 PR-2 (#23). Dağıtıcı (dispatch.ts) her olayı tipine abone olan tüketicilere ayrı bir
// teslim satırıyla verir; PR-3'teki bildirim adapter'ları bu arayüze takılır.
//
// Tüketici kuralları (docs/KV-21_NOTIFICATIONS.md §5):
// - handle teslim transaction'ında çalışır; DB yazımı teslimin DONE işaretiyle birlikte commit olur, hata olursa ikisi de
//   geri alınır ve teslim yeniden denenir. Teslim en az bir kezdir: handle idempotent olmalıdır.
// - Sıralama garantisi yoktur (contracts eventDelivery.ordering): tüketici delta uygulamaz, güncel durumu DB'den okur
//   veya tekdüze bir alanla (occurredAt, version) eskiyi yok sayar.
// - users satırı kilitlemesi gerekirse yalnız FOR NO KEY UPDATE ve KV-33 sırası (hedef kullanıcı, sonra SUPER_ADMIN
//   satırları); asla FOR UPDATE (FK'lerin FOR KEY SHARE'i ile çakışır, KV-33 §4).
// - Yeniden denemenin anlamı olmayan hata (geçersiz veri) PermanentEventError ile bildirilir: teslim hemen DEAD olur.
import { isEventType, type DomainEvent, type EventType } from "@kararver/contracts";
import type { Prisma } from "@kararver/db";

export type EventLog = (level: "info" | "warn" | "error", message: string, fields: Record<string, unknown>) => void;

export type EventConsumer = {
  /** Teslim satırının consumer'ı; contracts dedupeKey handler kuralı (/^[a-z][a-z0-9.-]*$/). */
  name: string;
  types: readonly EventType[];
  handle(event: DomainEvent, ctx: { tx: Prisma.TransactionClient; attempt: number; log: EventLog }): Promise<void>;
};

/** Yeniden denenmeyecek hata: teslim ilk seferde DEAD olur. */
export class PermanentEventError extends Error {
  override name = "PermanentEventError";
}

const CONSUMER_NAME = /^[a-z][a-z0-9.-]*$/;

/** Açılışta kayıt doğrulaması: ad biçimi ve tekilliği, en az bir katalog tipi. */
export function assertConsumers(consumers: readonly EventConsumer[]): readonly EventConsumer[] {
  const names = new Set<string>();
  for (const c of consumers) {
    if (!CONSUMER_NAME.test(c.name) || c.name.length > 64) throw new TypeError(`Geçersiz tüketici adı: ${c.name}`);
    if (names.has(c.name)) throw new TypeError(`Tüketici adı tekrar ediyor: ${c.name}`);
    names.add(c.name);
    if (c.types.length === 0 || !c.types.every(isEventType)) throw new TypeError(`Tüketici ${c.name}: olay tipleri katalogda olmalı`);
  }
  return Object.freeze([...consumers]);
}

// Üretimde kayıtlı tüketiciler: registry.ts (tüketici modülleri bu dosyayı import eder; döngü olmasın diye ayrı).

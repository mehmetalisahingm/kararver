// trends.refresh katsayıları — KV-28 (#30). Formüller ve gerekçeler: docs/KV-28_TRENDS.md.
//
// Katsayılar sürümlüdür: herhangi biri değişirse CALCULATION_VERSION artırılır. Her çalıştırma sürümünü
// trend_runs.calculation_version'a yazar; aynı sürüm aynı veriden aynı sıralamayı verir (açıklanabilirlik).
// Değerler Faruk'un önerisidir (PRODUCT_TEAM_PLAN §8 formül mantığını verir, sayı vermez); Mehmet teyidi bekliyor.
// Admin'den değiştirme KV-40 (#42) ayar servisiyle; settings.ts aynı görüntüden katsayıları ve hesap sürümünü üretir.
import { defaultSettings } from "@kararver/contracts";

export const TRENDS_QUEUE = "trends.refresh";
/** Her 5 dakikada (TECH_DECISIONS §3.5). */
export const TRENDS_CRON = "*/5 * * * *";
export const SLOT_MINUTES = 5;

/** Hesaplanan formatlar: KV-28 dört format, KV-29 WEEKLY_MOVERS (günlük snapshot'lardan). */
export const COMPUTED_FORMATS = ["DAILY_RISING", "WEEKLY_RISING", "WEEKLY_MOST_VOTED", "WEEKLY_MOST_DISCUSSED", "WEEKLY_MOVERS"] as const;
export type ComputedFormat = (typeof COMPUTED_FORMATS)[number];

export const TREND_CONFIG = {
  calculationVersion: 1,
  /** Bir çalıştırmada saklanan en fazla sıra (kategori filtresi bunun içinden süzer). */
  topN: 500,
  /** Bir hesabın bir ankete pencere içinde yazdığı yorumlardan en fazla kaçı sayılır. */
  commentCapPerUser: 3,
  /** Pencere uzunluğu (saat). */
  windowHours: { DAILY_RISING: 24, WEEKLY_RISING: 168, WEEKLY_MOST_VOTED: 168, WEEKLY_MOST_DISCUSSED: 168, WEEKLY_MOVERS: 168 },
  daily: {
    /** etkileşim = oy veren + commentWeight × yorum (sınırlı) + commenterWeight × yorumcu */
    commentWeight: 0.5,
    commenterWeight: 1,
    /** puan = etkileşim / (yaş_saat + ageOffsetHours) ^ gravity */
    ageOffsetHours: 2,
    gravity: 1.2,
    /** Listeye girmek için en az (oy veren + yorumcu). */
    minParticipants: 5,
  },
  weeklyRising: {
    /** puan = yeni oy × yeni oy / (önceki oy + yeni oy + smoothing) */
    smoothing: 10,
    minNewVoters: 10,
  },
  mostVoted: { minVoters: 1 },
  mostDiscussed: {
    /** puan = yorum (sınırlı) + commenterWeight × benzersiz yorumcu */
    commenterWeight: 2,
    minCommenters: 1,
  },
  /**
   * Haftanın Değişkenleri eşikleri: sistem ayarları (KV-04 kayıt defteri, DATA_MODEL §8.3). KV-40 gelene kadar
   * kayıttaki resmî varsayılan: her iki pencere sonunda ≥ 30 geçerli oy, ikinci pencerede ≥ 10 benzersiz aktif hesap.
   */
  movers: {
    minVotes: defaultSettings().values["trends.moversMinVotes"] as number,
    minActiveAccounts: defaultSettings().values["trends.moversMinActiveAccounts"] as number,
  },
  /** RUNNING kalmış çalıştırma bu süreden sonra FAILED sayılır (çöken worker). */
  staleRunMinutes: 15,
  /** Bu süreden eski çalıştırmalar silinir; her formatın son başarılı çalıştırması korunur. */
  retentionHours: 24,
} as const;

/** Pencere sonu: saatin 5 dakikalık dilime aşağı yuvarlanmışı. Aynı dilimdeki tekrar çalıştırma aynı pencereyi alır. */
export function slotEnd(now: Date): Date {
  const ms = SLOT_MINUTES * 60 * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

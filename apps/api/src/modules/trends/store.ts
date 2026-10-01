// Trend listelerinin veri erişimi — KV-28 (#30). Üretim uygulaması: prisma-store.ts.
// Sıralamayı worker'daki trends.refresh job'u yazar (apps/worker/src/jobs/trends); API sadece okur.

export type TrendFormatId = "DAILY_RISING" | "WEEKLY_RISING" | "WEEKLY_MOST_VOTED" | "WEEKLY_MOST_DISCUSSED" | "WEEKLY_MOVERS";

export type TrendRunMeta = {
  id: string;
  format: TrendFormatId;
  calculationVersion: number;
  windowStart: Date;
  windowEnd: Date;
  finishedAt: Date;
};

/** Çalıştırmadaki bir satır; visible: şu an herkese görünür ve trendden çıkarılmamış. */
export type TrendEntry = { pollId: string; visible: boolean };

export interface TrendStore {
  /** Formatın güncel (en yeni pencere) başarılı çalıştırması; yoksa null. */
  latestRun(format: TrendFormatId): Promise<TrendRunMeta | null>;
  /** Çalıştırmanın sıralaması (rank artan), kategori filtresiyle. */
  entries(runId: string, categoryId: string | null): Promise<TrendEntry[]>;
}

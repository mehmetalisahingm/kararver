// KV-36 (#38) ürün analitiği. Metrikler kopyalanmış sayaçlardan değil gerçek kaynak tablolardan
// türetilir; böylece retry/tekrar işleme aynı olguyu ikinci kez saymaz.
export type AnalyticsRange = "7d" | "30d";

export type GrowthMetric = { current: number; previous: number; percentChange: number | null };
export type AnalyticsSeriesPoint = {
  localDate: string;
  activeUsers: number;
  registrations: number;
  polls: number;
  votes: number;
  comments: number;
};

export type AnalyticsSnapshot = {
  range: AnalyticsRange;
  generatedAt: Date;
  totals: {
    users: number;
    polls: number;
    votes: number;
    comments: number;
    openReports: number;
    quarantinedMedia: number;
    highRiskMedia: number;
    shares: number;
  };
  activity: { dau: number; wau: number };
  growth: {
    registrations: GrowthMetric;
    polls: GrowthMetric;
    votes: GrowthMetric;
    comments: GrowthMetric;
  };
  firstContribution: { eligibleUsers: number; contributors: number; ratePct: number | null };
  d7Retention: { matureUsers: number; retainedUsers: number; ratePct: number | null };
  sharing: { eligiblePolls: number; sharedPolls: number; createdLinks: number; ratePct: number | null };
  series: AnalyticsSeriesPoint[];
};

export interface AnalyticsStore {
  snapshot(range: AnalyticsRange, now: Date): Promise<AnalyticsSnapshot>;
}

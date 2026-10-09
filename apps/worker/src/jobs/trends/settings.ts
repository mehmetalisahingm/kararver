import type { SettingKey } from "@kararver/contracts";
import type { WorkerSettings } from "../../settings.ts";
import { TREND_CONFIG } from "./config.ts";

export type TrendScoringSettings = {
  calculationVersion: number;
  commentCapPerUser: number;
  daily: { commentWeight: number; commenterWeight: number; ageOffsetHours: number; gravity: number; minParticipants: number };
  weeklyRising: { smoothing: number; minNewVoters: number };
  mostVoted: { minVoters: number };
  mostDiscussed: { commenterWeight: number; minCommenters: number };
  movers: { minVotes: number; minActiveAccounts: number };
};

/** Tek DB görüntüsü: katsayılar ve sürümleri iş devam ederken birbirinden kopmaz. */
export async function loadTrendSettings(settings: WorkerSettings): Promise<TrendScoringSettings> {
  const { values, versions } = await settings.snapshot();
  let revision = 0;
  const value = (key: SettingKey) => {
    revision += versions[key] ?? 0;
    return values[key] as number;
  };
  const config = {
    commentCapPerUser: value("trends.commentCapPerUser"),
    daily: {
      commentWeight: value("trends.dailyCommentWeightPercent") / 100,
      commenterWeight: value("trends.dailyCommenterWeightPercent") / 100,
      ageOffsetHours: value("trends.dailyAgeOffsetHours"),
      gravity: value("trends.dailyGravityPercent") / 100,
      minParticipants: value("trends.dailyMinParticipants"),
    },
    weeklyRising: { smoothing: value("trends.weeklySmoothing"), minNewVoters: value("trends.weeklyMinNewVoters") },
    mostVoted: { minVoters: value("trends.mostVotedMinVoters") },
    mostDiscussed: {
      commenterWeight: value("trends.discussedCommenterWeightPercent") / 100,
      minCommenters: value("trends.discussedMinCommenters"),
    },
    movers: { minVotes: value("trends.moversMinVotes"), minActiveAccounts: value("trends.moversMinActiveAccounts") },
  };
  // Ayar satırları silinmez; her düzenleme version'ı artırır. Geri alma da yeni düzenlemedir.
  // Formül sürümlerine ayrı milyonluk aralıklar ayırarak kod değişikliğiyle çakışmayı önler.
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= 1_000_000) throw new Error("Trend ayar sürümü sınırı aşıldı");
  const calculationVersion = (TREND_CONFIG.calculationVersion - 1) * 1_000_000 + revision + 1;
  if (calculationVersion > 2_147_483_647) throw new Error("Trend hesap sürümü sınırı aşıldı");
  return { ...config, calculationVersion };
}

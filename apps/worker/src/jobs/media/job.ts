// media.process — KV-16 (#18). Akış ve kurallar: docs/MEDIA_MODERATION.md §5–§7.
// orijinal (private) → imza kontrolü → re-encode + EXIF temizleme → işlenmiş kopya (private)
// → moderasyon → LOW: public bucket + APPROVED · MEDIUM/HIGH/model hatası: QUARANTINED · geçersiz: REJECTED
// Yasaklı görsel (KV-38): sha256 birebir eşleşirse REJECTED (BANNED_HASH), dHash çok yakınsa QUARANTINED (BANNED_SIMILAR).
// Fail-closed: hiçbir hata yolu görseli yayına almaz.
import { createHash } from "node:crypto";
import { InvalidImageError, reencodeImage, sniffImageType } from "./image.ts";
import { dHash, hamming, NEAR_DUPLICATE_MAX_DISTANCE } from "./phash.ts";
import { ModerationFailedError, ModerationTimeoutError, type Moderator } from "./moderator.ts";
import { assessRisk, DEFAULT_THRESHOLDS, type RiskThresholds } from "./policy.ts";
import { ObjectTooLargeError, type WorkerStorage } from "./storage.ts";
import type { MediaFacts, MediaJobStore, Outcome } from "./store.ts";

/** API'deki kuyruk tanımıyla aynı (apps/api/src/modules/media/queue.ts); ilk oluşturan kazanır. */
export const MEDIA_PROCESS_QUEUE = "media.process";
export const MEDIA_QUEUE_OPTIONS = { policy: "stately", retryLimit: 3, retryDelay: 30, retryBackoff: true } as const;
/** İlk deneme + retryLimit. Son denemede de beklenmeyen hata olursa görsel karantinaya alınır. */
export const MAX_ATTEMPTS = 1 + MEDIA_QUEUE_OPTIONS.retryLimit;
export const MODERATION_MODEL = "nudenet-3.4.2-320n";

export type MediaJobDeps = {
  store: MediaJobStore;
  storage: WorkerStorage;
  moderator: Moderator;
  now: () => Date;
  /** Sistem ayarı media.maxBytes (KV-40); worker indirmeden önce de uygular. */
  maxBytes: () => Promise<number>;
  /** Risk eşikleri: sabit değer (testler) veya her işte okunan ayar (media.risk*Percent, KV-38). Verilmezse varsayılan. */
  thresholds?: RiskThresholds | (() => Promise<RiskThresholds>);
  log: (message: string, fields: Record<string, unknown>) => void;
};

export type JobResult = "SKIPPED" | Outcome["status"];

export const processedKey = (id: string) => `processed/${id}.webp`;
export const publicKey = (id: string) => `m/${id}.webp`;

export async function processMedia(mediaId: string, deps: MediaJobDeps): Promise<JobResult> {
  const media = await deps.store.claim(mediaId);
  if (!media) return "SKIPPED";

  let outcome: Outcome;
  let approvedData: Buffer | null = null;
  try {
    ({ outcome, approvedData } = await decide(media.id, media.originalObjectKey, deps));
  } catch (err) {
    // Geçici hata (storage/DB): pg-boss yeniden dener. Son denemede görsel beklemede kalmaz, incelemeye düşer.
    if (media.processingAttempts < MAX_ATTEMPTS) throw err;
    deps.log("media.process son deneme başarısız, karantina", { mediaId, error: String(err) });
    outcome = { status: "QUARANTINED", error: "PROCESSING_FAILED", facts: {} };
  }

  if (outcome.status === "APPROVED") {
    await deps.storage.writePublic(outcome.publicObjectKey, approvedData!, "image/webp");
    if (!(await deps.store.finish(media.id, outcome))) {
      // Bu sırada başka bir karar yazıldıysa yayına alınan kopya geri çekilir.
      await deps.storage.deletePublic(outcome.publicObjectKey);
      return "SKIPPED";
    }
    return "APPROVED";
  }
  return (await deps.store.finish(media.id, outcome)) ? outcome.status : "SKIPPED";
}

type Decision = { outcome: Outcome; approvedData: Buffer | null };

async function decide(id: string, originalKey: string, deps: MediaJobDeps): Promise<Decision> {
  const done = (outcome: Outcome): Decision => ({ outcome, approvedData: null });
  const reject = (error: string, facts: MediaFacts = {}) => done({ status: "REJECTED", error, facts });

  let original: Buffer | null;
  try {
    original = await deps.storage.readPrivate(originalKey, await deps.maxBytes());
  } catch (err) {
    if (err instanceof ObjectTooLargeError) return reject("TOO_LARGE");
    throw err;
  }
  if (!original) return reject("MISSING_ORIGINAL");

  const facts: MediaFacts = {
    originalSizeBytes: original.length,
    contentSha256: createHash("sha256").update(original).digest("hex"),
  };
  // Daha önce kaldırılıp yasaklanan dosyanın aynısı: çözmeden, işlemeden reddedilir.
  const banned = await deps.store.bannedHashes();
  if (banned.some((b) => b.contentSha256 === facts.contentSha256)) return reject("BANNED_HASH", facts);

  const type = sniffImageType(original);
  if (!type) return reject("INVALID_IMAGE", facts);
  facts.originalMimeType = type;

  let image;
  try {
    image = await reencodeImage(original);
  } catch (err) {
    if (err instanceof InvalidImageError) return reject("INVALID_IMAGE", facts);
    throw err;
  }
  const processed = processedKey(id);
  await deps.storage.writePrivate(processed, image.data, image.contentType);
  Object.assign(facts, { width: image.width, height: image.height, processedSizeBytes: image.data.length, processedObjectKey: processed });

  // Yasaklı görsele çok benzeyen (yeniden boyutlandırılmış/sıkıştırılmış/kırpılmış) kopya: yayına girmez, insan bakar.
  facts.perceptualHash = await dHash(image.data);
  const similar = banned.some((b) => b.perceptualHash && hamming(b.perceptualHash, facts.perceptualHash!) <= NEAR_DUPLICATE_MAX_DISTANCE);
  if (similar) return done({ status: "QUARANTINED", error: "BANNED_SIMILAR", facts });

  let detections;
  try {
    detections = await deps.moderator.classify(image.data);
  } catch (err) {
    if (err instanceof ModerationTimeoutError) return done({ status: "QUARANTINED", error: "MODERATION_TIMEOUT", facts });
    if (err instanceof ModerationFailedError) return done({ status: "QUARANTINED", error: "MODEL_ERROR", facts });
    throw err;
  }

  const thresholds = typeof deps.thresholds === "function" ? await deps.thresholds() : (deps.thresholds ?? DEFAULT_THRESHOLDS);
  const risk = assessRisk(detections, thresholds);
  Object.assign(facts, {
    riskLevel: risk.level,
    riskScore: risk.score,
    moderationLabels: detections.map((d) => ({ class: d.class, score: d.score })),
    moderationModel: MODERATION_MODEL,
    moderatedAt: deps.now(),
  });

  if (risk.level !== "LOW") return done({ status: "QUARANTINED", error: null, facts });
  return {
    outcome: { status: "APPROVED", publicObjectKey: publicKey(id), facts: { ...facts, processedObjectKey: processed } },
    approvedData: image.data,
  };
}

/**
 * KararVer V1 selective prepublication review.
 *
 * Only explicitly prohibited special-category respondent prompts are rejected
 * by sensitive-policy.ts. This file marks *uncertain* content for a human,
 * not a permanent ban or a personal-profile/trust score.
 *
 * IMPORTANT: These signals are intentionally conservative, NOT an ML model or
 * a guarantee of safe content. Human staffing and an independent privacy
 * review are still required before public release.
 */
import { detectSensitiveSurvey } from "./sensitive-policy.ts";

export type ReviewInput = {
  kind: "POLL" | "DISCUSSION";
  title: string;
  description?: string | null;
  extraInfo?: string | null;
  options?: readonly { label: string }[];
  addenda?: readonly string[];
  tagSlugs?: readonly string[];
  mediaIds?: readonly string[];
};
export type ReviewSignal = "MEDIA_PENDING_HUMAN_CONTEXT" | "EXTERNAL_LINK" | "POSSIBLE_SENSITIVE_CONTEXT";
export type ReviewDecision = { action: "REVIEW"; signals: ReviewSignal[] } | { action: "PUBLISH"; signals: [] };

function normalized(s: string): string {
  return s.toLocaleLowerCase("tr-TR").replaceAll("ı", "i")
    .normalize("NFKD")
    // Format characters must be removed, not turned into token boundaries.
    .replace(/\p{Cf}/gu, "")
    // Common Cyrillic/Greek lookalikes in Turkish/English survey text.
    .replace(/[аα]/gu, "a").replace(/[еε]/gu, "e")
    .replace(/[оο]/gu, "o").replace(/[рρ]/gu, "p")
    .replace(/[іι]/gu, "i").replace(/[с]/gu, "c")
    .replace(/[т]/gu, "t").replace(/[кκ]/gu, "k")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bs[1i]yas[1i]\b/g, "siyasi")
    .replace(/\s+/g, " ").trim();
}
// Soft signals, not 400/REJECT rules. Inflected roots and cross-language
// identifiers enter human review instead of being silently published.
// Avoid generic 'secim' alone to keep electoral-system policy polls public.
const SENSITIVE_CONTEXT = /\b(?:siyas\w*|politik\w*|politic\w*|parti\w*|akp|chp|mhp|hdp|dem parti|secmen\w*|oy ver\w*|vote\w*|election\w*|secim\w*\s+.{0,80}\b(?:aday\w*|kime|kimi|destekl\w*)|din\w*|mezhep\w*|inanc\w*|inan\w*|allah|ramazan\w*|oruc\w*|namaz\w*|basortu\w*|musluman\w*|muslim\w*|religion\w*|pray\w*|etnik\w*|irk\w*|kurt\w*|arap\w*|ethnic\w*|saglik durum\w*|hastalik\w*|teshis\w*|tani\w*|tanis\w*|depresyon\w*|diyabet\w*|hiv\w*|diagnos\w*|psikiyatr\w*|sendika\w*|cinsel\w*|yonelim\w*|gay\w*|lezbiyen\w*|lesbian\w*|biseksuel\w*|bisexual\w*|lgbt\w*|biyometrik\w*|genetik\w*|dna\w*|suc kayd\w*|sabika\w*|tutuklan\w*|gozalti\w*)\b/;
const LINK = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|com\.tr|io|app|site|xyz)\b)/i;

/**
 * Return generic signals only. No user text, raw sensitive data, email, URL,
 * IP or inferred sensitive trait is written to logs.
 */
export function screenV1Publication(input: ReviewInput): ReviewDecision {
  const signals: ReviewSignal[] = [];
  // Images can contain personal attributes and writing not in the text body;
  // approved media alone is not sufficient for prompt-context acceptance.
  if ((input.mediaIds?.length ?? 0) > 0) signals.push("MEDIA_PENDING_HUMAN_CONTEXT");
  const parts = [
    input.title, input.description ?? "", input.extraInfo ?? "",
    ...(input.options ?? []).map(option => option.label),
    ...(input.addenda ?? []),
  ];
  if (parts.some(text => LINK.test(text))) signals.push("EXTERNAL_LINK");
  if (detectSensitiveSurvey(input) !== null || parts.some(text => SENSITIVE_CONTEXT.test(normalized(text)))) signals.push("POSSIBLE_SENSITIVE_CONTEXT");
  return signals.length ? { action: "REVIEW", signals } : { action: "PUBLISH", signals: [] };
}

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
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
const SENSITIVE_CONTEXT = /\b(?:siyasi|politik|parti|secim|oy verme|dini|din|mezhep|inanc|etnik|irk|saglik durumu|hastalik|teshis|tani|psikiyatr|sendika|cinsel|biyometrik|genetik|dna|suc kaydi|sabika)\b/;
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
  if (parts.some(text => SENSITIVE_CONTEXT.test(normalized(text)))) signals.push("POSSIBLE_SENSITIVE_CONTEXT");
  return signals.length ? { action: "REVIEW", signals } : { action: "PUBLISH", signals: [] };
}

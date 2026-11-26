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
const SENSITIVE_CONTEXT = /\b(?:siyas\w*|politik\w*|politic\w*|parti(?!kul)\w*|akp|chp|mhp|hdp|dem parti|secmen\w*|oy ver\w*|vote\w*|election\w*|secim\w*\s+.{0,80}\b(?:aday\w*|kime|kimi|tercih\w*|destekl\w*)|din(?:i|in|iniz|imiz|ler|sel|e|de|den)?|mezhep\w*|inanc\w*|inan(?:iyor\w*|ir\w*|din|dim|mak|makta)|allah|ramazan\w*|oruc\w*|namaz\w*|basortu\w*|musluman\w*|muslim\w*|religion\w*|pray\w*|etnik\w*|irk\w*|kurt(?:ler|um|sun|sunuz|uz)?|arap\w*|ethnic\w*|saglik durum\w*|hastalik\w*|teshis\w*|depresyon\w*|diyabet\w*|hiv\w*|diagnos\w*|psikiyatr\w*|sendika\w*|cinsel\w*|yonelim\w*|gay|gays|gayim|lezbiyen\w*|lesbian\w*|biseksuel\w*|bisexual\w*|lgbt\w*|biyometrik\w*|genetik\w*|dna\w*|suc kayd\w*|sabika\w*|tutuklan\w*|gozalti\w*)\b/;
// Fourth-round guard (#371): only queue personally directed questions that
// also mention a special-category context. Do not turn these into 400 rejects.
// Broad subject-only questions (e.g. cancer research funding) stay publishable.
const DIRECT_PERSONAL_QUESTION = /\b(?:are you|do you|did you|have you|what is your|your|kendin(?:i|izi|e|ize)|kendim(?:i)?|sen(?:in|i|den)?|siz(?:in|i|den)?|misin|misiniz|musun|musunuz|musun|m[ıi]s[ıi]n|destekliyor(?:sun|sunuz)|gider\s+misin|goru(?:yor|r)\s+musun|kullaniyor\s+musun|oldun\s+mu|yattin\s+mi|ne\s+dedin|inaniyor\s+musun)\b/;
const ADDITIONAL_SENSITIVE_CATEGORIES = /\b(?:christian\w*|atheist\w*|jewish|buddhis\w*|hindu\w*|god|believe|kilise\w*|sinagog\w*|cemevi\w*|tesettur\w*|kanser\w*|cancer\w*|insulin\w*|epilep\w*|multiple sclerosis|tedavi\w*|antidepresan\w*|ameliyat\w*|engelli\w*|hamile\w*|kurtaj\w*|trans|queer|sexual orientation|ermeni\w*|rum|zaza\w*|laz|hapis|mahkum\w*|convict\w*|crime|criminal record|prison\w*|union member|muhalefet\w*|iktidar\w*|referandum\w*|cumhurbaskan\w*)\b/;
const PERSONALLY_SENSITIVE = (text: string) => {
  const value = normalized(text);
  return DIRECT_PERSONAL_QUESTION.test(value) && ADDITIONAL_SENSITIVE_CATEGORIES.test(value);
};
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
  // Respondent wording can be split between the title, description, choices
  // and addenda. Evaluate the complete context in addition to each field.
  if (detectSensitiveSurvey(input) !== null ||
      parts.some(text => SENSITIVE_CONTEXT.test(normalized(text)) || PERSONALLY_SENSITIVE(text)) ||
      PERSONALLY_SENSITIVE(parts.join(" "))) signals.push("POSSIBLE_SENSITIVE_CONTEXT");
  return signals.length ? { action: "REVIEW", signals } : { action: "PUBLISH", signals: [] };
}

/**
 * KararVer V1: direct requests for special-category personal information are
 * out of scope. This is a deliberately conservative *rule-based tripwire*,
 * not a complete content moderation or legal classification system.
 *
 * No user text is logged; only a generic field/code is returned to callers.
 * Public data, uploaded image text, creative spelling, comments and old polls
 * require independent moderation and reviewer acceptance.
 */
export type SensitiveInput = {
  title?: string;
  description?: string | null;
  extraInfo?: string | null;
  body?: string;
  options?: readonly { label: string }[];
  tagSlugs?: readonly string[];
};
export type SensitiveRisk = { field: string; category: "political" | "belief" | "health" | "ethnicity" | "membership" | "sexual" | "justice" | "biometric" };

// Normalize Turkish dotted/dotless I and diacritics before ASCII word matching.
function normalized(value: string): string {
  return " " + value.toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() + " ";
}

const REQUESTS: ReadonlyArray<{ category: SensitiveRisk["category"]; pattern: RegExp }> = [
  // Respondent's voting behaviour, political party or political views.
  { category: "political", pattern: /\b(?:siyasi|politik) (?:gorus(?:un|unuz|leriniz)?|tercih(?:in|iniz)?)\b|\b(?:hangi|hangi bir|ne|senin|sizin) (?:siyasi )?parti(?:ye|yi|den|nin|ye oy)?\b|\b(?:oy verdin|oy verdiniz|oy veriyorsun|oy vereceksin|oy vereceksiniz|kime oy veriyorsun|kime oy vereceksin)\b|\b(?:parti|siyasi hareket) (?:uyesi|uyeligin|uyesi misin)\b/ },
  // Religion, denominations and philosophical belief about the respondent.
  { category: "belief", pattern: /\b(?:hangi|hangi bir|ne|senin|sizin) (?:dine|dini|din|mezhep|inanc|inanca)\b|\b(?:dinin|mezhebin|inancin|felsefi inancin) (?:ne|nedir)\b|\b(?:musluman|hristiyan|yahudi|ateist|agnostik|alevi|sunni|dindar) (?:misin|misiniz|miydin|miydiniz)\b/ },
  // Personal diagnoses, prescriptions, psychological/physical conditions.
  { category: "health", pattern: /\b(?:hangi|ne|nasil bir) (?:hastalik|tani|teshis|ilac|tedavi)(?:in|iniz|i|yi|lari|lar)?\b|\b(?:saglik durumun|saglik durumunuz|hastaligin var|hastaliginiz var|tani aldiniz mi|tani aldin mi|hiv pozitif misin|hamile misin|engelin var mi|depresyonda misin|psikiyatrik tedavi)\b|\b(?:hastalik|ilac|tedavi) (?:kullaniyor musun|goruyor musun|gecirdin mi|tani(?:si|n) var mi)\b/ },
  { category: "ethnicity", pattern: /\b(?:etnik kokenin|etnik kokeniniz|hangi irktan|hangi etnik koken|irkin ne|irkiniz ne|soyunun kokeni|hangi milliyettensin)\b/ },
  { category: "membership", pattern: /\b(?:hangi sendika(?:ya)?|sendika uyesi misin|sendika uyesi misiniz|hangi dernege uyesin|vakif uyesi misin|dernek uyesi misin)\b/ },
  { category: "sexual", pattern: /\b(?:cinsel hayatin|cinsel yasamin|cinsel yonelimin|cinsel deneyimin|cinsel iliskin oldu mu|kiminle cinsel|cinsel partner sayin)\b/ },
  { category: "justice", pattern: /\b(?:sabikan var mi|sabika kaydin|ceza mahkumiyetin|hapse girdin mi|cezaevine girdin mi|guvenlik tedbiri aldin mi)\b/ },
  { category: "biometric", pattern: /\b(?:parmak izin|parmak izini|yuz tanima verin|genetik verin|genetik test sonucunuz|dna sonucunu|dna bilgilerini)\b/ },
];

/** Selection of categorical sensitive answers also reveals respondent data. */
const SENSITIVE_ANSWERS: ReadonlyArray<{ category: SensitiveRisk["category"]; pattern: RegExp }> = [
  { category: "political", pattern: /\b(?:ak parti|chp|mhp|iyi parti|dem parti|tip|zafer partisi|yeniden refah)\b/ },
  { category: "belief", pattern: /\b(?:musluman|hristiyan|yahudi|ateist|agnostik|alevi|sunni|deist)\b/ },
  { category: "health", pattern: /\b(?:diyabet|hiv|aids|kanser|depresyon|bipolar|sizofreni|otizm)\b/ },
  { category: "membership", pattern: /\b(?:sendika uyesi|dernek uyesi|vakif uyesi)\b/ },
];
const CHOICE_PROMPT = /\b(?:hangi|hangisi|hangisisin|hangisiniz|kime|neye|oyun|tercihin|sizin|senin|misin|misiniz|kendini|hangi gruptasin|hangi gruptasiniz)\b/;

export function detectSensitiveSurvey(input: SensitiveInput): SensitiveRisk | null {
  const fields: Array<[string, string | undefined | null]> = [
    ["title", input.title], ["description", input.description],
    ["extraInfo", input.extraInfo], ["body", input.body],
    ...(input.options ?? []).map((o, i): [string, string] => [`options.${i}.label`, o.label]),
  ];
  for (const [field, source] of fields) {
    if (!source) continue;
    const text = normalized(source);
    for (const rule of REQUESTS) {
      if (rule.pattern.test(text)) return { field, category: rule.category };
    }
  }

  // A question like "Hangisisin?" + "Alevi / Sünni" discloses a belief
  // even though no sensitive keyword appears in the title.
  const question = normalized([input.title, input.description, input.extraInfo].filter(Boolean).join(" "));
  const choices = (input.options ?? []).map(o => normalized(o.label));
  if (choices.length >= 2 && CHOICE_PROMPT.test(question)) {
    for (const rule of SENSITIVE_ANSWERS) {
      const index = choices.findIndex(c => rule.pattern.test(c));
      if (index !== -1) return { field: `options.${index}.label`, category: rule.category };
    }
  }
  return null;
}

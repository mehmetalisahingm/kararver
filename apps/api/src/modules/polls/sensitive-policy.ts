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
  addenda?: readonly string[];
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
  { category: "health", pattern: /\b(?:hangi|ne|nasil bir) (?:hastaligin|hastaliginiz|tanin|taniniz|teshisin|teshisiniz)\b|\b(?:hangi|ne) ilac(?:i|lari)? (?:kullaniyorsun|kullaniyorsunuz|kullandin|kullandiniz|aliyorsun|aliyorsunuz)\b|\bhangi tedavi(?:yi)? (?:gordun|gordunuz|aliyorsun|aliyorsunuz)\b|\b(?:saglik durumun|saglik durumunuz|hastaligin var|hastaliginiz var|tani aldiniz mi|tani aldin mi|hiv pozitif misin|hamile misin|engelin var mi|depresyonda misin|psikiyatrik tedavi (?:goruyor musun|gordun mu|aldin mi|gordunuz mu|aliyorsun|aliyorsunuz))\b|\b(?:hastalik|ilac|tedavi) (?:kullaniyor musun|goruyor musun|gecirdin mi|tani(?:si|n) var mi)\b/ },
  { category: "ethnicity", pattern: /\b(?:etnik kokenin|etnik kokeniniz|hangi irktan|hangi etnik koken|irkin ne|irkiniz ne|soyunun kokeni|hangi milliyettensin)\b/ },
  { category: "membership", pattern: /\b(?:hangi sendika(?:ya)?|sendika uyesi misin|sendika uyesi misiniz|hangi dernege uyesin|vakif uyesi misin|dernek uyesi misin)\b/ },
  { category: "sexual", pattern: /\b(?:cinsel hayatin|cinsel yasamin|cinsel yonelimin|cinsel deneyimin|cinsel iliskin oldu mu|kiminle cinsel|cinsel partner sayin)\b/ },
  { category: "justice", pattern: /\b(?:sabikan var mi|sabika kaydin|ceza mahkumiyetin|hapse girdin mi|cezaevine girdin mi|guvenlik tedbiri aldin mi)\b/ },
  { category: "biometric", pattern: /\b(?:parmak izin|parmak izini|yuz tanima verin|genetik verin|genetik test sonucunuz|dna sonucunu|dna bilgilerini)\b/ },
];

/** Categorical choices alone do not prove that we ask about a respondent's attributes.
 * Require a self-referential question and a categorical answer label; general
 * research/services topics like "Kanser araştırmaları" must remain allowed.
 */
const SENSITIVE_ANSWERS: ReadonlyArray<{ category: SensitiveRisk["category"]; pattern: RegExp }> = [
  { category: "political", pattern: /^(?:ak parti|chp|mhp|iyi parti|dem parti|turkiye isci partisi|tip|zafer partisi|yeniden refah)(?: (?:a|b|c|d|partisi|grubu|secenegi))?$/ },
  { category: "belief", pattern: /^(?:musluman|hristiyan|yahudi|ateist|agnostik|alevi|sunni|deist)(?: (?:a|b|c|d|mezhebi|inanci|grubu|secenegi))?$/ },
  { category: "health", pattern: /^(?:diyabet|hiv|aids|kanser|depresyon|bipolar|sizofreni|otizm)(?: (?:a|b|c|d|hastasi|grubu|secenegi))?$/ },
  { category: "membership", pattern: /^(?:sendika uyesi|dernek uyesi|vakif uyesi)$/ },
];
const PERSONAL_CHOICE_PROMPT = /\b(?:hangisisin|hangisiniz|hangi gruptasin|hangi gruptasiniz|hangisini tercih edersin|hangisini secersin|hangisini tercih ediyorsun|hangi gruba aitsin|sana yakin olan grubu sec|kendini|senin|sizin|sen hangi|siz hangi|sende|kime oy verirsin|hangi dine mensupsun)\b/;

export function detectSensitiveSurvey(input: SensitiveInput): SensitiveRisk | null {
  const fields: Array<[string, string | undefined | null]> = [
    ["title", input.title], ["description", input.description],
    ["extraInfo", input.extraInfo], ["body", input.body],
    ...(input.addenda ?? []).map((body, i): [string, string] => [`addenda.${i}.body`, body]),
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
  const question = normalized([input.title, input.description, input.extraInfo, input.body, ...(input.addenda ?? [])].filter(Boolean).join(" "));
  const choices = (input.options ?? []).map(o => normalized(o.label).trim());
  if (choices.length >= 2 && PERSONAL_CHOICE_PROMPT.test(question)) {
    for (const rule of SENSITIVE_ANSWERS) {
      const index = choices.findIndex(c => rule.pattern.test(c));
      if (index !== -1) return { field: `options.${index}.label`, category: rule.category };
    }
  }
  return null;
}

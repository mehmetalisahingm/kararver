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
    .normalize("NFKD")
    .replace(/\p{Cf}/gu, "")
    // Minimal common Cyrillic/Greek lookalikes used to hide Latin words.
    .replace(/[аα]/gu, "a")
    .replace(/[еε]/gu, "e")
    .replace(/[оο]/gu, "o")
    .replace(/[рρ]/gu, "p")
    .replace(/[іι]/gu, "i")
    .replace(/[с]/gu, "c")
    .replace(/[т]/gu, "t").replace(/[кκ]/gu, "k")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bs[1i]yas[1i]\b/g, "siyasi")
    .replace(/\s+/g, " ")
    .trim() + " ";
}

const REQUESTS: ReadonlyArray<{ category: SensitiveRisk["category"]; pattern: RegExp }> = [
  // #371: short, explicit self-identifiers and direct respondent questions in English.
  { category: "political", pattern: /\b(?:which party did you vote for|what party did you vote for|who did you vote for|what is your political affiliation)\b|\bben (?:ak parti|akp|chp|mhp|hdp|dem|iyi parti|tip) (?:li|liyim)\b/ },
  { category: "belief", pattern: /\b(?:what is your religion|which religion do you follow|ramazanda oruc tutuyor musun|namaz kiliyor musun|basortusu takiyor musun)\b/ },
  { category: "health", pattern: /\b(?:depresyon tanisi aldin mi|depresyon tanisi aldiniz mi|engelli raporun var mi|engelli raporunuz var mi)\b/ },
  { category: "sexual", pattern: /\b(?:escinsel misin|escinsel misiniz)\b/ },
  { category: "ethnicity", pattern: /\b(?:kurt musun turk musun|turk musun kurt musun|hangi etnik gruptansin|which ethnicity are you)\b/ },
  // Respondent's voting behaviour, political party or political views.
  { category: "political", pattern: /\b(?:siyasi|politik) (?:gorus(?:un|unuz|leriniz)?|tercih(?:in|iniz)?)\b|\b(?:hangi|hangi bir) (?:siyasi )?parti(?:ye|yi) (?:oy ver(?:din|diniz|iyorsun|iyorsunuz|eceksin|eceksiniz)|sec(?:tin|tiniz)|destekliyor(?:sun|sunuz))\b|\b(?:senin|sizin) (?:siyasi )?parti(?:n|niz)\b|\b(?:parti|siyasi hareket) (?:uyesi|uyeligin|uyesi misin)\b/ },
  // Religion, denominations and philosophical belief about the respondent.
  { category: "belief", pattern: /\b(?:hangi|hangi bir|ne|senin|sizin) (?:dine|dini|din|mezhep|inanc|inanca)\b|\b(?:dinin|dininiz|mezhebin|mezhebiniz|inancin|inanciniz|felsefi inancin|felsefi inanciniz) (?:ne|nedir)\b|\b(?:musluman|hristiyan|yahudi|ateist|agnostik|alevi|sunni|dindar) (?:misin|misiniz|miydin|miydiniz)\b/ },
  // Personal diagnoses, prescriptions, psychological/physical conditions.
  { category: "health", pattern: /\b(?:hangi|ne|nasil bir) (?:hastaligin|hastaliginiz|tanin|taniniz|teshisin|teshisiniz)\b|\b(?:hangi|ne) ilac(?:i|lari)? (?:kullaniyorsun|kullaniyorsunuz|kullandin|kullandiniz|aliyorsun|aliyorsunuz)\b|\bhangi tedavi(?:yi)? (?:gordun|gordunuz|aliyorsun|aliyorsunuz)\b|\b(?:saglik durumun|saglik durumunuz|hastaligin var|hastaliginiz var|tani aldiniz mi|tani aldin mi|hiv pozitif misin|hamile misin|engelin var mi|depresyonda misin|psikiyatrik tedavi (?:goruyor musun|gordun mu|aldin mi|gordunuz mu|aliyorsun|aliyorsunuz))\b|\b(?:hastalik|ilac|tedavi) (?:kullaniyor musun|goruyor musun|gecirdin mi|tani(?:si|n) var mi)\b/ },
  { category: "ethnicity", pattern: /\b(?:etnik kokenin|etnik kokeniniz|hangi irktan|hangi etnik koken|irkin ne|irkiniz ne|soyunun kokeni|hangi milliyettensin)\b/ },
  { category: "membership", pattern: /\b(?:hangi sendika(?:ya)?|sendika uyesi misin|sendika uyesi misiniz|hangi dernege uyesin|vakif uyesi misin|dernek uyesi misin)\b/ },
  { category: "sexual", pattern: /\b(?:cinsel hayatin|cinsel yasamin|cinsel yonelimin|cinsel yoneliminiz|cinsel deneyimin|cinsel iliskin oldu mu|kiminle cinsel|cinsel partner sayin)\b/ },
  { category: "justice", pattern: /\b(?:sabikan var mi|sabika kaydin|sabika kaydiniz|ceza mahkumiyetin|hapse girdin mi|cezaevine girdin mi|guvenlik tedbiri aldin mi)\b/ },
  { category: "biometric", pattern: /\b(?:parmak izin|parmak iziniz|parmak izini|parmak izinizi|yuz tanima verin|genetik verin|genetik test sonucunuz|dna sonucunu|dna bilgilerini)\b/ },

  // #371 P1: generalized respondent variants, not one-off exact-question fixtures.
  { category: "political", pattern: /\b(?:son secimde|cumhurbaskanligi seciminde|son cumhurbaskanligi seciminde) (?:kimi destekledin|kime oy verdin|tercihin|tercihiniz)\b|\b(?:yerel|genel|son|cumhurbaskanligi) secim(?:de|inde)? (?:hangi adayi|kimi|kime) (?:oy verdin|oy verdiniz|destekledin|desteklediniz)\b|\bhow did you vote in the last election\b/ },
  { category: "belief", pattern: /\b(?:(?:ramazanda )?oruc tutuyor|namaz kiliyor|basortusu takiyor) mu(?:sun|sunuz)\b|\b(?:oruc tuttun|oruc tuttunuz) mu\b|\b(?:oruc tutar|namaz kilar|allah a inanir) mi(?:sin|siniz)\b|\bdinin hangisi\b|\ballah a inaniyor mu(?:sun|sunuz)\b|\bdo you pray five times a day\b|\bare you muslim\b/ },
  { category: "health", pattern: /\b(?:(?:sana|size) )?depresyon teshisi kondu mu\s*$|\bhiv testin pozitif mi cikti\b|\bhave you been diagnosed with depression\b/ },
  { category: "sexual", pattern: /\b(?:gay|lezbiyen|biseksuel) mi(?:sin|siniz)\b|\bare you (?:gay|lesbian|bisexual)\b/ },
  { category: "ethnicity", pattern: /\b(?:kurt|turk) mu(?:sun|sunuz)\b|\barap mi(?:sin|siniz)\b/ },
  { category: "justice", pattern: /\bhic tutuklandin mi\b/ },
];

/** Categorical choices alone do not prove that we ask about a respondent's attributes.
 * Require a self-referential question and a categorical answer label; general
 * research/services topics like "Kanser araştırmaları" must remain allowed.
 */
const SENSITIVE_ANSWERS: ReadonlyArray<{ category: SensitiveRisk["category"]; pattern: RegExp }> = [
  { category: "political", pattern: /^(?:ak parti|akp|chp|mhp|hdp|dem|dem parti|iyi parti|turkiye isci partisi|tip|zafer partisi|yeniden refah)(?: ?(?:a|b|c|d|li|liyim|partisi|grubu|secenegi))?$/ },
  { category: "belief", pattern: /^(?:musluman|hristiyan|yahudi|ateist|agnostik|alevi|sunni|deist)(?: (?:a|b|c|d|mezhebi|inanci|grubu|secenegi))?$/ },
  { category: "health", pattern: /^(?:diyabet|hiv|aids|kanser|depresyon|bipolar|sizofreni|otizm)(?: (?:a|b|c|d|hastasi|grubu|secenegi))?$/ },
  { category: "ethnicity", pattern: /^(?:kurt|turk|arap|laz|cerkez|roman)$/ },
  { category: "membership", pattern: /^(?:sendika uyesi|dernek uyesi|vakif uyesi)$/ },
];
// First-person political option labels disclose a respondent even with a neutral question.
const PARTY_LABEL = "(?:ak parti|akp|chp|mhp|hdp|dem(?: parti)?|iyi parti|tip|zafer partisi)";
const POLITICAL_SELF_ANSWER = new RegExp("^(?:(?:ben )?" + PARTY_LABEL + " (?:li|liyim|liyiz|secmeniyim|(?:ye|ya|e|a|ne|na) oy (?:verdim|verdik|veriyorum|veriyoruz|verecegim|verecegiz)|(?:yi|yu|i|u|ni|nu) destekliyor(?:um|uz))|oyum " + PARTY_LABEL + "(?: (?:ye|ya|e|a|ne|na))?)$");

const PERSONAL_CHOICE_PROMPT = /\b(?:hangisisin|hangisiniz|hangi gruptasin|hangi gruptasiniz|hangisini tercih edersin|hangisini secersin|hangisini tercih ediyorsun|hangi gruba aitsin|sana yakin olan grubu sec|kendini|kendinizi|kendine|kendinize|senin|sizin|sen hangi|siz hangi|sende|kime oy verirsin|hangi dine mensupsun)\b/;

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
  for (const [index, choice] of choices.entries()) {
    if (POLITICAL_SELF_ANSWER.test(choice)) {
      return { field: `options.${index}.label`, category: "political" };
    }
  }
  if (choices.length >= 2 && PERSONAL_CHOICE_PROMPT.test(question)) {
    for (const rule of SENSITIVE_ANSWERS) {
      const index = choices.findIndex(c => rule.pattern.test(c));
      if (index !== -1) return { field: `options.${index}.label`, category: rule.category };
    }
  }
  return null;
}

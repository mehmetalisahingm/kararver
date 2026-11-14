export type ArtTopic = "technology" | "university" | "travel" | "gaming" | "sports" | "social" | "food" | "conversation";

export function visualTopic(value: string): ArtTopic {
  const text = value.toLocaleLowerCase("tr-TR").replaceAll("â", "a").replaceAll("î", "i");
  if (/teknoloji|yapay zek|bilim|robot|yazılım|telefon|internet|dijital|ai\b/.test(text)) return "technology";
  if (/üniversite|eğitim|öğren|okul|ders|sınav|kariyer|kitap/.test(text)) return "university";
  if (/seyahat|tatil|gezi|rota|doğa|deniz|kamp|şehir/.test(text)) return "travel";
  if (/eğlence|oyun|gaming|konsol|film|müzik|sinema/.test(text)) return "gaming";
  if (/spor|futbol|basketbol|fitness|koşu|maç/.test(text)) return "sports";
  if (/ilişki|aşk|arkadaş|aile|sosyal|hayat|yaşam/.test(text)) return "social";
  if (/yemek|kahve|mutfak|pizza|burger|yiyecek/.test(text)) return "food";
  return "conversation";
}


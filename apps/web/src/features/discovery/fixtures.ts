import type { Poll } from "../../lib/model.ts";
import type { Category, TrendFormat, Movement } from "./model.ts";
export const demoCategories: Category[] = [
  {
    id: "teknoloji",
    slug: "teknoloji",
    name: "Teknoloji",
    description: "Dijital dünyada bir sonraki kararın.",
  },
  {
    id: "yasam",
    slug: "yasam",
    name: "Yaşam",
    description: "Gündelik alışkanlıklar, farklı bakış açıları.",
  },
  {
    id: "seyahat",
    slug: "seyahat",
    name: "Seyahat",
    description: "Yeni rotalar ve yol hikâyeleri.",
  },
  {
    id: "egitim",
    slug: "egitim",
    name: "Eğitim",
    description: "Öğrenmenin sana uygun yolunu keşfet.",
  },
  {
    id: "oyun",
    slug: "oyun",
    name: "Oyun",
    description: "Bir sonraki maceraya birlikte karar ver.",
  },
  {
    id: "spor",
    slug: "spor",
    name: "Spor",
    description: "Hareket et, deneyimini paylaş.",
  },
];
// Fixed, explicitly synthetic fixture. These orders are NOT a trend engine or live metrics.
export const trendOrders: Record<TrendFormat, string[]> = {
  DAILY_RISING: [
    "calisma-sekli",
    "ekran-isigi",
    "oyun-gecesi",
    "tatil-rotasi",
    "ogrenci-notlari",
  ],
  WEEKLY_RISING: [
    "tatil-rotasi",
    "sehir-ulasimi",
    "ekran-isigi",
    "calisma-sekli",
    "spor-saati",
  ],
  WEEKLY_MOST_VOTED: [
    "sehir-ulasimi",
    "ekran-isigi",
    "oyun-gecesi",
    "spor-saati",
    "tatil-rotasi",
  ],
  WEEKLY_MOST_DISCUSSED: [
    "ilk-bisiklet",
    "ogrenci-notlari",
    "sehir-ulasimi",
    "oyun-gecesi",
    "calisma-sekli",
  ],
  WEEKLY_MOVERS: ["sehir-ulasimi", "ekran-isigi"],
};
export const fixtureEnd = "2026-09-27T21:00:00Z";
export const fixturePreviousEnd = "2026-09-20T21:00:00Z";
export const movements: Record<string, Movement> = {
  "sehir-ulasimi": {
    optionId: "bisiklet",
    fromPercent: 35,
    toPercent: 55,
    deltaPoints: 20,
    sampleFrom: 100,
    sampleTo: 300,
    windowFromEnd: fixturePreviousEnd,
    windowToEnd: fixtureEnd,
  },
  "ekran-isigi": {
    optionId: "sicak",
    fromPercent: 70,
    toPercent: 60,
    deltaPoints: -10,
    sampleFrom: 80,
    sampleTo: 200,
    windowFromEnd: fixturePreviousEnd,
    windowToEnd: fixtureEnd,
  },
};
type Seed = Omit<Poll, "results" | "ownVote"> & {
  counts: number[];
  votes: Map<string, string>;
};
export function discoverySeeds(): Seed[] {
  const base = {
    author: "Ece",
    status: "ACTIVE" as const,
    closesAt: "2099-10-01T12:00:00Z",
    visibility: "always" as const,
    commentsEnabled: true,
    comments: [],
  };
  return [
    {
      ...base,
      id: "sehir-ulasimi",
      title: "Şehir içi ulaşımda bisiklet mi toplu taşıma mı?",
      description: "Kısa mesafede zaman, bütçe ve hareket dengesi.",
      category: "Yaşam",
      kind: "poll",
      options: [
        { id: "bisiklet", label: "Bisiklet" },
        { id: "toplu", label: "Toplu taşıma" },
      ],
      counts: [165, 135],
      votes: new Map(),
    },
    {
      ...base,
      id: "ekran-isigi",
      title: "Akşam çalışırken sıcak ışık mı soğuk ışık mı?",
      description: "Çalışma alanının ışığı odaklanmanı nasıl etkiliyor?",
      category: "Teknoloji",
      kind: "poll",
      options: [
        { id: "sicak", label: "Sıcak ışık", image: "/images/laptop.jpg" },
        { id: "soguk", label: "Soğuk ışık", image: "/images/office.jpg" },
      ],
      counts: [120, 80],
      votes: new Map(),
    },
    {
      ...base,
      id: "oyun-gecesi",
      title: "Oyun gecesinde strateji mi macera mı?",
      description: "Arkadaşlarınla birlikte oynarken hangisini seçersin?",
      category: "Oyun",
      kind: "poll",
      options: [
        { id: "strateji", label: "Strateji" },
        { id: "macera", label: "Macera" },
      ],
      counts: [70, 50],
      votes: new Map(),
    },
    {
      ...base,
      id: "ogrenci-notlari",
      title: "Ders notlarını daha kalıcı öğrenmek için ne yapıyorsun?",
      description: "Tekrar, görsel notlar veya bir arkadaşına anlatmak…",
      category: "Eğitim",
      kind: "discussion",
      options: [],
      counts: [],
      votes: new Map(),
    },
    {
      ...base,
      id: "spor-saati",
      title: "Spor yapmak için sabah mı akşam mı?",
      description:
        "Sürdürebildiğin bir rutin oluşturmak için deneyimlerini paylaş.",
      category: "Spor",
      kind: "poll",
      options: [
        { id: "sabah", label: "Sabah" },
        { id: "aksam", label: "Akşam" },
      ],
      counts: [55, 55],
      votes: new Map(),
    },
  ];
}

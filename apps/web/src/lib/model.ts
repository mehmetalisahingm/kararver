// Frontend view models. ApiClient validates the shared wire contract before mapping.
import type { EngagementClient } from "../features/social/model.ts";

export type GalleryItem =
  | { id: string; status: "ready"; src: string; alt: string }
  | { id: string; status: "pending" | "removed"; alt: string };

export type User = {
  id: string;
  name: string;
  email: string;
  verified: boolean;
  balance: number | null;
};
export type Results =
  | { visible: false }
  | {
      visible: true;
      total: number;
      options: { id: string; votes: number; percent: number }[];
    };
export type Poll = {
  id: string;
  canonicalPath?: string;
  canVote?: boolean;
  voteBlockedReason?: string | null;
  title: string;
  description: string;
  kind: "poll" | "discussion";
  author: string;
  category: string;
  status: "ACTIVE" | "LOCKED" | "CLOSED";
  closesAt: string;
  options: { id: string; label: string; image?: string }[];
  visibility: "always" | "after_vote";
  results: Results;
  ownVote: string | null;
  commentsEnabled: boolean;
  comments: { id: string; author: string; text: string }[];
  commentCount?: number;
  gallery?: GalleryItem[];
  details?: { label: string; value: string }[];
  price?: { amount: string; currency: "TRY"; note: string };
};
export type Draft = {
  categoryId?: string;
  kind: "poll" | "discussion";
  title: string;
  description: string;
  options: string[];
  category: string;
  hours: number;
  visibility: "always" | "after_vote";
  commentsEnabled: boolean;
};
export const emptyDraft = (): Draft => ({
  kind: "poll",
  title: "",
  description: "",
  options: ["", ""],
  category: "Teknoloji",
  hours: 72,
  visibility: "after_vote",
  commentsEnabled: true,
});
export const categories = [
  "Teknoloji",
  "Otomobil",
  "Alışveriş",
  "Eğitim",
  "Üniversite",
  "Yaşam",
  "Seyahat",
  "Oyun",
  "Spor",
  "Yemek",
  "Ev / Emlak",
  "Kariyer",
  "Diğer",
];
export type FieldErrors = Record<string, string>;
export class UiError extends Error {
  code: string;
  fields: FieldErrors;
  constructor(code: string, message: string, fields: FieldErrors = {}) {
    super(message);
    this.name = "UiError";
    this.code = code;
    this.fields = fields;
  }
}
export function validateDraft(draft: Draft): FieldErrors {
  const errors: FieldErrors = {};
  if (draft.title.trim().length < 10 || draft.title.trim().length > 140)
    errors.title = "Sorun 10–140 karakter arasında olmalı.";
  if (draft.description.length > 2000)
    errors.description = "Açıklama en fazla 2.000 karakter olabilir.";
  if (draft.kind === "poll") {
    if (draft.options.length < 2 || draft.options.length > 6)
      errors.options = "2–6 seçenek eklemelisin.";
    draft.options.forEach((value, i) => {
      if (!value.trim() || value.trim().length > 120)
        errors[`option-${i}`] = "Seçenek 1–120 karakter olmalı.";
    });
    if (
      new Set(draft.options.map((v) => v.trim().toLocaleLowerCase("tr")))
        .size !== draft.options.length
    )
      errors.options = "Seçenekler birbirinden farklı olmalı.";
    if (!Number.isFinite(draft.hours) || draft.hours < 1 || draft.hours > 720)
      errors.hours = "Süre 1 saat ile 30 gün arasında olmalı.";
  }
  if (!draft.categoryId && !categories.includes(draft.category))
    errors.category = "Bir kategori seçmelisin.";
  return errors;
}
export function safeReturnTo(value: string | null): string {
  return value &&
    (/^\/$/.test(value) ||
      /^\/olustur$/.test(value) ||
      /^\/karar\/[A-Za-z0-9_-]+$/.test(value))
    ? value
    : "/";
}
export interface ProductClient extends EngagementClient {
  list(): Promise<Poll[]>;
  get(id: string): Promise<Poll>;
  login(email: string, password: string): Promise<User>;
  register(name: string, email: string, password: string, username?: string): Promise<void>;
  verify(email: string, code: string): Promise<void>;
  requestReset(email: string): Promise<void>;
  reset(email: string, code: string, password: string): Promise<void>;
  logout(): Promise<void>;
  current(): User | null;
  create(draft: Draft, requestId: string): Promise<Poll>;
  vote(id: string, optionId: string): Promise<Poll>;
}

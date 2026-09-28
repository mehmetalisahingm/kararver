// Endpoint sözleşmesi tanımı. Her domain dosyası kendi endpointlerini defineEndpoint ile
// yazar; registry (index.ts) hepsini toplar, docs/API_CONTRACTS.md envanteri buradan üretilir.
import type { z } from "zod";
import type { ErrorCode } from "./errors.ts";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * public   — misafir dahil herkes (oturum varsa izleyiciye göre projeksiyon)
 * user     — giriş yapmış, BANNED/SUSPENDED olmayan hesap
 * verified — user + e-posta doğrulanmış
 * owner    — kaynağın sahibi (user koşulları dahil)
 * moderator/admin/super_admin — rol; moderator topluluk kapsamıyla sınırlı (KV-04)
 */
export type Auth = "public" | "user" | "verified" | "owner" | "moderator" | "admin" | "super_admin";

/**
 * none         — tekrarlanması güvenli değil ama yan etkisi yok / önemsiz (GET, logout)
 * natural      — işlemin kendisi idempotent (PUT/DELETE, aynı sonuç)
 * key-optional — Idempotency-Key gönderilirse tekrar aynı sonucu döner
 * key-required — Idempotency-Key zorunlu (puan harcayan / para benzeri işlemler)
 */
export type Idempotency = "none" | "natural" | "key-optional" | "key-required";

/**
 * public  — izleyiciden bağımsız; paylaşılan cache'e konabilir
 * viewer  — misafire public projeksiyon, oturumlu kullanıcıya `private, no-store`
 * private — her zaman `private, no-store`
 */
export type CachePolicy = "public" | "viewer" | "private";

export type Owner = "Faruk" | "Ümit" | "Mert" | "Utku" | "Mehmet";

export type EndpointContract = {
  id: string;
  domain: string;
  method: Method;
  path: string;
  summary: string;
  auth: Auth;
  provider: { owner: Owner; module: string };
  consumers: string[];
  /** Bu endpoint'in sözleşmesi hangi issue'ların başlamasını sağlar. */
  unblocks: string[];
  /** planned: DB tablosu henüz yok; sözleşme sabit, uygulama belirtilen işte. */
  availability: { status: "ready" } | { status: "planned"; tableIn: string };
  request: {
    params?: z.ZodType;
    query?: z.ZodType;
    body?: z.ZodType;
  };
  /** Başarılı status → gövde şeması (204 için z.null()). */
  responses: Record<number, z.ZodType>;
  /** Bu endpoint'e özgü hata kodları. Ortak ve yetkiden gelenler otomatik eklenir. */
  errors: ErrorCode[];
  idempotency: Idempotency;
  cache: CachePolicy;
  notes?: string[];
};

/** Her endpoint'in dönebileceği ortak hatalar. */
export const commonErrors: readonly ErrorCode[] = ["VALIDATION_ERROR", "RATE_LIMITED", "MAINTENANCE", "INTERNAL_ERROR"];

const authErrors: Record<Auth, ErrorCode[]> = {
  public: [],
  user: ["UNAUTHENTICATED", "ACCOUNT_RESTRICTED"],
  verified: ["UNAUTHENTICATED", "ACCOUNT_RESTRICTED", "EMAIL_NOT_VERIFIED"],
  owner: ["UNAUTHENTICATED", "ACCOUNT_RESTRICTED", "FORBIDDEN"],
  moderator: ["UNAUTHENTICATED", "FORBIDDEN"],
  admin: ["UNAUTHENTICATED", "FORBIDDEN"],
  super_admin: ["UNAUTHENTICATED", "FORBIDDEN"],
};

const idempotencyErrors: Record<Idempotency, ErrorCode[]> = {
  none: [],
  natural: [],
  "key-optional": ["IDEMPOTENCY_KEY_REUSED"],
  "key-required": ["IDEMPOTENCY_KEY_REQUIRED", "IDEMPOTENCY_KEY_REUSED"],
};

/** Endpoint'in dönebileceği bütün hata kodları (özgü + ortak + yetki + idempotency). */
export function allErrors(endpoint: EndpointContract): ErrorCode[] {
  const pathHasId = endpoint.path.includes(":");
  return [
    ...new Set<ErrorCode>([
      ...commonErrors,
      ...authErrors[endpoint.auth],
      ...idempotencyErrors[endpoint.idempotency],
      ...(pathHasId ? (["NOT_FOUND"] as ErrorCode[]) : []),
      ...endpoint.errors,
    ]),
  ];
}

export function defineEndpoint(endpoint: EndpointContract): EndpointContract {
  return endpoint;
}

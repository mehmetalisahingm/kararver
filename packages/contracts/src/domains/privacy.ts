// Kullanıcının kendi hesabını silmesi (KVKK) — #181, KV-33 §12. Yönetici başlatmalı karşılığı admin.users.erasure.* (admin.ts).
// Akış: önizleme → parola (+MFA) ve yazılı teyitle talep → e-postadaki bağlantıda açık onay → geri alınamaz anonimleştirme.
import { z } from "zod";
import { dataOf, Id, Timestamp } from "../common.ts";
import { defineEndpoint } from "../endpoint.ts";
import { AccountErasurePreview, ErasureBlocker } from "./admin.ts";

const Token = z.string().min(20).max(256);
const owner = { owner: "Mert", module: "account-deletion" } as const;
const web = ["Ümit (web)"];

export const SelfDeletionStatus = z.enum(["OPEN", "COMPLETED", "CANCELLED", "EXPIRED", "FAILED"]);
export const SelfDeletionRequestView = z.strictObject({
  id: Id,
  status: SelfDeletionStatus,
  expiresAt: Timestamp,
  createdAt: Timestamp,
  finishedAt: Timestamp.nullable(),
  /** CANCELLED/FAILED için kısa kod (replaced, user, link, blocked:<kod> ...). */
  failure: z.string().nullable(),
});
/** Kullanıcının kendi önizlemesi: yasal saklamanın gerekçesi gösterilmez (yalnız engel kodu). */
export const SelfDeletionPreview = z.strictObject({
  username: z.string(),
  /** Ayar account.selfDeletionEnabled; kapalıyken talep açılamaz. */
  enabled: z.boolean(),
  canRequest: z.boolean(),
  blockers: z.array(ErasureBlocker),
  /** MFA açıksa talep öncesi yeni bir step-up (me.mfa.stepup) gerekir. */
  mfaRequired: z.boolean(),
  request: SelfDeletionRequestView.nullable(),
  willRemove: AccountErasurePreview.shape.willRemove,
  willRetain: AccountErasurePreview.shape.willRetain,
});
export const SelfDeletionStarted = z.strictObject({ status: z.enum(["CONFIRMATION_SENT", "SEND_FAILED"]), expiresAt: Timestamp.nullable() });
export const SelfDeletionDone = z.strictObject({ status: z.enum(["deleted", "unchanged"]) });

export const privacyEndpoints = [
  defineEndpoint({
    id: "me.deletion.preview",
    domain: "auth",
    method: "GET",
    path: "/me/deletion",
    summary: "Hesabımı silme önizlemesi (silinecek/korunacak kayıtlar, engeller, açık talep)",
    auth: "user",
    provider: owner,
    consumers: web,
    unblocks: ["#181"],
    availability: { status: "ready" },
    request: {},
    responses: { 200: dataOf(SelfDeletionPreview) },
    errors: [],
    idempotency: "none",
    cache: "private",
    notes: [
      "Salt okuma. Kapsam ve saklama tablosu yönetici başlatmalı anonimleştirmeyle aynıdır (docs/KV-33_ADMIN_USERS.md §10); yasal saklamanın gerekçesi kullanıcıya gösterilmez, yalnız engel kodu döner.",
      "blockers: legal_hold, active_sanction, has_role, export_in_progress. Engel varken canRequest=false; çözümü için destek ile iletişim gerekir.",
    ],
  }),
  defineEndpoint({
    id: "me.deletion.request",
    domain: "auth",
    method: "POST",
    path: "/me/deletion",
    summary: "Hesap silme talebi aç (parola + yazılı teyit); onay bağlantısı e-postaya gider",
    auth: "user",
    provider: owner,
    consumers: web,
    unblocks: ["#181"],
    availability: { status: "ready" },
    request: { body: z.strictObject({ password: z.string().min(1).max(128), confirmUsername: z.string().trim().min(1).max(60) }) },
    responses: { 202: dataOf(SelfDeletionStarted) },
    errors: ["INVALID_CREDENTIALS", "CONFLICT", "RATE_LIMITED", "FEATURE_DISABLED"],
    idempotency: "none",
    cache: "private",
    notes: [
      "Yeniden kimlik doğrulama: mevcut parola (yanlışı giriş başarısızlık sayacına eklenir) ve MFA açıksa bu oturumda taze step-up. Yazılı teyit hesabın kullanıcı adıdır. Bu adım HESABI SİLMEZ: hesabın kayıtlı e-postasına 24 saat geçerli onay ve iptal bağlantıları gider.",
      "409 CONFLICT details[0].code: confirmation_mismatch, mfa_required, legal_hold, active_sanction, has_role, export_in_progress. Açık talep varsa yenisi öncekini iptal eder (replaced). Saatte en çok 3 talep, 60 sn bekleme (429). Ayar account.selfDeletionEnabled kapalıyken 503.",
      "SEND_FAILED: e-posta gönderilemedi; talep açık bırakılmaz, yeniden denenir.",
    ],
  }),
  defineEndpoint({
    id: "me.deletion.cancel",
    domain: "auth",
    method: "DELETE",
    path: "/me/deletion",
    summary: "Açık hesap silme talebini iptal et",
    auth: "user",
    provider: owner,
    consumers: web,
    unblocks: ["#181"],
    availability: { status: "ready" },
    request: {},
    responses: { 200: dataOf(z.strictObject({ cancelled: z.boolean() })) },
    errors: [],
    idempotency: "natural",
    cache: "private",
    notes: ["Idempotent: açık talep yoksa cancelled=false, değişiklik ve audit yok. Özellik kapalıyken de çalışır (güvenli yön)."],
  }),
  defineEndpoint({
    id: "auth.deletion.confirm",
    domain: "auth",
    method: "POST",
    path: "/auth/deletion/confirm",
    summary: "E-postadaki bağlantıyla hesabı kalıcı olarak sil (açık onay)",
    auth: "public",
    provider: owner,
    consumers: web,
    unblocks: ["#181"],
    availability: { status: "ready" },
    request: { body: z.strictObject({ token: Token }) },
    responses: { 200: dataOf(SelfDeletionDone) },
    errors: ["TOKEN_INVALID_OR_EXPIRED", "CONFLICT"],
    idempotency: "natural",
    cache: "private",
    notes: [
      "GERİ ALINAMAZ. Yetki token'dır (oturum gerekmez); sayfa açılışı hiçbir şey yapmaz, kullanıcı açıkça onaylar. Aynı transaction'da hesap anonimleştirilir (KV-33 §10): kişisel alanlar tombstone, oturumlar kapanır, paylaşım/yorum metinleri kaldırılır, oyların hesapla bağı kaldırılır.",
      "Tekrar tıklama idempotenttir (200 unchanged). Süresi dolmuş, iptal edilmiş veya başarısız talebin token'ı 400 TOKEN_INVALID_OR_EXPIRED.",
      "409 CONFLICT details[0].code: legal_hold, active_sanction, has_role, export_in_progress (talep ile onay arasında engel doğduysa; talep FAILED olur ve hiçbir şey silinmez).",
      "Silme sonrası eski e-posta adresine tamamlandı bildirimi gider (adres artık hesapta tutulmaz).",
    ],
  }),
  defineEndpoint({
    id: "auth.deletion.cancel",
    domain: "auth",
    method: "POST",
    path: "/auth/deletion/cancel",
    summary: "E-postadaki 'bu ben değilim' bağlantısı: talebi iptal et ve oturumları kapat",
    auth: "public",
    provider: owner,
    consumers: web,
    unblocks: ["#181"],
    availability: { status: "ready" },
    request: { body: z.strictObject({ token: Token }) },
    responses: { 200: dataOf(z.strictObject({ cancelled: z.literal(true) })) },
    errors: ["TOKEN_INVALID_OR_EXPIRED", "CONFLICT"],
    idempotency: "natural",
    cache: "private",
    notes: [
      "Açık talep iptal edilir, hesabın bütün oturumları kapanır ve bekleyen doğrulama/sıfırlama bağlantıları geçersiz olur (talebi sen açmadıysan hesap ele geçirilmiş olabilir). Tekrar tıklama 200.",
      "409 CONFLICT details[0].code: already_deleted (hesap zaten silinmiş; geri alınamaz).",
    ],
  }),
];

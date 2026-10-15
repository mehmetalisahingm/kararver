// email-change.expire — #181 e-posta değişimi. Kurallar: docs/KV-33_ADMIN_USERS.md §11.
//
// Açık talep 24 saat geçerlidir. API, süresi geçmiş talebi dokunulduğunda kapatır; kimse dokunmazsa bu iş kapatır ve yeni
// adresi (kişisel veri) siler. Tek koşullu UPDATE: iki worker aynı satırı ikinci kez sonlandıramaz; onay anında API'nin
// hesap kilidi altındaki karar ile yarışırsa ikisinden biri kazanır (durum OPEN değilse bu iş dokunmaz).
import type { PrismaClient } from "@kararver/db";

export const EMAIL_CHANGE_EXPIRE_QUEUE = "email-change.expire";
export const EMAIL_CHANGE_EXPIRE_CRON = "*/10 * * * *";

export type EmailChangeExpireDeps = { prisma: PrismaClient; now: () => Date };

export async function expireEmailChanges(deps: EmailChangeExpireDeps): Promise<{ expired: number }> {
  const at = deps.now();
  const done = await deps.prisma.emailChangeRequest.updateMany({
    where: { status: "OPEN", expiresAt: { lte: at } },
    data: { status: "EXPIRED", newEmail: null, newEmailNormalized: null, finishedAt: at },
  });
  return { expired: done.count };
}

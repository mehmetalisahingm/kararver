import { appealResolutionUrgency, type AppealSlaCase } from "./appeal-resolution-sla.ts";

/**
 * V1 #290: notification payloads for a future authenticated appeal case
 * workflow. Intents are NOT sent by this module: dispatch, moderator scope,
 * non-optional notification settings, and durable dedupe need integration.
 *
 * No free-text rejection reason, user email, poll title or sensitive content.
 */
export type AppealNoticeKind =
  | "APPEAL_RECEIVED"
  | "APPEAL_DUE_SOON_STAFF"
  | "APPEAL_OVERDUE_STAFF"
  | "APPEAL_RESOLVED_ACCEPTED"
  | "APPEAL_RESOLVED_REJECTED";

export type AppealNoticeIntent = {
  kind: AppealNoticeKind;
  audience: "APPELLANT" | "AUTHORIZED_STAFF";
  caseId: string;
  dedupeKey: string;
  message: string;
};

/** Only the authorized delivery service may resolve the actual recipient. */
export function appealNoticeIntent(kind: AppealNoticeKind, caseId: string): AppealNoticeIntent {
  const staff = kind.endsWith("_STAFF");
  const messages: Record<AppealNoticeKind, string> = {
    APPEAL_RECEIVED: "İtiraz başvurun alındı. Hedefimiz 14 takvim günü içinde incelemeyi tamamlamak.",
    APPEAL_DUE_SOON_STAFF: "Bir itiraz dosyasının 14 günlük inceleme hedefinin bitmesine 48 saatten az kaldı.",
    APPEAL_OVERDUE_STAFF: "Bir itiraz dosyası 14 günlük inceleme hedefini aştı. Yetkili personele eskale edin; otomatik karar vermeyin.",
    APPEAL_RESOLVED_ACCEPTED: "İtiraz başvurun kabul edildi. Sonuç ve içerik durumunu hesabından inceleyebilirsin.",
    APPEAL_RESOLVED_REJECTED: "İtirazın incelendi ve sonuçlandırıldı. Gerekçeli kararı hesabından inceleyebilirsin.",
  };
  return {
    kind,
    audience: staff ? "AUTHORIZED_STAFF" : "APPELLANT",
    caseId,
    dedupeKey: `appeal:${caseId}:${kind}`,
    message: messages[kind],
  };
}


/** Pure advisory candidate; call on canonical filed_at, never on delivery time.
 * Resolved/erased records produce no intent. Callers must atomically verify
 * current eligibility and persist dedupeKey before any real dispatch.
 */
export function appealReminderCandidate(input: AppealSlaCase & { rejectionActionId: string; erased: boolean }, now: Date): AppealNoticeIntent | null {
  if (input.erased) return null;
  const urgency = appealResolutionUrgency(input, now);
  if (urgency === "DUE_SOON") return appealNoticeIntent("APPEAL_DUE_SOON_STAFF", input.rejectionActionId);
  if (urgency === "OVERDUE") return appealNoticeIntent("APPEAL_OVERDUE_STAFF", input.rejectionActionId);
  return null;
}

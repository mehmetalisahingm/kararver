"use client";
// Tek moderasyon kararının güvenli geri alınması (#183, KV-37 §10): pencere açılınca önizleme otomatik yüklenir (salt okuma) →
// gerekçe → Geri al. Onay önizlemenin özetine (digest) bağlıdır; araya daha yeni karar girdiyse veya içerik değiştiyse sunucu
// reddeder ve önizleme yenilenir. Telafi kararı yeni bir kayıttır; eski karar ve audit değişmez.
import { useEffect, useState } from "react";
import type { AdminClient, HistoryAction, UndoActionPreviewView } from "./admin-client.ts";
import { ActionDialog, errorMessage } from "./admin-ui";
import { actionUndoBlockedLabels, actionUndoSummary } from "./bulk-model.ts";
import { historyActionLabels } from "./content-model.ts";

type Props = { admin: AdminClient; item: HistoryAction | null; onClose: () => void; onDone: (message: string) => void };

export function ActionUndoDialog({ admin, item, onClose, onDone }: Props) {
  const [preview, setPreview] = useState<UndoActionPreviewView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setPreview(null);
    setError("");
    if (!item) return;
    const controller = new AbortController();
    setBusy(true);
    admin.actionUndoPreview(item.id, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setPreview(value); })
      .catch((cause) => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [admin, item, attempt]);

  return (
    <ActionDialog
      open={item !== null}
      title="Kararı geri al"
      description="Telafi kararı yeni bir kayıt olarak uygulanır ve ayrı audit kaydı yazılır; eski karar değişmez. Kararın kapattığı raporlar yeniden açılmaz. Araya daha yeni karar girmişse, durum değişmişse veya içerik sahibi silinmişse geri alınmaz."
      submitLabel="Geri al"
      onClose={onClose}
      validate={() => (preview?.outcome !== "WILL_UNDO" ? "Bu karar geri alınamıyor: önizlemeyi kontrol et." : null)}
      onSubmit={async (reason) => {
        try {
          await admin.undoAction(item!.id, reason, preview!.digest);
          onDone(`Karar geri alındı (${historyActionLabels[item!.action] ?? item!.action}); telafi kaydı yazıldı.`);
        } catch (cause) {
          // Kayıt önizlemeden sonra değiştiyse önizleme eskidir: yeniden yüklenir.
          setAttempt((n) => n + 1);
          throw cause;
        }
      }}
    >
      {busy ? <p role="status">Önizleme alınıyor…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {preview ? (
        <>
          <p role="status">{actionUndoSummary(preview)}</p>
          {preview.blocked ? <p role="alert">{actionUndoBlockedLabels[preview.blocked] ?? preview.blocked}</p> : null}
        </>
      ) : null}
    </ActionDialog>
  );
}

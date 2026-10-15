"use client";
// Toplu işlemin güvenli geri alınması (#183): pencere açılınca önizleme otomatik yüklenir (salt okuma, kayıt başına sonuç) →
// gerekçe → Uygula. Onay önizlemenin özetine (digest) bağlıdır; araya daha yeni karar girdiyse sunucu 409 preview_stale döner
// ve önizleme yenilenir. Geri alınamayan kayıtlar nedenleriyle görünür ve dokunulmaz; silinmiş içerik sahibinin içeriği asla geri gelmez.
import { useEffect, useState } from "react";
import type { AdminClient, ModerationBatch, UndoPreviewView } from "./admin-client.ts";
import { ActionDialog, errorMessage } from "./admin-ui";
import { canUndo, undoActionLabels, undoBlockedLabels, undoOutcomeLabels, undoPreviewSummary, undoResultSummary } from "./bulk-model.ts";
import styles from "./admin-shell.module.css";

type Props = { admin: AdminClient; batch: ModerationBatch | null; onClose: () => void; onDone: (message: string) => void };

export function UndoDialog({ admin, batch, onClose, onDone }: Props) {
  const [preview, setPreview] = useState<UndoPreviewView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setPreview(null);
    setError("");
    if (!batch) return;
    const controller = new AbortController();
    setBusy(true);
    admin.undoPreview(batch.id, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setPreview(value); })
      .catch((cause) => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [admin, batch, attempt]);

  return (
    <ActionDialog
      open={batch !== null}
      title="Toplu işlemi geri al"
      description="Her karar için telafi kararı uygulanır ve ayrı audit kaydı yazılır; eski kayıtlar değişmez. Araya daha yeni karar girmiş, durumu değişmiş veya sahibi silinmiş içerik geri alınmaz."
      submitLabel="Geri al"
      onClose={onClose}
      validate={() => (!canUndo(preview) ? "Geri alınacak karar yok: önizlemeyi kontrol et." : null)}
      onSubmit={async (reason) => {
        try {
          onDone(undoResultSummary(await admin.undoBatch(batch!.id, reason, preview!.digest)));
        } catch (cause) {
          // Kararlar önizlemeden sonra değiştiyse önizleme eskidir: yeniden yüklenir.
          setAttempt((n) => n + 1);
          throw cause;
        }
      }}
    >
      {busy ? <p role="status">Önizleme alınıyor…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {preview ? (
        <>
          <p role="status">{undoPreviewSummary(preview)}</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="sr-only">Geri alma önizlemesi</caption>
              <thead><tr><th scope="col">Kayıt</th><th scope="col">Şimdiki durum</th><th scope="col">Sonuç</th></tr></thead>
              <tbody>
                {preview.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.label ?? <span className="kv-muted">Gösterilemez</span>}</td>
                    <td>{item.status ?? "—"}</td>
                    <td>
                      {undoOutcomeLabels[item.outcome]}
                      {item.outcome === "WILL_UNDO" && item.undoAction ? ` — ${undoActionLabels[item.undoAction]}` : ""}
                      {item.blocked ? ` — ${undoBlockedLabels[item.blocked] ?? item.blocked}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </ActionDialog>
  );
}

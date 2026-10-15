"use client";
// Toplu moderasyon penceresi (#183): işlem seç → önizleme (salt okuma, kayıt başına sonuç) → gerekçe + onay → sonuç özeti.
// Onay, önizlenen durumun özetine (digest) bağlıdır; önizlemeden sonra durum değişirse sunucu 409 preview_stale döner ve
// önizleme yenilenir. Yetki sunucudadır: kapsam dışı kayıtlar "Uygulanamaz" görünür ve dokunulmaz.
import { useEffect, useState } from "react";
import type { AdminClient, BulkPreviewView, ContentKind } from "./admin-client.ts";
import { ActionDialog, errorMessage } from "./admin-ui";
import { blockedLabels, bulkActionLabels, canApply, outcomeLabels, previewSummary, resultSummary, type BulkAction } from "./bulk-model.ts";
import styles from "./admin-shell.module.css";

type Props = { admin: AdminClient; kind: ContentKind; ids: string[]; open: boolean; onClose: () => void; onDone: (message: string) => void };

export function BulkDialog({ admin, kind, ids, open, onClose, onDone }: Props) {
  const [action, setAction] = useState<BulkAction>("HIDE");
  const [preview, setPreview] = useState<BulkPreviewView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Seçim veya işlem değişince eski önizleme geçersizdir; pencere açılışında sıfırlanır.
  useEffect(() => { setPreview(null); setError(""); }, [open, action, ids.join(",")]);

  async function load() {
    setBusy(true);
    setError("");
    try {
      setPreview(await admin.bulkPreview(kind, ids, action));
    } catch (cause) {
      setPreview(null);
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const noun = kind === "polls" ? "anket" : "yorum";
  return (
    <ActionDialog
      open={open}
      title={`Seçilen ${ids.length} ${noun} için toplu işlem`}
      description="Önce önizleme al: her kaydın ne olacağı görünür. Yetkin olmayan topluluklardaki kayıtlar uygulanmaz. Her kayıt ayrı işlenir ve audit kaydına yazılır; biri başarısız olursa diğerleri etkilenmez."
      submitLabel="Uygula"
      onClose={onClose}
      validate={() => (!canApply(preview) ? "Uygulanacak kayıt yok: önce önizleme al." : null)}
      onSubmit={async (reason) => {
        try {
          const result = await admin.bulkApply(kind, { ids, action, reason, digest: preview!.digest });
          onDone(resultSummary(result));
        } catch (cause) {
          // Kayıtlar önizlemeden sonra değiştiyse önizleme eskidir: gizle, yeniden alınsın.
          setPreview(null);
          throw cause;
        }
      }}
    >
      <label>
        İşlem
        <select className="kv-input" value={action} onChange={(event) => setAction(event.target.value as BulkAction)}>
          {(Object.keys(bulkActionLabels) as BulkAction[]).map((value) => <option key={value} value={value}>{bulkActionLabels[value]}</option>)}
        </select>
      </label>
      <button type="button" className="kv-button kv-button--secondary" onClick={() => void load()} disabled={busy} aria-busy={busy}>
        {busy ? "Önizleme alınıyor…" : preview ? "Önizlemeyi yenile" : "Önizleme al"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {preview ? (
        <>
          <p role="status">{previewSummary(preview)}</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="sr-only">Toplu işlem önizlemesi</caption>
              <thead><tr><th scope="col">Kayıt</th><th scope="col">Şimdiki durum</th><th scope="col">Sonuç</th></tr></thead>
              <tbody>
                {preview.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.label ?? <span className="kv-muted">Gösterilemez</span>}</td>
                    <td>{item.status ?? "—"}</td>
                    <td>{outcomeLabels[item.outcome]}{item.blocked ? ` — ${blockedLabels[item.blocked] ?? item.blocked}` : ""}</td>
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

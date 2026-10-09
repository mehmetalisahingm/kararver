"use client";

// İçeriğin rapor + moderasyon geçmişi (KV-37): tek zaman çizgisi. Raporlayan kimliği sunucudan gelmez.
import { useCallback, useEffect, useId, useRef } from "react";
import { AdminClient } from "./admin-client.ts";
import type { ContentKind } from "./admin-client.ts";
import { historyActionLabels, reportStatusLabels } from "./content-model.ts";
import { ListState, formatDate, reasonLabels, useRemoteList } from "./admin-ui";
import styles from "./admin-shell.module.css";

export function HistoryDialog({ admin, kind, id, title, onClose }: { admin: AdminClient; kind: ContentKind; id: string | null; title: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const open = id !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className={styles.dialogBody}>
        <h2 id={titleId}>Rapor ve moderasyon geçmişi</h2>
        <p className="kv-muted">{title}</p>
        {id ? <HistoryList admin={admin} kind={kind} id={id} /> : null}
        <div className={styles.dialogActions}>
          <button type="button" className="kv-button" onClick={onClose}>Kapat</button>
        </div>
      </div>
    </dialog>
  );
}

function HistoryList({ admin, kind, id }: { admin: AdminClient; kind: ContentKind; id: string }) {
  const load = useCallback((cursor: string | undefined, signal: AbortSignal) => admin.history(kind, id, cursor, signal), [admin, kind, id]);
  const remote = useRemoteList(load);
  return (
    <>
      {remote.items.length > 0 ? (
        <ol className={styles.timeline} aria-label="Geçmiş, en yeni önce">
          {remote.items.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              <time dateTime={item.at}>{formatDate(item.at)}</time>
              {item.kind === "REPORT" ? (
                <p>
                  <strong>Rapor</strong> · {reasonLabels[item.reason] ?? item.reason} · {reportStatusLabels[item.status]}
                  {item.note ? <><br /><small className="kv-muted">Not: {item.note}</small></> : null}
                  {item.resolvedBy ? (
                    <><br /><small className="kv-muted">{item.resolvedBy.displayName} sonuçlandırdı{item.resolutionNote ? `: ${item.resolutionNote}` : ""}</small></>
                  ) : null}
                </p>
              ) : (
                <p>
                  <strong>{historyActionLabels[item.action] ?? item.action}</strong> · {item.actor.displayName}
                  {item.fromStatus && item.toStatus && item.fromStatus !== item.toStatus ? <> · {item.fromStatus} → {item.toStatus}</> : null}
                  <br />
                  <small className="kv-muted">Gerekçe: {item.reason}</small>
                  {item.reportId ? <><br /><small className="kv-muted">Rapora bağlı işlem</small></> : null}
                </p>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      <ListState remote={remote} empty="Bu içerik için rapor veya moderasyon kaydı yok." />
    </>
  );
}

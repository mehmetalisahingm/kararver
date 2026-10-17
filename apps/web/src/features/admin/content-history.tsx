"use client";

// İçeriğin rapor + moderasyon geçmişi (KV-37): tek zaman çizgisi. Raporlayan kimliği sunucudan gelmez.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useProduct } from "../../components/product-provider";
import { AdminClient } from "./admin-client.ts";
import type { ContentKind, HistoryAction } from "./admin-client.ts";
import { ActionUndoDialog } from "./action-undo-dialog";
import { canOfferActionUndo } from "./bulk-model.ts";
import { historyActionLabels, reportStatusLabels } from "./content-model.ts";
import { ListState, formatDate, isAdminRole, reasonLabels, useAdminRoles, useRemoteList } from "./admin-ui";
import styles from "./admin-shell.module.css";

export function HistoryDialog({ admin, kind, id, title, onClose, onChanged }: { admin: AdminClient; kind: ContentKind; id: string | null; title: string; onClose: () => void; onChanged?: (message: string) => void }) {
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
        {id ? <HistoryList admin={admin} kind={kind} id={id} onChanged={onChanged} /> : null}
        <div className={styles.dialogActions}>
          <button type="button" className="kv-button" onClick={onClose}>Kapat</button>
        </div>
      </div>
    </dialog>
  );
}

function HistoryList({ admin, kind, id, onChanged }: { admin: AdminClient; kind: ContentKind; id: string; onChanged?: (message: string) => void }) {
  const load = useCallback((cursor: string | undefined, signal: AbortSignal) => admin.history(kind, id, cursor, signal), [admin, kind, id]);
  const remote = useRemoteList(load);
  const { user } = useProduct();
  const isAdmin = isAdminRole(useAdminRoles());
  const [undoing, setUndoing] = useState<HistoryAction | null>(null);
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
                  <strong>{item.undoOfId ? "Geri alma: " : ""}{historyActionLabels[item.action] ?? item.action}</strong> · {item.actor.displayName}
                  {item.undone ? <> · <em>geri alındı</em></> : null}
                  {item.fromStatus && item.toStatus && item.fromStatus !== item.toStatus ? <> · {item.fromStatus} → {item.toStatus}</> : null}
                  <br />
                  <small className="kv-muted">Gerekçe: {item.reason}</small>
                  {item.reportId ? <><br /><small className="kv-muted">Rapora bağlı işlem</small></> : null}
                  {canOfferActionUndo(item, user?.id ?? null, isAdmin) ? <> <button type="button" className="kv-button kv-button--ghost" onClick={() => setUndoing(item)}>Geri al…</button></> : null}
                </p>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      <ListState remote={remote} empty="Bu içerik için rapor veya moderasyon kaydı yok." />
      <ActionUndoDialog admin={admin} item={undoing} onClose={() => setUndoing(null)} onDone={(message) => { remote.reload(); onChanged?.(message); }} />
    </>
  );
}

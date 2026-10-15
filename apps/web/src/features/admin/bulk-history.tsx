"use client";
// Toplu moderasyon geçmişi (#183): açılınca yüklenir. Moderatör kendi partilerini, yönetici hepsini görür (sunucu süzer).
// Geri alınabilir partide "Geri al…" güvenli geri alma penceresini açar; geri alma partileri ayrıca işaretlenir.
import { useEffect, useState } from "react";
import type { AdminClient, ModerationBatch } from "./admin-client.ts";
import { errorMessage, formatDate } from "./admin-ui";
import { bulkActionLabels } from "./bulk-model.ts";
import { UndoDialog } from "./undo-dialog";

export function BulkHistory({ admin, revision, onChanged }: { admin: AdminClient; revision: number; onChanged: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ModerationBatch[] | null>(null);
  const [error, setError] = useState("");
  const [undoing, setUndoing] = useState<ModerationBatch | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError("");
    admin.moderationBatches(undefined, controller.signal)
      .then((page) => { if (!controller.signal.aborted) setItems(page.items); })
      .catch((cause) => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [admin, open, revision, refresh]);

  return (
    <details onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary>Toplu işlem geçmişi</summary>
      {error ? <p role="alert">{error}</p> : null}
      {open && items === null && !error ? <p role="status">Yükleniyor…</p> : null}
      {items?.length === 0 ? <p className="kv-muted">Henüz toplu işlem yok.</p> : null}
      <ul>
        {items?.map((batch) => (
          <li key={batch.id}>
            {formatDate(batch.createdAt)} · @{batch.actor.username} · {batch.kind === "polls" ? "anket" : "yorum"} ·{" "}
            {batch.undoOfId ? "Geri alma" : bulkActionLabels[batch.action]} · {batch.applied} uygulandı, {batch.unchanged} değişmedi, {batch.failed} başarısız
            {batch.undone > 0 ? ` · ${batch.undone} karar geri alındı` : ""} · <span className="kv-muted">{batch.reason}</span>
            {batch.undoable ? <> <button className="kv-button kv-button--ghost" onClick={() => setUndoing(batch)}>Geri al…</button></> : null}
          </li>
        ))}
      </ul>
      <UndoDialog admin={admin} batch={undoing} onClose={() => setUndoing(null)} onDone={(message) => { setRefresh((n) => n + 1); onChanged(message); }} />
    </details>
  );
}

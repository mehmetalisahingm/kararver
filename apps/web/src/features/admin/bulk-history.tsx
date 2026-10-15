"use client";
// Toplu moderasyon geçmişi (#183): açılınca yüklenir. Moderatör kendi partilerini, yönetici hepsini görür (sunucu süzer).
import { useEffect, useState } from "react";
import type { AdminClient, ModerationBatch } from "./admin-client.ts";
import { errorMessage, formatDate } from "./admin-ui";
import { bulkActionLabels } from "./bulk-model.ts";

export function BulkHistory({ admin, revision }: { admin: AdminClient; revision: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ModerationBatch[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError("");
    admin.moderationBatches(undefined, controller.signal)
      .then((page) => { if (!controller.signal.aborted) setItems(page.items); })
      .catch((cause) => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [admin, open, revision]);

  return (
    <details onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary>Toplu işlem geçmişi</summary>
      {error ? <p role="alert">{error}</p> : null}
      {open && items === null && !error ? <p role="status">Yükleniyor…</p> : null}
      {items?.length === 0 ? <p className="kv-muted">Henüz toplu işlem yok.</p> : null}
      <ul>
        {items?.map((batch) => (
          <li key={batch.id}>
            {formatDate(batch.createdAt)} · @{batch.actor.username} · {batch.kind === "polls" ? "anket" : "yorum"} · {bulkActionLabels[batch.action]} ·
            {" "}{batch.applied} uygulandı, {batch.unchanged} değişmedi, {batch.failed} başarısız · <span className="kv-muted">{batch.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

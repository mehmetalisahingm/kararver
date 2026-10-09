"use client";

// Değiştirilemez yönetim geçmişi (KV-39, #41). Yalnız okuma: audit için yazma/silme yoktur (sunucuda append-only).
// Süzgeçler admin.audit.list'e gider; önce/sonra özeti sunucuda hassas alandan arındırılmış küçük bir nesnedir.
import { useCallback, useState } from "react";
import type { AdminClient, AuditRecord, AuditSearch } from "./admin-client.ts";
import { ListState, formatDate, shortId, useRemoteList } from "./admin-ui";
import styles from "./admin-shell.module.css";

const sourceLabels: Record<AuditRecord["source"], string> = { API: "Yönetici", CLI: "Komut satırı", WORKER: "Sistem işi" };
const targetTypes = ["USER", "POLL", "COMMENT", "MEDIA", "COMMUNITY", "CATEGORY", "REPORT", "VOTE", "SETTING", "ANNOUNCEMENT", "FEATURED"];

/** Gün seçimi (yyyy-mm-dd) → yerel gün başı ISO; "bitiş" günü dahil olsun diye ertesi gün başı. */
const dayStart = (day: string, plus = 0) => {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + plus);
  return d.toISOString();
};

const summary = (value: unknown) => (value === null || value === undefined ? "—" : JSON.stringify(value, null, 2));

export function AuditPanel({ admin }: { admin: AdminClient }) {
  const [draft, setDraft] = useState({ action: "", targetType: "", targetId: "", source: "", from: "", to: "" });
  const [search, setSearch] = useState<AuditSearch>({});
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback((cursor: string | undefined, signal: AbortSignal) => admin.audit(search, cursor, signal), [admin, search]);
  const list = useRemoteList(load);

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    setOpen(null);
    setSearch({
      action: draft.action.trim() || undefined,
      targetType: draft.targetType || undefined,
      targetId: draft.targetId.trim() || undefined,
      source: (draft.source || undefined) as AuditSearch["source"],
      from: draft.from ? dayStart(draft.from) : undefined,
      to: draft.to ? dayStart(draft.to, 1) : undefined,
    });
  };

  return (
    <>
      <form className={styles.toolbar} role="search" aria-label="Audit süzgeçleri" onSubmit={apply}>
        <label>
          İşlem
          <input className="kv-input" placeholder="ör. user.sanction" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} />
        </label>
        <label>
          Hedef türü
          <select className="kv-input" value={draft.targetType} onChange={(e) => setDraft({ ...draft, targetType: e.target.value })}>
            <option value="">Tümü</option>
            {targetTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Hedef kimliği
          <input className="kv-input" value={draft.targetId} onChange={(e) => setDraft({ ...draft, targetId: e.target.value })} />
        </label>
        <label>
          Kaynak
          <select className="kv-input" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })}>
            <option value="">Tümü</option>
            {(Object.keys(sourceLabels) as AuditRecord["source"][]).map((s) => <option key={s} value={s}>{sourceLabels[s]}</option>)}
          </select>
        </label>
        <label>
          Başlangıç
          <input className="kv-input" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </label>
        <label>
          Bitiş
          <input className="kv-input" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </label>
        <button className="kv-button kv-button--secondary" type="submit">Süz</button>
      </form>
      <p className="kv-help">Kayıtlar değiştirilemez ve silinemez. Önce/sonra özetinde parola, e-posta, oturum ve oy seçimi bulunmaz.</p>

      {list.items.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="sr-only">Audit kayıtları, en yeni önce</caption>
            <thead>
              <tr><th scope="col">Zaman</th><th scope="col">Yapan</th><th scope="col">İşlem</th><th scope="col">Hedef</th><th scope="col">Gerekçe</th><th scope="col">Ayrıntı</th></tr>
            </thead>
            <tbody>
              {list.items.map((entry) => (
                <AuditRow key={entry.id} entry={entry} open={open === entry.id} onToggle={() => setOpen(open === entry.id ? null : entry.id)} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <ListState remote={list} empty="Bu süzgeçle kayıt yok." />
    </>
  );
}

function AuditRow({ entry, open, onToggle }: { entry: AuditRecord; open: boolean; onToggle: () => void }) {
  const detailsId = `audit-${entry.id}`;
  return (
    <>
      <tr>
        <td>{formatDate(entry.createdAt)}</td>
        <td>{entry.actor ? <span title={entry.actor.id}>{entry.actor.displayName} <small className="kv-muted">@{entry.actor.username}</small></span> : sourceLabels[entry.source]}</td>
        <td><code>{entry.action}</code> <small className="kv-muted">{entry.operation}</small></td>
        <td><small title={entry.target.id}>{entry.target.type} · {shortId(entry.target.id)}</small></td>
        <td>{entry.reason ?? <span className="kv-muted">—</span>}</td>
        <td>
          <button className="kv-button kv-button--ghost" aria-expanded={open} aria-controls={detailsId} onClick={onToggle}>
            {open ? "Gizle" : "Göster"}
          </button>
        </td>
      </tr>
      {open ? (
        <tr id={detailsId}>
          <td colSpan={6}>
            <dl className="kv-stack">
              <div><dt>Önce</dt><dd><pre>{summary(entry.before)}</pre></dd></div>
              <div><dt>Sonra</dt><dd><pre>{summary(entry.after)}</pre></dd></div>
              <div><dt>İstek kimliği</dt><dd><code>{entry.requestId ?? "—"}</code></dd></div>
              <div><dt>Kayıt</dt><dd><code>{entry.id}</code></dd></div>
            </dl>
          </td>
        </tr>
      ) : null}
    </>
  );
}

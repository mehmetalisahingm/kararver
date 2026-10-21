"use client";

// Değiştirilemez yönetim geçmişi (KV-39, #41). Yalnız okuma: audit için yazma/silme yoktur (sunucuda append-only).
// Süzgeçler admin.audit.list'e gider; önce/sonra özeti sunucuda hassas alandan arındırılmış küçük bir nesnedir.
// Yetki sunucudadır (ADMIN+); buradaki kontroller yalnız yardımdır. Bütün kayıt alanları metin olarak basılır.
import { AUDIT_REASON_SEARCH_MAX_DAYS } from "@kararver/contracts";
import { useCallback, useState } from "react";
import type { AdminClient, AuditRecord, AuditSearch } from "./admin-client.ts";
import { ListState, formatDate, shortId, useRemoteList } from "./admin-ui";
import styles from "./admin-shell.module.css";
import { diffAuditSummary, diffKindLabels } from "./audit-diff";
import { dayStart, reasonSearchProblem } from "./audit-filters";
import { buildAuditExport, MAX_AUDIT_EXPORT_ROWS, type AuditExportFormat } from "./audit-export";

const sourceLabels: Record<AuditRecord["source"], string> = { API: "Yönetici", CLI: "Komut satırı", WORKER: "Sistem işi" };
const targetTypes = ["USER", "POLL", "COMMENT", "MEDIA", "COMMUNITY", "CATEGORY", "REPORT", "VOTE", "SETTING", "ANNOUNCEMENT", "FEATURED"];

const summary = (value: unknown) => (value === null || value === undefined ? "—" : JSON.stringify(value, null, 2));

export function AuditPanel({ admin }: { admin: AdminClient }) {
  const [draft, setDraft] = useState({ actorId: "", operation: "", action: "", targetType: "", targetId: "", source: "", from: "", to: "", requestId: "", reasonContains: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const [search, setSearch] = useState<AuditSearch>({});
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback((cursor: string | undefined, signal: AbortSignal) => admin.audit(search, cursor, signal), [admin, search]);
  const list = useRemoteList(load);
  const exportDisabled = list.loading || list.loadingMore || !!list.error || list.items.length === 0 || list.items.length > MAX_AUDIT_EXPORT_ROWS;
  function download(format: AuditExportFormat) {
    if (exportDisabled) return;
    const file = buildAuditExport(list.items, format, search, new Date());
    const url = URL.createObjectURL(new Blob([file.text], { type: file.contentType }));
    const link = document.createElement("a");
    link.href = url; link.download = file.filename;
    document.body.append(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
  }

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    const issue = reasonSearchProblem(draft);
    setProblem(issue);
    if (issue) return;
    setOpen(null);
    setSearch({
      actorId: draft.actorId.trim() || undefined,
      operation: draft.operation.trim() || undefined,
      action: draft.action.trim() || undefined,
      targetType: draft.targetType || undefined,
      targetId: draft.targetId.trim() || undefined,
      source: (draft.source || undefined) as AuditSearch["source"],
      from: draft.from ? dayStart(draft.from) : undefined,
      to: draft.to ? dayStart(draft.to, 1) : undefined,
      requestId: draft.requestId.trim() || undefined,
      reasonContains: draft.reasonContains.trim() || undefined,
    });
  };

  return (
    <>
      <form className={styles.toolbar} role="search" aria-label="Audit süzgeçleri" onSubmit={apply}>
        <label>İşlemi yapan kullanıcı kimliği<input className="kv-input" value={draft.actorId} onChange={e => setDraft({ ...draft, actorId: e.target.value })} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" title="Geçerli bir kullanıcı UUID kimliği girin" /></label>
        <label>İşlem türü<input className="kv-input" value={draft.operation} maxLength={40} placeholder="ör. revoke, grant, remove" onChange={e => setDraft({ ...draft, operation: e.target.value })} /></label>
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
          <input className="kv-input" type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </label>
        <label>
          İstek kimliği
          <input className="kv-input" value={draft.requestId} maxLength={128} onChange={(e) => setDraft({ ...draft, requestId: e.target.value })} />
        </label>
        <label>
          Gerekçede ara
          <input
            className="kv-input"
            type="search"
            value={draft.reasonContains}
            minLength={3}
            maxLength={100}
            aria-describedby="audit-reason-help"
            aria-invalid={problem ? true : undefined}
            onChange={(e) => setDraft({ ...draft, reasonContains: e.target.value })}
          />
        </label>
        <button className="kv-button kv-button--secondary" type="submit">Süz</button>
        <p id="audit-reason-help" className="kv-help">
          {problem ? <span role="alert">{problem}</span> : `Gerekçe araması için başlangıç ve bitiş tarihi gerekir (en çok ${AUDIT_REASON_SEARCH_MAX_DAYS} gün).`}
        </p>
      </form>
      <p className="kv-help">Kayıtlar değiştirilemez ve silinemez. Önce/sonra özetinde parola, e-posta, oturum ve oy seçimi bulunmaz.</p>
      <div className={styles.toolbar} role="group" aria-label="Audit dışa aktarma">
        <button className="kv-button kv-button--secondary" disabled={exportDisabled} onClick={() => download("csv")}>Yüklenen kayıtları CSV indir</button>
        <button className="kv-button kv-button--secondary" disabled={exportDisabled} onClick={() => download("json")}>Yüklenen kayıtları JSON indir</button>
        <p className="kv-help">Dosya yalnız yüklenen {list.items.length} kaydı içerir. En fazla {MAX_AUDIT_EXPORT_ROWS} kayıt indirilebilir; kapsamı tarih ve diğer süzgeçlerle daraltabilirsin.</p>
      </div>

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
              <div><dt>Değişen alanlar</dt><dd><AuditDiff entry={entry} /></dd></div>
              <div>
                <dt>Ham özet</dt>
                <dd>
                  <details>
                    <summary>Önce/sonra JSON</summary>
                    <p>Önce</p>
                    <pre>{summary(entry.before)}</pre>
                    <p>Sonra</p>
                    <pre>{summary(entry.after)}</pre>
                  </details>
                </dd>
              </div>
              <div><dt>İstek kimliği</dt><dd><code>{entry.requestId ?? "—"}</code></dd></div>
              <div><dt>Kayıt</dt><dd><code>{entry.id}</code></dd></div>
            </dl>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Alan alan fark. Değişim türü metinle ve işaretle yazılır; renk tek başına anlam taşımaz. */
function AuditDiff({ entry }: { entry: AuditRecord }) {
  const rows = diffAuditSummary(entry.before, entry.after);
  if (rows.length === 0) return <p className="kv-muted">Alan farkı yok.</p>;
  return (
    <table className={styles.table}>
      <caption className="sr-only">Önce ve sonra arasındaki alan farkları</caption>
      <thead>
        <tr><th scope="col">Alan</th><th scope="col">Değişim</th><th scope="col">Önce</th><th scope="col">Sonra</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.path} data-diff={row.kind}>
            <th scope="row"><code>{row.path}</code></th>
            <td><span aria-hidden="true">{diffKindLabels[row.kind].mark} </span>{diffKindLabels[row.kind].label}</td>
            <td>{row.before ?? <span className="kv-muted">—</span>}</td>
            <td>{row.after ?? <span className="kv-muted">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

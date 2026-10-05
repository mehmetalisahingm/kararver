"use client";

// Moderasyon kuyruğu (KV-24, KV-37): rapor listesi, gerekçeli sonuçlandırma ve rapor edilen içeriğe işlem.
// Kuyrukta hedef başına tek satır görünür (reportCount); sonuçlandırma o hedefin açık raporlarını birlikte kapatır.
import { useCallback, useState } from "react";
import { AdminClient } from "./admin-client.ts";
import type { ModerationAction, Report, ReportStatus, ReportTargetType } from "./admin-client.ts";
import { ActionDialog, ListState, formatDate, reasonLabels, shortId, targetLabels, useNotice, useRemoteList } from "./admin-ui";
import styles from "./admin-shell.module.css";

const statusLabels: Record<ReportStatus, string> = { OPEN: "Açık", ACTIONED: "İşlem yapıldı", DISMISSED: "Reddedildi" };

const pollActions: [ModerationAction, string][] = [
  ["HIDE", "Gizle"],
  ["REMOVE", "Kaldır"],
  ["LOCK", "Kilitle"],
  ["EXCLUDE_FROM_TRENDS", "Trendden çıkar"],
];
const commentActions: [ModerationAction, string][] = [
  ["HIDE", "Gizle"],
  ["REMOVE", "Kaldır"],
];

type Dialog = { kind: "resolve"; report: Report } | { kind: "content"; report: Report } | { kind: "media"; report: Report } | null;

export function ReportsPanel({ admin }: { admin: AdminClient }) {
  const [status, setStatus] = useState<ReportStatus>("OPEN");
  const [targetType, setTargetType] = useState<ReportTargetType | "">("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [resolution, setResolution] = useState<"ACTIONED" | "DISMISSED">("DISMISSED");
  const [action, setAction] = useState<ModerationAction>("HIDE");
  const { setNotice, element } = useNotice();

  const load = useCallback(
    (cursor: string | undefined, signal: AbortSignal) => admin.reports({ status, targetType: targetType || undefined, cursor }, signal),
    [admin, status, targetType],
  );
  const remote = useRemoteList(load);
  const close = () => setDialog(null);
  const done = (message: string) => {
    setNotice(message);
    remote.reload();
  };

  const target = dialog?.report.target;
  const contentActions = target?.type === "COMMENT" ? commentActions : pollActions;

  return (
    <>
      <div className={styles.toolbar} role="group" aria-label="Rapor filtreleri">
        <label>
          Durum
          <select className="kv-input" value={status} onChange={(event) => setStatus(event.target.value as ReportStatus)}>
            {(Object.keys(statusLabels) as ReportStatus[]).map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
          </select>
        </label>
        <label>
          Hedef
          <select className="kv-input" value={targetType} onChange={(event) => setTargetType(event.target.value as ReportTargetType | "")}>
            <option value="">Tümü</option>
            {Object.entries(targetLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      {element}
      {remote.items.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="sr-only">Moderasyon kuyruğu</caption>
            <thead>
              <tr><th scope="col">Hedef</th><th scope="col">Neden</th><th scope="col">Rapor</th><th scope="col">Tarih</th><th scope="col">İşlem</th></tr>
            </thead>
            <tbody>
              {remote.items.map((report) => (
                <tr key={report.id}>
                  <td>
                    <strong>{targetLabels[report.target.type]}</strong>
                    <br />
                    <small className="kv-muted" title={report.target.id}>{shortId(report.target.id)}</small>
                    {report.communityId ? <><br /><small className="kv-muted">Topluluk içi</small></> : null}
                  </td>
                  <td>
                    {reasonLabels[report.reason] ?? report.reason}
                    {report.note ? <><br /><small className="kv-muted">{report.note}</small></> : null}
                  </td>
                  <td>{report.reportCount}</td>
                  <td>{formatDate(report.status === "OPEN" ? report.createdAt : report.resolvedAt)}</td>
                  <td>
                    <div className={styles.rowActions}>
                      {report.status === "OPEN" ? (
                        <>
                          <button className="kv-button kv-button--ghost" onClick={() => { setResolution("DISMISSED"); setDialog({ kind: "resolve", report }); }}>Sonuçlandır</button>
                          {report.target.type === "POLL" || report.target.type === "COMMENT" ? (
                            <button className="kv-button kv-button--ghost" onClick={() => { setAction("HIDE"); setDialog({ kind: "content", report }); }}>İçeriğe işlem</button>
                          ) : null}
                          {report.target.type === "MEDIA" ? (
                            <button className="kv-button kv-button--ghost" onClick={() => setDialog({ kind: "media", report })}>Görseli reddet</button>
                          ) : null}
                        </>
                      ) : (
                        <span className="kv-muted">{statusLabels[report.status]}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <ListState remote={remote} empty={status === "OPEN" ? "Açık rapor yok." : "Bu durumda rapor yok."} />

      <ActionDialog
        open={dialog?.kind === "resolve"}
        title="Raporu sonuçlandır"
        description="Aynı hedefe gelen bütün açık raporlar birlikte kapanır. İçeriğe işlem uygulamak için önce “İçeriğe işlem”i kullan."
        submitLabel="Sonuçlandır"
        reasonLabel="Gerekçe"
        onClose={close}
        onSubmit={async (reason) => {
          await admin.resolveReport(dialog!.report.id, resolution, reason);
          done(resolution === "DISMISSED" ? "Rapor reddedildi." : "Rapor işlem yapıldı olarak kapatıldı.");
        }}
      >
        <label>
          Karar
          <select className="kv-input" value={resolution} onChange={(event) => setResolution(event.target.value as "ACTIONED" | "DISMISSED")}>
            <option value="DISMISSED">Reddet (işlem gerekmedi)</option>
            <option value="ACTIONED">İşlem yapıldı</option>
          </select>
        </label>
      </ActionDialog>

      <ActionDialog
        open={dialog?.kind === "content"}
        title="Rapor edilen içeriğe işlem"
        description="Gizleme, kaldırma ve kilitleme hedefin açık raporlarını da kapatır. Her işlem audit kaydına yazılır."
        submitLabel="Uygula"
        onClose={close}
        onSubmit={async (reason) => {
          const kind = dialog!.report.target.type === "COMMENT" ? "comments" : "polls";
          await admin.moderate(kind, dialog!.report.target.id, action, reason);
          done("İşlem uygulandı.");
        }}
      >
        <label>
          İşlem
          <select className="kv-input" value={action} onChange={(event) => setAction(event.target.value as ModerationAction)}>
            {contentActions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </ActionDialog>

      <ActionDialog
        open={dialog?.kind === "media"}
        title="Görseli reddet"
        description="Görsel yayından kalkar ve rapor kapanır. Orijinal dosya kanıt olarak saklanır."
        submitLabel="Reddet"
        onClose={close}
        onSubmit={async (reason) => {
          await admin.decideMedia(dialog!.report.target.id, "REJECT", reason);
          done("Görsel reddedildi.");
        }}
      />
    </>
  );
}

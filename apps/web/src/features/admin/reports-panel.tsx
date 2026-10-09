"use client";

// Moderasyon kuyruğu (KV-24, KV-37): rapor listesi, gerekçeli sonuçlandırma, rapor edilen içeriğe işlem, içerik sahibini
// uyarma ve (yönetici) yaptırım, içeriğin rapor + moderasyon geçmişi.
// Kuyrukta hedef başına tek satır görünür (reportCount); sonuçlandırma, uyarı ve yaptırım o hedefin açık raporlarını
// birlikte kapatır. Uyarı ve yaptırım rapora bağlı yazılır (moderation_actions + audit).
import { useCallback, useEffect, useState } from "react";
import { AdminClient } from "./admin-client.ts";
import type { Community, ModerationAction, Report, ReportStatus, ReportTargetType, StrongSanction } from "./admin-client.ts";
import { HistoryDialog } from "./content-history";
import { statusLabels as contentStatusLabels, suspendUntil } from "./content-model.ts";
import { ActionDialog, ListState, formatDate, isAdminRole, reasonLabels, shortId, targetLabels, useAdminRoles, useNotice, useRemoteList } from "./admin-ui";
import styles from "./admin-shell.module.css";

const statusLabels: Record<ReportStatus, string> = { OPEN: "Açık", ACTIONED: "İşlem yapıldı", DISMISSED: "Reddedildi" };

const pollActions: [ModerationAction, string][] = [
  ["HIDE", "Gizle"],
  ["REMOVE", "Kaldır"],
  ["LOCK", "Kilitle"],
  ["EXCLUDE_FROM_TRENDS", "Trendden çıkar"],
  ["CLOSE_COMMENTS", "Yorumları kapat (oy açık kalır)"],
];
const commentActions: [ModerationAction, string][] = [
  ["HIDE", "Gizle"],
  ["REMOVE", "Kaldır"],
];

const sanctionLabels: Record<StrongSanction, string> = {
  RESTRICT_COMMENTS: "Yorum yapmayı kısıtla",
  RESTRICT_POSTING: "Paylaşım yapmayı kısıtla",
  SUSPEND: "Hesabı askıya al",
  BAN: "Hesabı yasakla",
};

type Dialog =
  | { kind: "resolve" | "content" | "media" | "warn" | "sanction" | "history"; report: Report }
  | null;

export function ReportsPanel({ admin }: { admin: AdminClient }) {
  const [status, setStatus] = useState<ReportStatus>("OPEN");
  const [targetType, setTargetType] = useState<ReportTargetType | "">("");
  const [communityId, setCommunityId] = useState("");
  const [communities, setCommunities] = useState<Community[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [resolution, setResolution] = useState<"ACTIONED" | "DISMISSED">("DISMISSED");
  const [action, setAction] = useState<ModerationAction>("HIDE");
  const [sanction, setSanction] = useState<StrongSanction>("RESTRICT_COMMENTS");
  const [days, setDays] = useState("7");
  const isAdmin = isAdminRole(useAdminRoles());
  const { setNotice, element } = useNotice();

  const load = useCallback(
    (cursor: string | undefined, signal: AbortSignal) => admin.reports({ status, targetType: targetType || undefined, communityId: communityId || undefined, cursor }, signal),
    [admin, status, targetType, communityId],
  );
  // Topluluk filtresi seçenekleri (ilk sayfa); liste alınamazsa filtre gizli kalır, kuyruk etkilenmez.
  useEffect(() => {
    const controller = new AbortController();
    admin.communities(undefined, controller.signal).then((page) => setCommunities(page.items), () => setCommunities([]));
    return () => controller.abort();
  }, [admin]);
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
        {communities.length > 0 ? (
          <label>
            Topluluk
            <select className="kv-input" value={communityId} onChange={(event) => setCommunityId(event.target.value)}>
              <option value="">Tümü</option>
              {communities.map((community) => <option key={community.id} value={community.id}>{community.name}</option>)}
            </select>
          </label>
        ) : null}
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
                    {report.contentStatus ? <> · {contentStatusLabels[report.contentStatus]}</> : null}
                    {report.excerpt ? <><br />{report.excerpt}</> : null}
                    <br />
                    <small className="kv-muted" title={report.target.id}>
                      {report.targetUser ? `@${report.targetUser.username} · ` : ""}
                      {shortId(report.target.id)}
                      {report.communityId ? " · topluluk içi" : ""}
                    </small>
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
                          {report.targetUser ? (
                            <button className="kv-button kv-button--ghost" onClick={() => setDialog({ kind: "warn", report })}>Uyar</button>
                          ) : null}
                          {report.targetUser && isAdmin ? (
                            <button className="kv-button kv-button--ghost" onClick={() => { setSanction("RESTRICT_COMMENTS"); setDays("7"); setDialog({ kind: "sanction", report }); }}>Yaptırım</button>
                          ) : null}
                        </>
                      ) : (
                        <span className="kv-muted">{statusLabels[report.status]}</span>
                      )}
                      {report.target.type === "POLL" || report.target.type === "COMMENT" ? (
                        <button className="kv-button kv-button--ghost" onClick={() => setDialog({ kind: "history", report })}>Geçmiş</button>
                      ) : null}
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
        open={dialog?.kind === "warn"}
        title="İçerik sahibini uyar"
        description={`@${dialog?.report.targetUser?.username ?? ""} hesabına uyarı yazılır (hesap durumu değişmez) ve bu hedefin açık raporları kapanır. İçeriğe dokunulmaz; gerekirse ayrıca gizle. Uyarı hesabın yaptırım geçmişinde ve audit kaydında görünür.`}
        submitLabel="Uyar"
        onClose={close}
        onSubmit={async (reason) => {
          await admin.warn(dialog!.report.id, reason);
          done("Uyarı yazıldı ve raporlar kapatıldı.");
        }}
      />

      <ActionDialog
        open={dialog?.kind === "sanction"}
        title="Yaptırım uygula"
        description={`@${dialog?.report.targetUser?.username ?? ""} hesabına yaptırım uygulanır; rapor ve moderasyon geçmişine bağlanır, hedefin açık raporları kapanır. Askı ve yasak açık oturumları sonlandırır.`}
        submitLabel="Uygula"
        onClose={close}
        validate={() => (sanction === "SUSPEND" && !(Number(days) >= 1 && Number(days) <= 365) ? "Askı süresi 1 ile 365 gün arasında olmalı." : null)}
        onSubmit={async (reason) => {
          await admin.sanction(dialog!.report.targetUser!.id, sanction, reason, dialog!.report.id, sanction === "SUSPEND" ? suspendUntil(Number(days)) : null);
          done("Yaptırım uygulandı ve rapora bağlandı.");
        }}
      >
        <label>
          Yaptırım
          <select className="kv-input" value={sanction} onChange={(event) => setSanction(event.target.value as StrongSanction)}>
            {(Object.keys(sanctionLabels) as StrongSanction[]).map((value) => <option key={value} value={value}>{sanctionLabels[value]}</option>)}
          </select>
        </label>
        {sanction === "SUSPEND" ? (
          <label>
            Süre (gün)
            <input className="kv-input" type="number" min={1} max={365} value={days} onChange={(event) => setDays(event.target.value)} />
          </label>
        ) : null}
      </ActionDialog>

      <HistoryDialog
        admin={admin}
        kind={target?.type === "COMMENT" ? "comments" : "polls"}
        id={dialog?.kind === "history" ? dialog.report.target.id : null}
        title={dialog?.report.excerpt ?? ""}
        onClose={close}
      />

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

"use client";

// Görsel inceleme kuyruğu ve yasaklı görsel listesi (KV-16, KV-38). Önizleme yalnız işlenmiş (EXIF'siz) kopyadır ve
// kısa ömürlü imzalı adrestir; her önizleme erişimi sunucuda audit'e yazılır. Yasak yönetimi yalnız ADMIN+.
import { useCallback, useState } from "react";
import { AdminClient } from "./admin-client.ts";
import type { AdminMedia, BannedMedia, MediaQueueStatus } from "./admin-client.ts";
import { ActionDialog, ListState, formatDate, isAdminRole, shortId, useAdminRoles, useNotice, useRemoteList } from "./admin-ui";
import styles from "./admin-shell.module.css";

const statusLabels: Record<MediaQueueStatus, string> = { QUARANTINED: "Karantina", PENDING: "İşleniyor", REJECTED: "Reddedilen" };
const purposeLabels: Record<string, string> = { POLL: "Anket görseli", AVATAR: "Profil fotoğrafı", COMMUNITY: "Topluluk görseli" };

type Dialog =
  | { kind: "decide"; media: AdminMedia; decision: "APPROVE" | "REJECT" }
  | { kind: "ban"; media: AdminMedia }
  | { kind: "unban"; ban: BannedMedia }
  | null;

export function MediaPanel({ admin }: { admin: AdminClient }) {
  const roles = useAdminRoles();
  const canBan = isAdminRole(roles);
  const [view, setView] = useState<MediaQueueStatus | "BANNED">("QUARANTINED");
  const [dialog, setDialog] = useState<Dialog>(null);
  const { setNotice, element } = useNotice();

  const loadQueue = useCallback(
    (cursor: string | undefined, signal: AbortSignal) =>
      view === "BANNED" ? Promise.resolve({ items: [] as AdminMedia[], next: null }) : admin.media({ status: view, cursor }, signal),
    [admin, view],
  );
  const loadBans = useCallback(
    (cursor: string | undefined, signal: AbortSignal) => (view === "BANNED" ? admin.bans(cursor, signal) : Promise.resolve({ items: [] as BannedMedia[], next: null })),
    [admin, view],
  );
  const queue = useRemoteList(loadQueue);
  const bans = useRemoteList(loadBans);
  const close = () => setDialog(null);
  const done = (message: string) => {
    setNotice(message);
    queue.reload();
    bans.reload();
  };

  return (
    <>
      <div className={styles.toolbar} role="group" aria-label="Görsel filtreleri">
        <label>
          Liste
          <select className="kv-input" value={view} onChange={(event) => setView(event.target.value as MediaQueueStatus | "BANNED")}>
            {(Object.keys(statusLabels) as MediaQueueStatus[]).map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
            {canBan ? <option value="BANNED">Yasaklı görseller</option> : null}
          </select>
        </label>
      </div>
      {element}

      {view !== "BANNED" ? (
        <>
          {queue.items.length > 0 ? (
            <ul className={styles.mediaGrid} aria-label={statusLabels[view]}>
              {queue.items.map((media) => (
                <li key={media.id} className={styles.mediaCard}>
                  {media.preview ? (
                    // Önizleme kısa ömürlü imzalı adres: kaynak adresini üçüncü taraflara sızdırmamak için referrer yok.
                    <img src={media.preview.url} alt={`${purposeLabels[media.purpose] ?? "Görsel"} önizlemesi`} referrerPolicy="no-referrer" loading="lazy" width={media.width ?? undefined} height={media.height ?? undefined} />
                  ) : (
                    <div className={styles.noPreview}>Önizleme yok</div>
                  )}
                  <div>
                    <strong>{purposeLabels[media.purpose] ?? media.purpose}</strong>
                    <br />
                    <small className="kv-muted" title={media.id}>{shortId(media.id)} · {formatDate(media.createdAt)}</small>
                  </div>
                  <div className={styles.rowActions}>
                    {media.status === "QUARANTINED" || media.status === "REJECTED" ? (
                      <button className="kv-button kv-button--ghost" onClick={() => setDialog({ kind: "decide", media, decision: "APPROVE" })}>{media.status === "REJECTED" ? "Yeniden onayla" : "Onayla"}</button>
                    ) : null}
                    {media.status === "QUARANTINED" ? (
                      <button className="kv-button kv-button--ghost" onClick={() => setDialog({ kind: "decide", media, decision: "REJECT" })}>Reddet</button>
                    ) : null}
                    {media.status === "REJECTED" && canBan ? (
                      <button className="kv-button kv-button--ghost" onClick={() => setDialog({ kind: "ban", media })}>Yasakla</button>
                    ) : null}
                    {media.status === "PENDING" ? <span className="kv-muted">İşleniyor</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <ListState remote={queue} empty="Bu listede görsel yok." />
        </>
      ) : (
        <>
          {bans.items.length > 0 ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <caption className="sr-only">Yasaklı görseller</caption>
                <thead><tr><th scope="col">Kanıt görseli</th><th scope="col">Gerekçe</th><th scope="col">Eşleşme</th><th scope="col">Ekleyen</th><th scope="col">Tarih</th><th scope="col">İşlem</th></tr></thead>
                <tbody>
                  {bans.items.map((ban) => (
                    <tr key={ban.id}>
                      <td><small title={ban.sourceMediaId}>{shortId(ban.sourceMediaId)}</small></td>
                      <td>{ban.reason}</td>
                      <td>{[ban.matchesExact ? "Birebir" : null, ban.matchesSimilar ? "Benzer" : null].filter(Boolean).join(" + ")}</td>
                      <td>{ban.createdBy.displayName}</td>
                      <td>{formatDate(ban.createdAt)}</td>
                      <td><button className="kv-button kv-button--ghost" onClick={() => setDialog({ kind: "unban", ban })}>Yasağı kaldır</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <ListState remote={bans} empty="Yasaklı görsel yok." />
        </>
      )}

      <ActionDialog
        open={dialog?.kind === "decide"}
        title={dialog?.kind === "decide" && dialog.decision === "APPROVE" ? "Görseli onayla" : "Görseli reddet"}
        description={
          dialog?.kind === "decide" && dialog.decision === "APPROVE"
            ? "Görsel yayına alınır ve herkese açık adresten görünür."
            : "Görsel yayına girmez; orijinal dosya kanıt olarak saklanır."
        }
        submitLabel={dialog?.kind === "decide" && dialog.decision === "APPROVE" ? "Onayla" : "Reddet"}
        onClose={close}
        onSubmit={async (reason) => {
          if (dialog?.kind !== "decide") return;
          await admin.decideMedia(dialog.media.id, dialog.decision, reason);
          done(dialog.decision === "APPROVE" ? "Görsel onaylandı." : "Görsel reddedildi.");
        }}
      />
      <ActionDialog
        open={dialog?.kind === "ban"}
        title="Görseli yasakla"
        description="Aynı dosya yeniden yüklenirse otomatik reddedilir; çok benzer görseller incelemeye düşer."
        submitLabel="Yasakla"
        onClose={close}
        onSubmit={async (reason) => {
          if (dialog?.kind !== "ban") return;
          await admin.banMedia(dialog.media.id, reason);
          done("Görsel yasaklandı.");
        }}
      />
      <ActionDialog
        open={dialog?.kind === "unban"}
        title="Yasağı kaldır"
        description="Bu görselin yeniden yüklenmesi artık engellenmez. Daha önce reddedilen yüklemeler geri gelmez."
        submitLabel="Yasağı kaldır"
        reasonLabel={null}
        onClose={close}
        onSubmit={async () => {
          if (dialog?.kind !== "unban") return;
          await admin.unban(dialog.ban.id);
          done("Yasak kaldırıldı.");
        }}
      />
    </>
  );
}

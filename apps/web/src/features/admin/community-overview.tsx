"use client";

// Topluluk yönetim görünümü (#184): kapalı topluluklar dahil liste, etki önizlemeli genel bakış, 7 gün / 10 üye eşiği,
// son yönetim izi ve üye arama. Salt okuma görünümüdür; kapatma/açma mevcut gerekçeli ve auditli güncellemeyle yapılır.
// Yetki sunucudadır (ADMIN+, 403); bu bileşen yalnız yönetici panelinde gösterilir.
import { useCallback, useEffect, useState } from "react";
import type { AdminClient, CommunityOverviewView, CommunityRowView } from "./admin-client.ts";
import { OPERATION_LABEL, ownerText, statusImpactText, THRESHOLD_BADGE, thresholdText } from "./community-model.ts";
import { ActionDialog, errorMessage, formatDate, ListState, useAdminRoles, useRemoteList } from "./admin-ui";
import styles from "./admin-shell.module.css";

export function CommunityOverviewSection({ admin }: { admin: AdminClient }) {
  const [status, setStatus] = useState<"" | "ACTIVE" | "HIDDEN">("");
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback((cursor: string | undefined, signal: AbortSignal) => admin.communitiesAll({ status: status || undefined, q: q || undefined, cursor }, signal), [admin, status, q]);
  const remote = useRemoteList(load);
  return (
    <section className="screen-stack" aria-labelledby="community-overview-heading">
      <h3 id="community-overview-heading">Topluluk durumu ve eşik</h3>
      <p className="kv-muted">Kapalı topluluklar dahil bütün topluluklar. Kapatma/açma kararından önce etkiyi, 7 gün / 10 üye eşiğini ve son yönetim izini gör.</p>
      <form className="kv-row" onSubmit={(event) => { event.preventDefault(); const text = input.trim(); if (!text || text.length >= 2) setQ(text); }}>
        <label>Durum
          <select className="kv-input" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="">Hepsi</option>
            <option value="ACTIVE">Açık</option>
            <option value="HIDDEN">Kapalı</option>
          </select>
        </label>
        <label>Ad veya adres<input className="kv-input" value={input} onChange={(event) => setInput(event.target.value)} /></label>
        <button className="kv-button kv-button--secondary" disabled={input.trim().length === 1}>Ara</button>
      </form>
      {remote.items.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="sr-only">Topluluklar ve eşik durumu</caption>
            <thead><tr><th scope="col">Topluluk</th><th scope="col">Durum</th><th scope="col">Üye / moderatör / anket</th><th scope="col">Eşik</th><th scope="col">İşlem</th></tr></thead>
            <tbody>
              {remote.items.map((row: CommunityRowView) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong><br /><small className="kv-muted">/{row.slug}</small></td>
                  <td>{row.status === "ACTIVE" ? "Açık" : "Kapalı"}</td>
                  <td>{row.members} / {row.moderators} / {row.polls}</td>
                  <td>{THRESHOLD_BADGE[row.threshold.state]}{row.threshold.state === "IN_PROGRESS" ? <><br /><small className="kv-muted">{row.threshold.members}/{row.threshold.requiredMembers} üye · {row.threshold.daysLeft} gün</small></> : null}</td>
                  <td><button className="kv-button kv-button--ghost" onClick={() => setSelected(row.id)} aria-label={`${row.name} genel bakış`}>Genel bakış</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <ListState remote={remote} empty="Bu süzgeçle topluluk yok." />
      {selected ? <CommunityDetail key={selected} id={selected} admin={admin} onChanged={remote.reload} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}

function CommunityDetail({ id, admin, onChanged, onClose }: { id: string; admin: AdminClient; onChanged: () => void; onClose: () => void }) {
  const [overview, setOverview] = useState<CommunityOverviewView | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState(false);
  const [ownerDialog, setOwnerDialog] = useState<"assign" | "release" | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const canOwn = useAdminRoles().includes("SUPER_ADMIN");
  const [notice, setNotice] = useState("");
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"" | "MEMBER" | "MODERATOR">("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    admin.communityOverview(id, controller.signal).then((value) => { if (!controller.signal.aborted) setOverview(value); }).catch((cause) => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [admin, id, revision]);
  const loadMembers = useCallback((cursor: string | undefined, signal: AbortSignal) => admin.communityMembers(id, { q: q || undefined, role: role || undefined, cursor }, signal), [admin, id, q, role]);
  const members = useRemoteList(loadMembers);

  return (
    <section className="kv-card screen-stack" aria-label="Topluluk genel bakış">
      <button className="kv-button kv-button--ghost" onClick={onClose}>Kapat</button>
      {error ? <p role="alert">{error}</p> : null}
      {!overview && !error ? <p role="status">Yükleniyor…</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {overview ? (
        <>
          <h4>{overview.name} <small className="kv-muted">/{overview.slug} · {overview.status === "ACTIVE" ? "Açık" : "Kapalı"}</small></h4>
          <p className="kv-muted">Oluşturan: {overview.createdBy.displayName} (@{overview.createdBy.username}) · {formatDate(overview.createdAt)}</p>
          <div role="group" aria-label="Topluluk sahibi">
            <p>{ownerText(overview.owner)}</p>
            <p className="kv-muted">Sahiplik şimdilik ek yetki vermez; kayıttır. Sahip topluluktan ayrılamaz, yasaklanırsa topluluk yönetici yönetimine döner.</p>
            {canOwn ? (
              <div className="kv-row">
                <button className="kv-button kv-button--secondary" onClick={() => { setNotice(""); setOwnerId(""); setOwnerDialog("assign"); }}>{overview.owner ? "Sahibi değiştir…" : "Sahip ata…"}</button>
                {overview.owner ? <button className="kv-button kv-button--secondary" onClick={() => { setNotice(""); setOwnerDialog("release"); }}>Sahipliği kaldır…</button> : null}
              </div>
            ) : null}
          </div>
          <div role="group" aria-label="Eşik durumu">
            <strong>{THRESHOLD_BADGE[overview.threshold.state]}</strong>
            <p>{thresholdText(overview.threshold)}</p>
          </div>
          <ul aria-label="Etki sayıları">
            <li>{overview.impact.members} üye, {overview.impact.moderators} moderatör</li>
            <li>{overview.impact.polls} anket ({overview.impact.activePolls} görünür, {overview.impact.openPolls} oylanabilir)</li>
            <li>{overview.impact.comments} yorum · {overview.impact.openReports} açık rapor</li>
          </ul>
          <p>{statusImpactText(overview)}</p>
          <button className="kv-button" onClick={() => { setNotice(""); setDialog(true); }}>{overview.status === "ACTIVE" ? "Topluluğu kapat…" : "Topluluğu yeniden aç…"}</button>

          <h4>Son yönetim izi</h4>
          {overview.recentChanges.length === 0 ? <p className="kv-muted">Kayıt yok.</p> : (
            <ul aria-label="Son yönetim izi">
              {overview.recentChanges.map((change, index) => (
                <li key={`${change.at}:${index}`}>
                  {formatDate(change.at)} · {OPERATION_LABEL[change.operation] ?? change.operation} · {change.actor ? change.actor.displayName : "Sistem"}
                  {change.reason ? <><br /><small className="kv-muted">Gerekçe: {change.reason}</small></> : null}
                </li>
              ))}
            </ul>
          )}

          <h4>Üyeler</h4>
          <form className="kv-row" onSubmit={(event) => { event.preventDefault(); const text = input.trim(); if (!text || text.length >= 2) setQ(text); }}>
            <label>Kullanıcı ara<input className="kv-input" value={input} onChange={(event) => setInput(event.target.value)} /></label>
            <label>Rol
              <select className="kv-input" value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
                <option value="">Hepsi</option>
                <option value="MEMBER">Üye</option>
                <option value="MODERATOR">Moderatör</option>
              </select>
            </label>
            <button className="kv-button kv-button--secondary" disabled={input.trim().length === 1}>Ara</button>
          </form>
          <ul aria-label="Üye listesi">
            {members.items.map((member) => (
              <li key={member.user.id}>{member.user.displayName} <small className="kv-muted">@{member.user.username} · {member.role === "MODERATOR" ? "Moderatör" : "Üye"} · {formatDate(member.joinedAt)}</small></li>
            ))}
          </ul>
          <ListState remote={members} empty="Üye bulunamadı." />
        </>
      ) : null}

      <ActionDialog
        open={ownerDialog !== null}
        title={ownerDialog === "release" ? "Sahipliği kaldır" : "Topluluk sahibi ata"}
        description={ownerDialog === "release"
          ? "Topluluk yönetici yönetimine döner; üyelik ve içerik etkilenmez. Gerekçe yönetim izine yazılır."
          : "Sahip uygun olmalı: hesap aktif, e-postası doğrulanmış ve en çok 3 topluluğa sahip. Üye değilse üye olarak eklenir. Özellik kapalıysa (communities.ownershipEnabled) atama reddedilir."}
        submitLabel={ownerDialog === "release" ? "Kaldır" : "Ata"}
        validate={() => (ownerDialog === "assign" && !/^[0-9a-f-]{36}$/i.test(ownerId.trim()) ? "Geçerli bir kullanıcı kimliği gir." : null)}
        onClose={() => setOwnerDialog(null)}
        onSubmit={async (reason) => {
          if (!overview) return;
          if (ownerDialog === "release") {
            await admin.releaseCommunityOwner(overview.id, reason);
            setNotice("Sahiplik kaldırıldı; topluluk yönetici yönetiminde.");
          } else {
            await admin.putCommunityOwner(overview.id, ownerId.trim(), reason);
            setNotice("Sahip atandı; gerekçe yönetim izine yazıldı.");
          }
          setRevision((n) => n + 1);
          onChanged();
        }}
      >
        {ownerDialog === "assign" ? <label>Kullanıcı kimliği<input className="kv-input" value={ownerId} onChange={(event) => setOwnerId(event.target.value)} placeholder="UUID" required /></label> : null}
      </ActionDialog>

      <ActionDialog
        open={dialog}
        title={overview?.status === "ACTIVE" ? "Topluluğu kapat" : "Topluluğu yeniden aç"}
        description={overview ? statusImpactText(overview) : null}
        submitLabel={overview?.status === "ACTIVE" ? "Kapat" : "Yeniden aç"}
        onClose={() => setDialog(false)}
        onSubmit={async (reason) => {
          if (!overview) return;
          await admin.updateCommunity(overview.id, { status: overview.status === "ACTIVE" ? "HIDDEN" : "ACTIVE" }, reason);
          setNotice(overview.status === "ACTIVE" ? "Topluluk kapatıldı; gerekçe yönetim izine yazıldı." : "Topluluk yeniden açıldı; gerekçe yönetim izine yazıldı.");
          setRevision((n) => n + 1);
          onChanged();
        }}
      >
        {overview?.threshold.state === "AUTO_CLOSED" ? <p>Bu topluluk 7 gün / 10 üye eşiği nedeniyle otomatik kapanmıştı. Yeniden açılan topluluk tekrar otomatik kapanmaz.</p> : null}
      </ActionDialog>
    </section>
  );
}

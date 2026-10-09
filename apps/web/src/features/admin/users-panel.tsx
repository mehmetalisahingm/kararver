"use client";
import { useCallback, useEffect, useState } from "react";
import type { AdminClient, UserDetail, StrongSanction } from "./admin-client";
import type { AdminRole } from "./admin-model";
import { ActionDialog, errorMessage, formatDate, ListState, useAdminRoles, useRemoteList } from "./admin-ui";

export function UsersPanel({ admin }: { admin: AdminClient }) {
  const roles = useAdminRoles();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [id, setId] = useState<string | null>(null);
  const list = useRemoteList(useCallback((cursor, signal) => admin.users(query, cursor, signal), [admin, query]));
  return <section className="kv-stack">
    <form onSubmit={e => { e.preventDefault(); if (!input.trim() || input.trim().length >= 3) setQuery(input.trim()); }}>
      <label>Kullanıcı adı veya e-posta<input className="kv-input" value={input} onChange={e => setInput(e.target.value)} /></label>
      <button className="kv-button" disabled={input.trim().length > 0 && input.trim().length < 3}>Ara</button>
    </form>
    {list.items.map(user => <article className="kv-card" key={user.id}>
      <strong>{user.displayName} · @{user.username}</strong><p>{user.email} · {user.status} · {user.roles.join(", ")}</p>
      <p>Kayıt: {formatDate(user.createdAt)} · Rapor: {user.reportCount}</p>
      <button className="kv-button" onClick={() => setId(user.id)}>Hesabı yönet</button>
    </article>)}
    <ListState remote={list} empty="Kullanıcı bulunamadı." />
    {id ? <UserManagement key={id} id={id} admin={admin} canAssign={roles.includes("SUPER_ADMIN")} onClose={() => setId(null)} onChange={list.reload} /> : null}
  </section>;
}

function UserManagement({ id, admin, canAssign, onClose, onChange }: { id: string; admin: AdminClient; canAssign: boolean; onClose: () => void; onChange: () => void }) {
  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<"role" | "sanction" | "remove" | "restore" | "lift" | null>(null);
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<"polls" | "comments">("comments");
  const [role, setRole] = useState<AdminRole>("USER");
  const [sanction, setSanction] = useState<StrongSanction | "WARNING">("WARNING");
  const [endsAt, setEndsAt] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setUser(null);
    admin.user(id, controller.signal).then(value => { if (!controller.signal.aborted) { setUser(value); setRole(value.roles[0] ?? "USER"); } }).catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [admin, id, revision]);
  const activity = useRemoteList(useCallback((cursor, signal) => admin.userActivity(id, cursor, signal), [admin, id]));
  const refresh = () => { setRevision(n => n + 1); activity.reload(); onChange(); };
  return <section className="kv-card kv-stack" aria-label="Kullanıcı yönetimi">
    <button className="kv-button kv-button--ghost" onClick={onClose}>Kapat</button>
    {error ? <p role="alert">{error}<button onClick={refresh}>Tekrar dene</button></p> : null}
    {!user && !error ? <p role="status">Hesap yükleniyor…</p> : null}
    {user ? <>
      <h2>{user.displayName} · {user.email}</h2>
      <p>{user.status} · Roller: {user.roles.join(", ")} · Son giriş: {formatDate(user.lastLoginAt)}</p>
      <p>{user.stats.pollCount} gönderi · {user.stats.commentCount} yorum · {user.stats.voteCount} oy</p>
      {canAssign ? <button className="kv-button" onClick={() => setAction("role")}>Yetkilendir / rolü değiştir</button> : null}
      {canAssign ? <UserSessions id={id} admin={admin} /> : null}
      <button className="kv-button" onClick={() => setAction("sanction")}>Uyar / kısıtla / askıya al / yasakla</button>
      {user.activeSanctions.map(s => <article key={s.id}><p>{s.type} · {s.reason} · Bitiş: {formatDate(s.endsAt)}</p><button onClick={() => { setTarget(s.id); setAction("lift"); }}>Yaptırımı kaldır</button></article>)}
      <h3>Gönderiler ve yorumlar</h3>
      {activity.items.map(item => <article key={`${item.kind}:${item.id}`}><p>{item.kind} · {item.excerpt} · {item.status}</p><button className="kv-button" onClick={() => { setTarget(item.id); setKind(item.kind === "COMMENT" ? "comments" : "polls"); setAction(item.status === "REMOVED" ? "restore" : "remove"); }}>{item.status === "REMOVED" ? "Geri yükle" : "Kaldır"}</button></article>)}
      <ListState remote={activity} empty="Gönderi veya yorum yok." />
    </> : null}
    <ActionDialog open={action !== null} title="Kullanıcıya işlem uygula" submitLabel="Uygula" onClose={() => setAction(null)} validate={() => sanction === "SUSPEND" && action === "sanction" && (!endsAt || Date.parse(endsAt) <= Date.now()) ? "Gelecekte bir bitiş zamanı seç." : null} onSubmit={async reason => {
      if (action === "role") await admin.setUserRole(id, role, reason);
      else if (action === "sanction") await admin.sanctionUser(id, sanction, reason, sanction === "SUSPEND" ? new Date(endsAt).toISOString() : null);
      else if (action === "lift") await admin.liftSanction(id, target, reason);
      else await admin.moderate(kind, target, action === "restore" ? "RESTORE" : "REMOVE", reason);
      refresh();
    }}>
      {action === "role" ? <label>Rol<select className="kv-input" value={role} onChange={e => setRole(e.target.value as AdminRole)}>{["USER", "MODERATOR", "ADMIN", "SUPER_ADMIN"].map(r => <option key={r}>{r}</option>)}</select></label> : null}
      {action === "sanction" ? <><label>Yaptırım<select className="kv-input" value={sanction} onChange={e => setSanction(e.target.value as typeof sanction)}>{["WARNING", "RESTRICT_COMMENTS", "RESTRICT_POSTING", "SUSPEND", "BAN"].map(s => <option key={s}>{s}</option>)}</select></label>{sanction === "SUSPEND" ? <label>Bitiş<input className="kv-input" type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} /></label> : null}</> : null}
    </ActionDialog>
  </section>;
}

function UserSessions({ id, admin }: { id: string; admin: AdminClient }) {
  const sessions = useRemoteList(useCallback((cursor, signal) => admin.userSessions(id, cursor, signal), [admin, id]));
  const [selection, setSelection] = useState<string | null>(null);
  return <section className="kv-stack" aria-label="Aktif oturumlar">
    <h3>Aktif oturumlar</h3>
    <p className="kv-muted">Kapatılan oturumda kullanıcı yeniden giriş yapmalıdır.</p>
    <button className="kv-button" disabled={!sessions.items.length} onClick={() => setSelection("all")}>Tüm oturumları kapat</button>
    {sessions.items.map(session => <article className="kv-card" key={session.id}>
      <p>{session.userAgent ?? "Bilinmeyen cihaz"}</p>
      <p>IP: {session.ipAddress ?? "Kaydedilmedi"} · Son etkinlik: {formatDate(session.lastSeenAt)} · Bitiş: {formatDate(session.expiresAt)}</p>
      <button className="kv-button kv-button--secondary" onClick={() => setSelection(session.id)}>Bu oturumu kapat</button>
    </article>)}
    <ListState remote={sessions} empty="Aktif oturum bulunmuyor." />
    <ActionDialog open={selection !== null} title={selection === "all" ? "Tüm oturumları kapat" : "Oturumu kapat"} submitLabel="Oturumu kapat" onClose={() => setSelection(null)} onSubmit={async reason => {
      await admin.revokeUserSessions(id, reason, selection === "all" ? undefined : selection ?? undefined);
      sessions.reload();
    }}><p>Kullanıcının erişimi kesilecek. İşlem gerekçesi yönetim geçmişine kaydedilir.</p></ActionDialog>
  </section>;
}

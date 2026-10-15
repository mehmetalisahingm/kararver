"use client";
// Destek yoluyla e-posta değişimi (#181, KV-33 §11): yalnız SUPER_ADMIN görür; yetki sunucudadır. Yönetici adresi "doğrulanmış"
// işaretleyemez: e-posta yalnız kullanıcı YENİ adresteki bağlantıyı tıklayınca değişir. Adresler panelde maskeli görünür.
import { useEffect, useState } from "react";
import type { AdminClient, EmailChangeAdminView } from "./admin-client";
import { ActionDialog, errorMessage, formatDate } from "./admin-ui";
import { statusLine } from "../account/email-change-model.ts";

export function AdminEmailChange({ id, admin }: { id: string; admin: AdminClient }) {
  const [items, setItems] = useState<EmailChangeAdminView[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<"start" | "cancel" | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    admin.emailChanges(id, controller.signal)
      .then(list => { if (!controller.signal.aborted) { setItems(list); setError(""); } })
      .catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [admin, id, revision]);

  const open = items.find(item => item.status === "OPEN");
  return <section className="kv-stack" aria-label="E-posta değişimi (destek)">
    <h3>E-posta değişimi (destek)</h3>
    <p className="kv-muted">Eski adresine erişimini kaybeden kullanıcı içindir; kimliği destek kanalında doğrula ve gerekçede belirt. Doğrulama atlanmaz: e-posta yalnızca kullanıcı yeni adresteki bağlantıyı tıklayınca değişir. Eski adrese bilgilendirme ve itiraz bağlantısı gider.</p>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <div className="kv-row">
      <button className="kv-button" disabled={Boolean(open)} onClick={() => { setNotice(""); setNewEmail(""); setDialog("start"); }}>E-posta değişimi başlat…</button>
      {open ? <button className="kv-button kv-button--secondary" onClick={() => { setNotice(""); setDialog("cancel"); }}>Açık talebi iptal et…</button> : null}
    </div>
    {open ? <p className="kv-muted">Açık talep var; yenisi iptal veya tamamlanma sonrası başlatılabilir.</p> : null}
    {items.map(item => <article className="kv-card" key={item.id}>
      <p><strong>{item.origin === "ADMIN" ? "Destek" : "Kullanıcı"}</strong> · {statusLine(item)} · Talep: {formatDate(item.createdAt)}{item.failure ? ` · ${item.failure}` : ""}</p>
    </article>)}
    {!items.length && !error ? <p className="kv-muted">Bu hesap için e-posta değişimi talebi yok.</p> : null}

    <ActionDialog
      open={dialog === "start"}
      title="E-posta değişimi başlat"
      description="Yeni adrese doğrulama bağlantısı gider; kullanıcı tıklamadan hiçbir şey değişmez. Eski adrese bilgilendirme gider. Gerekçe yönetim geçmişine yazılır."
      submitLabel="Bağlantı gönder"
      validate={() => (/^\S+@\S+\.\S+$/.test(newEmail.trim()) ? null : "Geçerli bir e-posta adresi gir.")}
      onClose={() => setDialog(null)}
      onSubmit={async reason => {
        const result = await admin.startEmailChange(id, newEmail.trim(), reason);
        setNotice(result.status === "SEND_FAILED" ? "E-posta gönderilemedi; talep açılmadı. Biraz sonra tekrar dene." : "Bağlantılar gönderildi; kullanıcı yeni adresi doğrulayınca e-posta değişir.");
        setRevision(n => n + 1);
      }}
    >
      <label>Yeni e-posta adresi<input className="kv-input" type="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} autoComplete="off" required /></label>
    </ActionDialog>
    <ActionDialog
      open={dialog === "cancel"}
      title="Açık e-posta değişimini iptal et"
      description="Bağlantılar geçersiz olur; e-posta değişmez."
      submitLabel="İptal et"
      onClose={() => setDialog(null)}
      onSubmit={async reason => { await admin.cancelEmailChange(id, reason); setNotice("Talep iptal edildi."); setRevision(n => n + 1); }}
    />
  </section>;
}

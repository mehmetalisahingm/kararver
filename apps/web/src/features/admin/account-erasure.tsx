"use client";
// Hesap anonimleştirme ve yasal saklama (#181, KV-33 §10). Yalnız SUPER_ADMIN görür; yetki sunucudadır.
// Akış: önizleme (etki + engeller) → gerekçe + hesabın kullanıcı adının yazılı teyidi → geri alınamaz işlem.
import { useEffect, useState } from "react";
import type { AdminClient, ErasurePreviewView } from "./admin-client";
import { ActionDialog, errorMessage, formatDate } from "./admin-ui";
import { BLOCKER_TEXT, confirmationMatches, removalLines, retainedLine } from "./erasure-model.ts";

type Props = { id: string; admin: AdminClient; onAnonymized: () => void };

export function AccountErasure({ id, admin, onAnonymized }: Props) {
  const [preview, setPreview] = useState<ErasurePreviewView | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<"erase" | "hold" | "release" | null>(null);
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    admin.erasurePreview(id, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setPreview(value); setError(""); } })
      .catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [admin, id, revision]);

  const reload = () => setRevision(n => n + 1);
  return <section className="kv-stack" aria-label="Hesap anonimleştirme (KVKK)">
    <h3>Hesap anonimleştirme (KVKK silme)</h3>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!preview && !error ? <p role="status">Etki özeti yükleniyor…</p> : null}
    {preview?.anonymized ? <p>Bu hesap {formatDate(preview.anonymizedAt)} tarihinde anonimleştirildi. Kişisel alanlar silindi; içerik ve oylar kimliksiz kalır.</p> : null}
    {preview && !preview.anonymized ? <>
      <p className="kv-muted">Geri alınamaz. Kişisel alanlar silinir, oturumlar kapanır, üyelikler çıkar; anket, yorum ve oylar yazar adı gizlenerek kalır. İçerikteki kişisel veri için önce toplu içerik işlemini kullan.</p>
      <ul>
        {removalLines(preview.willRemove).map(line => <li key={line}>{line}</li>)}
      </ul>
      <p className="kv-muted">{retainedLine(preview.willRetain)}</p>
      {preview.blockers.length > 0
        ? <ul role="alert" aria-label="Anonimleştirmeyi engelleyenler">{preview.blockers.map(code => <li key={code}>{BLOCKER_TEXT[code]}</li>)}</ul>
        : null}
      {preview.legalHold ? <p>Yasal saklama: {formatDate(preview.legalHold.placedAt)} · {preview.legalHold.reason}</p> : null}
      <div className="kv-row">
        <button className="kv-button kv-button--danger" disabled={!preview.canAnonymize} onClick={() => { setNotice(""); setTyped(""); setDialog("erase"); }}>Hesabı anonimleştir…</button>
        {preview.legalHold
          ? <button className="kv-button kv-button--secondary" onClick={() => { setNotice(""); setDialog("release"); }}>Yasal saklamayı kaldır…</button>
          : <button className="kv-button kv-button--secondary" onClick={() => { setNotice(""); setDialog("hold"); }}>Yasal saklama koy…</button>}
      </div>
    </> : null}

    <ActionDialog
      open={dialog === "erase"}
      title="Hesabı geri alınamaz biçimde anonimleştir"
      description={preview ? `@${preview.username} hesabının kişisel verileri silinecek. Bu işlem geri alınamaz.` : undefined}
      submitLabel="Anonimleştir"
      validate={() => (preview && !confirmationMatches(typed, preview.username) ? "Onay için hesabın kullanıcı adını aynen yaz." : null)}
      onClose={() => setDialog(null)}
      onSubmit={async reason => {
        try {
          const result = await admin.anonymizeUser(id, reason, typed);
          setNotice(result.status === "unchanged" ? "Hesap zaten anonimleştirilmişti; değişiklik yapılmadı." : "Hesap anonimleştirildi; gerekçe yönetim geçmişine yazıldı.");
        } catch (cause) {
          // Sunucunun 409 metni (engel veya teyit) pencerede gösterilir; önizleme güncel engelleri yeniden çeker.
          reload();
          throw cause;
        }
        reload();
        onAnonymized();
      }}
    >
      <label>Onay için kullanıcı adını yaz{preview ? <> (<strong>{preview.username}</strong>)</> : null}
        <input className="kv-input" value={typed} onChange={event => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
      </label>
    </ActionDialog>

    <ActionDialog
      open={dialog === "hold"}
      title="Yasal saklama koy"
      description="Kayıt açıkken hesap anonimleştirilemez. Gerekçe yöneticiler içindir, kullanıcıya gösterilmez."
      submitLabel="Saklamaya al"
      onClose={() => setDialog(null)}
      onSubmit={async reason => { await admin.putLegalHold(id, reason); setNotice("Yasal saklama kaydı eklendi."); reload(); }}
    />
    <ActionDialog
      open={dialog === "release"}
      title="Yasal saklamayı kaldır"
      description="Kayıt silinmez, kaldırıldı olarak işaretlenir. Kaldırıldıktan sonra anonimleştirme yapılabilir."
      submitLabel="Kaldır"
      onClose={() => setDialog(null)}
      onSubmit={async reason => { await admin.releaseLegalHold(id, reason); setNotice("Yasal saklama kaldırıldı."); reload(); }}
    />
  </section>;
}

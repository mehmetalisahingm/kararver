"use client";
// Yüksek hacimli toplu moderasyonun ikinci onayı (#183, KV-37 §8). Açılınca yüklenir. Moderatör kendi taleplerini, yönetici hepsini
// görür (sunucu süzer). Başlatandan farklı ADMIN+ talebi kayıt listesini görerek MFA doğrulamasıyla onaylar (partiyi başlatan adına
// uygular) veya reddeder; başlatan kendi talebini geri çeker. Yetki ve kurallar sunucudadır; düğme gizleme yalnız yönlendirmedir.
import { useCallback, useEffect, useState } from "react";
import { useProduct } from "../../components/product-provider";
import { UiError } from "../../lib/model.ts";
import type { AdminClient, BulkApprovalDetailView, BulkApprovalFilter, BulkApprovalRecord } from "./admin-client.ts";
import { ActionDialog, ListState, errorMessage, formatDate, isAdminRole, useAdminRoles, useRemoteList } from "./admin-ui";
import { approvalActions, approvalStatusLabels, blockedLabels, bulkActionLabels, outcomeLabels, resultSummary } from "./bulk-model.ts";
import styles from "./admin-shell.module.css";

type Props = { admin: AdminClient; revision: number; onChanged: (message: string) => void };
type Dialog = { mode: "approve" | "reject" | "cancel"; approval: BulkApprovalRecord } | null;

export function BulkApprovals({ admin, revision, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary>Toplu işlem onayları</summary>
      {open ? <ApprovalList admin={admin} revision={revision} onChanged={onChanged} /> : null}
    </details>
  );
}

function ApprovalList({ admin, revision, onChanged }: Props) {
  const { user } = useProduct();
  const isAdmin = isAdminRole(useAdminRoles());
  const [status, setStatus] = useState<BulkApprovalFilter>("PENDING");
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  // revision/refresh değişince liste baştan yüklenir.
  const list = useRemoteList(useCallback((cursor, signal) => (void revision, void refresh, admin.bulkApprovals(status, cursor, signal)), [admin, status, revision, refresh]));
  const done = (message: string) => { setDialog(null); setRefresh((n) => n + 1); onChanged(message); };

  return (
    <section className="kv-stack" aria-label="Toplu işlem onayları">
      <p className="kv-muted">
        Eşiği aşan toplu işlemler uygulanmaz; başka bir yöneticinin onayını bekler. Onaylayan kayıt listesini görür, doğrulayıcı koduyla onaylar. İşlem talebi başlatan adına
        uygulanır. Talepler 30 dakika geçerlidir.
      </p>
      <label>
        Durum
        <select className="kv-input" value={status} onChange={(event) => setStatus(event.target.value as BulkApprovalFilter)}>
          {(Object.keys(approvalStatusLabels) as BulkApprovalFilter[]).map((value) => <option key={value} value={value}>{approvalStatusLabels[value]}</option>)}
        </select>
      </label>
      <ul aria-label="Onay talepleri">
        {list.items.map((approval) => {
          const can = approvalActions(approval, user?.id ?? null, isAdmin);
          return (
            <li key={approval.id}>
              {formatDate(approval.createdAt)} · @{approval.initiator.username} · {approval.kind === "polls" ? "anket" : "yorum"} · {bulkActionLabels[approval.action]} · {approval.itemCount} kayıt ·{" "}
              <strong>{approvalStatusLabels[approval.status]}</strong> · <span className="kv-muted">{approval.reason}</span>
              {approval.status === "PENDING" ? <span className="kv-muted"> · son: {formatDate(approval.expiresAt)}</span> : null}
              {approval.decidedBy ? <span className="kv-muted"> · @{approval.decidedBy.username}: {approval.decisionReason}</span> : null}
              {can.approve ? <> <button className="kv-button" onClick={() => setDialog({ mode: "approve", approval })}>İncele ve onayla…</button></> : null}
              {can.reject ? <> <button className="kv-button kv-button--ghost" onClick={() => setDialog({ mode: "reject", approval })}>Reddet…</button></> : null}
              {can.cancel ? <> <button className="kv-button kv-button--ghost" onClick={() => setDialog({ mode: "cancel", approval })}>Geri çek…</button></> : null}
            </li>
          );
        })}
      </ul>
      <ListState remote={list} empty="Bu durumda onay talebi yok." />
      <ApproveDialog admin={admin} approval={dialog?.mode === "approve" ? dialog.approval : null} onClose={() => setDialog(null)} onDone={done} />
      <ActionDialog
        open={dialog?.mode === "reject"}
        title="Toplu işlem talebini reddet"
        description="Hiçbir içerik değişmez. Gerekçe, talebi başlatana ve yönetim geçmişine yazılır."
        submitLabel="Reddet"
        onClose={() => setDialog(null)}
        onSubmit={async (reason) => { await admin.rejectBulk(dialog!.approval.id, reason); done("Talep reddedildi; içerik değişmedi."); }}
      />
      <ActionDialog
        open={dialog?.mode === "cancel"}
        title="Kendi talebini geri çek"
        description="Hiçbir içerik değişmez; talep kapanır."
        submitLabel="Geri çek"
        onClose={() => setDialog(null)}
        onSubmit={async (reason) => { await admin.cancelBulk(dialog!.approval.id, reason); done("Talep geri çekildi; içerik değişmedi."); }}
      />
    </section>
  );
}

/** Onay: kayıt listesi (başlatanın yetkisiyle şimdi hesaplanır) + doğrulayıcı kodu + gerekçe. Kod tek kullanımlıktır. */
function ApproveDialog({ admin, approval, onClose, onDone }: { admin: AdminClient; approval: BulkApprovalRecord | null; onClose: () => void; onDone: (message: string) => void }) {
  const [detail, setDetail] = useState<BulkApprovalDetailView | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  // Kod doğrulandı ama onay reddedildiyse (ör. kayıtlar değişti) aynı pencerede yeniden kod istenmez: step-up henüz harcanmadı.
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    setDetail(null); setError(""); setCode(""); setVerified(false);
    if (!approval) return;
    const controller = new AbortController();
    admin.bulkApproval(approval.id, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setDetail(value); })
      .catch((cause) => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [admin, approval]);

  return (
    <ActionDialog
      open={approval !== null}
      title="Toplu işlemi onayla ve uygula"
      description={approval ? `@${approval.initiator.username} ${approval.itemCount} ${approval.kind === "polls" ? "ankete" : "yoruma"} “${bulkActionLabels[approval.action]}” uygulamak istiyor: ${approval.reason}` : undefined}
      submitLabel="Onayla ve uygula"
      onClose={onClose}
      validate={() => (!detail ? "Kayıt listesi yüklenmeden onaylanamaz." : detail.stale ? "Kayıtlar talepten sonra değişti; talebi reddet ve işlemi yeniden başlat." : !verified && !/^\d{6}$/.test(code) ? "Doğrulayıcı kodunu (6 hane) gir." : null)}
      onSubmit={async (reason) => {
        if (!verified) {
          await admin.stepUp(code);
          setVerified(true);
        }
        try {
          const decision = await admin.approveBulk(approval!.id, reason);
          setCode("");
          onDone(`Onaylandı ve uygulandı: ${resultSummary(decision.result)}`);
        } catch (cause) {
          // Doğrulama süresi dolmuş veya tüketilmiş: kod alanı yeniden açılır, kullanıcı yeni kod girer.
          if (cause instanceof UiError && cause.detail === "stepup_required") { setVerified(false); setCode(""); }
          throw cause;
        }
      }}
    >
      {error ? <p role="alert">{error}</p> : null}
      {!detail && !error ? <p role="status">Kayıtlar yükleniyor…</p> : null}
      {detail?.stale ? <p role="alert">Kayıtlar talepten sonra değişti. Bu talep onaylanamaz; reddedip işlemi yeniden başlat.</p> : null}
      {detail ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="sr-only">Onaylanacak kayıtlar</caption>
            <thead><tr><th scope="col">Kayıt</th><th scope="col">Şimdiki durum</th><th scope="col">Sonuç</th></tr></thead>
            <tbody>
              {detail.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.label ?? <span className="kv-muted">Gösterilemez</span>}</td>
                  <td>{item.status ?? "—"}</td>
                  <td>{outcomeLabels[item.outcome]}{item.blocked ? ` — ${blockedLabels[item.blocked] ?? item.blocked}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {verified ? <p role="status" className="kv-muted">Kod doğrulandı; onay tekrar denenebilir.</p> : (
        <label>
          Doğrulayıcı kodun
          <input className="kv-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
        </label>
      )}
    </ActionDialog>
  );
}

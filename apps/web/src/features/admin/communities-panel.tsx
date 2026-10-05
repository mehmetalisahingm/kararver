"use client";

// Topluluk yönetimi (KV-32): liste, açma, düzenleme/kapatma ve moderatör atama/kaldırma. Moderatörler listeyi görür;
// yönetim işlemleri ADMIN+ gerektirir (sunucu 403 verir, burada düğmeler gizlenir). Sözleşmede kapatılmış toplulukları
// listeleyen admin endpoint'i yok: kapatılmış topluluk "Kimlikle işlem" ile yeniden açılır.
import { useCallback, useRef, useState } from "react";
import { AdminClient } from "./admin-client.ts";
import type { Community, CommunityInput } from "./admin-client.ts";
import { ActionDialog, ListState, isAdminRole, shortId, useAdminRoles, useNotice, useRemoteList } from "./admin-ui";
import styles from "./admin-shell.module.css";

const visibilityLabels = { PUBLIC: "Herkes", MEMBERS: "Yalnız üyeler", MODERATORS: "Yalnız moderatörler" } as const;
const SLUG = /^[a-z0-9-]{2,60}$/;

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; community: Community }
  | { kind: "close"; community: Community }
  | { kind: "moderator"; community: Community }
  | { kind: "byId" }
  | null;

export function CommunitiesPanel({ admin }: { admin: AdminClient }) {
  const canManage = isAdminRole(useAdminRoles());
  const [dialog, setDialog] = useState<Dialog>(null);
  const { setNotice, element } = useNotice();
  const load = useCallback((cursor: string | undefined, signal: AbortSignal) => admin.communities(cursor, signal), [admin]);
  const remote = useRemoteList(load);
  const close = () => setDialog(null);
  const done = (message: string) => {
    setNotice(message);
    remote.reload();
  };

  // Form alanları: pencereler açılırken değerleri doldurulur.
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<CommunityInput["membersVisibility"]>("MEMBERS");
  const [userId, setUserId] = useState("");
  const [moderatorOp, setModeratorOp] = useState<"assign" | "remove">("assign");
  const [targetId, setTargetId] = useState("");
  const [targetStatus, setTargetStatus] = useState<"ACTIVE" | "HIDDEN">("ACTIVE");
  // Aynı anahtar tekrar denemede aynı topluluğu döner (Idempotency-Key); pencere her açıldığında yenilenir.
  const createKey = useRef("");

  function openCreate() {
    setSlug("");
    setName("");
    setDescription("");
    setVisibility("MEMBERS");
    createKey.current = `topluluk-${crypto.randomUUID()}`;
    setDialog({ kind: "create" });
  }

  return (
    <>
      <div className={styles.toolbar}>
        {canManage ? (
          <>
            <button className="kv-button" onClick={openCreate}>Topluluk aç</button>
            <button className="kv-button kv-button--secondary" onClick={() => { setTargetId(""); setTargetStatus("ACTIVE"); setDialog({ kind: "byId" }); }}>Kimlikle işlem</button>
          </>
        ) : (
          <p className="kv-muted">Topluluk açma ve düzenleme yalnız yöneticilere açıktır.</p>
        )}
      </div>
      {element}
      {remote.items.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="sr-only">Açık topluluklar</caption>
            <thead><tr><th scope="col">Topluluk</th><th scope="col">Üye</th><th scope="col">Kimlik</th>{canManage ? <th scope="col">İşlem</th> : null}</tr></thead>
            <tbody>
              {remote.items.map((community) => (
                <tr key={community.id}>
                  <td><strong>{community.name}</strong><br /><small className="kv-muted">/{community.slug}</small></td>
                  <td>{community.memberCount}</td>
                  <td><small title={community.id}>{shortId(community.id)}</small></td>
                  {canManage ? (
                    <td>
                      <div className={styles.rowActions}>
                        <button className="kv-button kv-button--ghost" onClick={() => { setName(community.name); setDescription(community.description ?? ""); setDialog({ kind: "edit", community }); }}>Düzenle</button>
                        <button className="kv-button kv-button--ghost" onClick={() => { setUserId(""); setModeratorOp("assign"); setDialog({ kind: "moderator", community }); }}>Moderatör</button>
                        <button className="kv-button kv-button--ghost" onClick={() => setDialog({ kind: "close", community })}>Kapat</button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <ListState remote={remote} empty="Açık topluluk yok." />

      <ActionDialog
        open={dialog?.kind === "create"}
        title="Topluluk aç"
        description="Topluluk herkese açık listede görünür; üyelik katıl/ayrıl ile yürür."
        submitLabel="Aç"
        reasonLabel={null}
        validate={() => (!SLUG.test(slug) ? "Adres 2–60 karakter, küçük harf, rakam ve tire içermeli." : name.trim().length < 2 ? "Ad en az 2 karakter olmalı." : null)}
        onClose={close}
        onSubmit={async () => {
          await admin.createCommunity({ slug, name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), membersVisibility: visibility }, createKey.current);
          done("Topluluk açıldı.");
        }}
      >
        <label>Adres (slug)<input className="kv-input" value={slug} onChange={(event) => setSlug(event.target.value.trim())} required /></label>
        <label>Ad<input className="kv-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label>
        <label>Açıklama<textarea className="kv-input" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} /></label>
        <label>
          Üye listesini kim görsün
          <select className="kv-input" value={visibility} onChange={(event) => setVisibility(event.target.value as CommunityInput["membersVisibility"])}>
            {Object.entries(visibilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </ActionDialog>

      <ActionDialog
        open={dialog?.kind === "edit"}
        title="Topluluğu düzenle"
        submitLabel="Kaydet"
        validate={() => (name.trim().length < 2 ? "Ad en az 2 karakter olmalı." : null)}
        onClose={close}
        onSubmit={async (reason) => {
          if (dialog?.kind !== "edit") return;
          await admin.updateCommunity(dialog.community.id, { name: name.trim(), description: description.trim() }, reason);
          done("Topluluk güncellendi.");
        }}
      >
        <label>Ad<input className="kv-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label>
        <label>Açıklama<textarea className="kv-input" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} /></label>
      </ActionDialog>

      <ActionDialog
        open={dialog?.kind === "close"}
        title="Topluluğu kapat"
        description="Topluluk listeden, sayfadan ve katılımdan kalkar; yeni gönderi açılamaz. Üyelikler ve gönderiler silinmez, yeniden açılınca geri gelir."
        submitLabel="Kapat"
        onClose={close}
        onSubmit={async (reason) => {
          if (dialog?.kind !== "close") return;
          await admin.updateCommunity(dialog.community.id, { status: "HIDDEN" }, reason);
          done("Topluluk kapatıldı. Yeniden açmak için “Kimlikle işlem”i kullan.");
        }}
      />

      <ActionDialog
        open={dialog?.kind === "moderator"}
        title="Moderatör yönetimi"
        description="Moderatör yalnız bu topluluğun içeriğinde yetkilidir. Atama ve kaldırma açık oturumda hemen etkili olur."
        submitLabel={moderatorOp === "assign" ? "Ata" : "Kaldır"}
        reasonLabel={moderatorOp === "assign" ? "Gerekçe" : null}
        validate={() => (/^[0-9a-f-]{36}$/i.test(userId.trim()) ? null : "Geçerli bir kullanıcı kimliği gir.")}
        onClose={close}
        onSubmit={async (reason) => {
          if (dialog?.kind !== "moderator") return;
          if (moderatorOp === "assign") await admin.assignModerator(dialog.community.id, userId.trim(), reason);
          else await admin.removeModerator(dialog.community.id, userId.trim());
          done(moderatorOp === "assign" ? "Moderatör atandı." : "Moderatörlük kaldırıldı.");
        }}
      >
        <label>
          İşlem
          <select className="kv-input" value={moderatorOp} onChange={(event) => setModeratorOp(event.target.value as "assign" | "remove")}>
            <option value="assign">Moderatör ata</option>
            <option value="remove">Moderatörlüğü kaldır</option>
          </select>
        </label>
        <label>Kullanıcı kimliği<input className="kv-input" value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="UUID" required /></label>
      </ActionDialog>

      <ActionDialog
        open={dialog?.kind === "byId"}
        title="Kimlikle topluluk işlemi"
        description="Kapatılmış topluluk listede görünmez; kimliğiyle yeniden açılabilir veya kapatılabilir."
        submitLabel="Uygula"
        validate={() => (/^[0-9a-f-]{36}$/i.test(targetId.trim()) ? null : "Geçerli bir topluluk kimliği gir.")}
        onClose={close}
        onSubmit={async (reason) => {
          await admin.updateCommunity(targetId.trim(), { status: targetStatus }, reason);
          done(targetStatus === "ACTIVE" ? "Topluluk açıldı." : "Topluluk kapatıldı.");
        }}
      >
        <label>Topluluk kimliği<input className="kv-input" value={targetId} onChange={(event) => setTargetId(event.target.value)} placeholder="UUID" required /></label>
        <label>
          Durum
          <select className="kv-input" value={targetStatus} onChange={(event) => setTargetStatus(event.target.value as "ACTIVE" | "HIDDEN")}>
            <option value="ACTIVE">Aç</option>
            <option value="HIDDEN">Kapat</option>
          </select>
        </label>
      </ActionDialog>
    </>
  );
}

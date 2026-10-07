"use client";

import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  AdminClient,
  AnnouncementInput,
  AnnouncementView,
  Featured,
  FeaturedInput,
} from "./admin-client.ts";
import { ActionDialog, ListState, formatDate, shortId, useNotice, useRemoteList } from "./admin-ui";
import styles from "./admin-shell.module.css";

type FeaturedForm = {
  pollId: string;
  surface: FeaturedInput["surface"];
  scopeId: string;
  priority: string;
  badge: string;
  startsAt: string;
  endsAt: string;
};
type AnnouncementForm = {
  title: string;
  body: string;
  level: AnnouncementInput["level"];
  audience: AnnouncementInput["audience"];
  startsAt: string;
  endsAt: string;
};

const local = (hours = 0) => {
  const d = new Date(Date.now() + hours * 3_600_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const iso = (value: string) => new Date(value).toISOString();
const featuredEmpty = (): FeaturedForm => ({
  pollId: "",
  surface: "HOME_SPOTLIGHT",
  scopeId: "",
  priority: "0",
  badge: "",
  startsAt: local(),
  endsAt: local(24),
});
const announcementEmpty = (): AnnouncementForm => ({
  title: "",
  body: "",
  level: "INFO",
  audience: "ALL",
  startsAt: local(),
  endsAt: "",
});

export function FeaturedPanel({ admin }: { admin: AdminClient }) {
  const featuredLoad = useCallback((cursor: string | undefined, signal: AbortSignal) => admin.featured(cursor, signal), [admin]);
  const announcementLoad = useCallback((cursor: string | undefined, signal: AbortSignal) => admin.announcements(cursor, signal), [admin]);
  const placements = useRemoteList(featuredLoad);
  const announcements = useRemoteList(announcementLoad);
  const { setNotice, element } = useNotice();
  const [featuredDialog, setFeaturedDialog] = useState<"create" | Featured | null>(null);
  const [announcementDialog, setAnnouncementDialog] = useState<"create" | AnnouncementView | null>(null);
  const [featuredForm, setFeaturedForm] = useState<FeaturedForm>(featuredEmpty);
  const [announcementForm, setAnnouncementForm] = useState<AnnouncementForm>(announcementEmpty);
  const featuredKey = useRef("");
  const announcementKey = useRef("");

  const refresh = (message: string) => {
    setNotice(message);
    placements.reload();
    announcements.reload();
  };

  function openFeatured(item?: Featured) {
    featuredKey.current = `featured-${crypto.randomUUID()}`;
    if (!item) {
      setFeaturedForm(featuredEmpty());
      setFeaturedDialog("create");
      return;
    }
    setFeaturedForm({
      pollId: item.pollId,
      surface: item.surface,
      scopeId: item.scopeId ?? "",
      priority: String(item.priority),
      badge: item.badge ?? "",
      startsAt: toLocal(item.startsAt),
      endsAt: toLocal(item.endsAt),
    });
    setFeaturedDialog(item);
  }

  function openAnnouncement(item?: AnnouncementView) {
    announcementKey.current = `announcement-${crypto.randomUUID()}`;
    if (!item) {
      setAnnouncementForm(announcementEmpty());
      setAnnouncementDialog("create");
      return;
    }
    setAnnouncementForm({
      title: item.title,
      body: item.body,
      level: item.level,
      audience: item.audience,
      startsAt: toLocal(item.startsAt),
      endsAt: item.endsAt ? toLocal(item.endsAt) : "",
    });
    setAnnouncementDialog(item);
  }

  function featuredPayload(): FeaturedInput {
    return {
      pollId: featuredForm.pollId.trim(),
      surface: featuredForm.surface,
      scopeId: featuredForm.scopeId.trim() || null,
      priority: Number(featuredForm.priority),
      badge: featuredForm.badge.trim() || null,
      startsAt: iso(featuredForm.startsAt),
      endsAt: iso(featuredForm.endsAt),
    };
  }
  function announcementPayload(): AnnouncementInput {
    return {
      title: announcementForm.title.trim(),
      body: announcementForm.body.trim(),
      level: announcementForm.level,
      audience: announcementForm.audience,
      startsAt: iso(announcementForm.startsAt),
      endsAt: announcementForm.endsAt ? iso(announcementForm.endsAt) : null,
    };
  }

  return (
    <>
      {element}
      <div className={styles.toolbar}>
        <button className="kv-button" onClick={() => openFeatured()}>Öne çıkarma ekle</button>
        <button className="kv-button kv-button--secondary" onClick={() => openAnnouncement()}>Duyuru planla</button>
        <p className="kv-muted">Zamanlama organik sıralamayı değiştirmez; yalnız seçilen yüzeyde editöryel yerleşim oluşturur.</p>
      </div>

      <h2>Öne çıkarılan içerikler</h2>
      {placements.items.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Anket</th><th>Yüzey</th><th>Zaman</th><th>Durum</th><th>İşlem</th></tr></thead>
            <tbody>{placements.items.map((item) => (
              <tr key={item.id}>
                <td><strong>{shortId(item.pollId)}</strong><br /><small>{item.badge ?? "Etiketsiz"} · öncelik {item.priority}</small></td>
                <td>{item.surface}{item.scopeId ? <><br /><small>{shortId(item.scopeId)}</small></> : null}</td>
                <td>{formatDate(item.startsAt)} → {formatDate(item.endsAt)}</td>
                <td>{scheduleState(item.startsAt, item.endsAt)}</td>
                <td><div className={styles.rowActions}>
                  <button className="kv-button kv-button--ghost" onClick={() => openFeatured(item)}>Düzenle</button>
                  <button className="kv-button kv-button--ghost" onClick={async () => { await admin.deleteFeatured(item.id); refresh("Öne çıkarma kaldırıldı."); }}>Kaldır</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
      <ListState remote={placements} empty="Öne çıkarma kaydı yok." />

      <h2>Zamanlanmış duyurular</h2>
      {announcements.items.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Duyuru</th><th>Hedef</th><th>Zaman</th><th>Durum</th><th>İşlem</th></tr></thead>
            <tbody>{announcements.items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.title}</strong><br /><small>{item.level}</small></td>
                <td>{item.audience === "ALL" ? "Herkes" : "Giriş yapmış kullanıcılar"}</td>
                <td>{formatDate(item.startsAt)} → {formatDate(item.endsAt)}</td>
                <td>{scheduleState(item.startsAt, item.endsAt)}</td>
                <td><div className={styles.rowActions}>
                  <button className="kv-button kv-button--ghost" onClick={() => openAnnouncement(item)}>Düzenle</button>
                  <button className="kv-button kv-button--ghost" onClick={async () => { await admin.deleteAnnouncement(item.id); refresh("Duyuru kaldırıldı."); }}>Kaldır</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
      <ListState remote={announcements} empty="Duyuru kaydı yok." />

      <ActionDialog
        open={featuredDialog !== null}
        title={featuredDialog === "create" ? "Öne çıkarma planla" : "Öne çıkarmayı düzenle"}
        submitLabel={featuredDialog === "create" ? "Planla" : "Kaydet"}
        description="CATEGORY/COMMUNITY yüzeylerinde kapsam ID zorunludur. Kaldırılmış içerik sunucuda reddedilir."
        validate={() => validateFeatured(featuredForm)}
        onClose={() => setFeaturedDialog(null)}
        onSubmit={async (reason) => {
          const payload = featuredPayload();
          if (featuredDialog === "create") await admin.createFeatured(payload, reason, featuredKey.current);
          else if (featuredDialog) await admin.updateFeatured(featuredDialog.id, payload, reason);
          refresh("Öne çıkarma kaydedildi.");
        }}
      >
        <FeaturedFields form={featuredForm} setForm={setFeaturedForm} />
      </ActionDialog>

      <ActionDialog
        open={announcementDialog !== null}
        title={announcementDialog === "create" ? "Duyuru planla" : "Duyuruyu düzenle"}
        submitLabel={announcementDialog === "create" ? "Planla" : "Kaydet"}
        description="Hedef grup bildirimin planlanan alıcısını belirler. Bildirim tercih entegrasyonu #36 ile tamamlanır."
        validate={() => validateAnnouncement(announcementForm)}
        onClose={() => setAnnouncementDialog(null)}
        onSubmit={async (reason) => {
          const payload = announcementPayload();
          if (announcementDialog === "create") await admin.createAnnouncement(payload, reason, announcementKey.current);
          else if (announcementDialog) await admin.updateAnnouncement(announcementDialog.id, payload, reason);
          refresh("Duyuru kaydedildi.");
        }}
      >
        <AnnouncementFields form={announcementForm} setForm={setAnnouncementForm} />
      </ActionDialog>
    </>
  );
}

function toLocal(value: string) {
  const d = new Date(value);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function scheduleState(startsAt: string, endsAt: string | null) {
  const now = Date.now();
  if (new Date(startsAt).getTime() > now) return "Planlı";
  if (endsAt && new Date(endsAt).getTime() <= now) return "Bitti";
  return "Aktif";
}
function validateFeatured(form: FeaturedForm) {
  if (!form.pollId.trim()) return "Anket ID zorunlu.";
  if (!Number.isInteger(Number(form.priority)) || Number(form.priority) < 0 || Number(form.priority) > 1000) return "Öncelik 0–1000 arasında tam sayı olmalı.";
  if (!form.startsAt || !form.endsAt || new Date(form.endsAt).getTime() <= new Date(form.startsAt).getTime()) return "Bitiş başlangıçtan sonra olmalı.";
  const scoped = form.surface === "CATEGORY" || form.surface === "COMMUNITY";
  if (scoped && !form.scopeId.trim()) return "Bu yüzey için kapsam ID zorunlu.";
  if (!scoped && form.scopeId.trim()) return "Bu yüzey kapsam ID kabul etmiyor.";
  return null;
}
function validateAnnouncement(form: AnnouncementForm) {
  if (form.title.trim().length < 3) return "Başlık en az 3 karakter olmalı.";
  if (!form.body.trim()) return "Duyuru metni zorunlu.";
  if (!form.startsAt) return "Başlangıç zamanı zorunlu.";
  if (form.endsAt && new Date(form.endsAt) <= new Date(form.startsAt)) return "Bitiş başlangıçtan sonra olmalı.";
  return null;
}

function FeaturedFields({ form, setForm }: { form: FeaturedForm; setForm: Dispatch<SetStateAction<FeaturedForm>> }) {
  const field = <K extends keyof FeaturedForm>(key: K, value: FeaturedForm[K]) => setForm((s) => ({ ...s, [key]: value }));
  return <>
    <label>Anket ID<input className="kv-input" value={form.pollId} onChange={(e) => field("pollId", e.target.value)} required /></label>
    <label>Yüzey<select className="kv-input" value={form.surface} onChange={(e) => field("surface", e.target.value as FeaturedForm["surface"])}>
      <option value="HOME_SPOTLIGHT">Ana sayfa spotlight</option><option value="FEED_TOP">Feed üstü</option><option value="DAILY_PICK">Günün seçimi</option><option value="CATEGORY">Kategori</option><option value="COMMUNITY">Topluluk</option><option value="EDITORS_CHOICE">Editör seçimi</option>
    </select></label>
    <label>Kapsam ID<input className="kv-input" value={form.scopeId} onChange={(e) => field("scopeId", e.target.value)} placeholder="Kategori/topluluk için" /></label>
    <label>Badge<input className="kv-input" value={form.badge} onChange={(e) => field("badge", e.target.value)} maxLength={30} /></label>
    <label>Öncelik<input className="kv-input" type="number" min="0" max="1000" value={form.priority} onChange={(e) => field("priority", e.target.value)} /></label>
    <label>Başlangıç<input className="kv-input" type="datetime-local" value={form.startsAt} onChange={(e) => field("startsAt", e.target.value)} /></label>
    <label>Bitiş<input className="kv-input" type="datetime-local" value={form.endsAt} onChange={(e) => field("endsAt", e.target.value)} /></label>
  </>;
}
function AnnouncementFields({ form, setForm }: { form: AnnouncementForm; setForm: Dispatch<SetStateAction<AnnouncementForm>> }) {
  const field = <K extends keyof AnnouncementForm>(key: K, value: AnnouncementForm[K]) => setForm((s) => ({ ...s, [key]: value }));
  return <>
    <label>Başlık<input className="kv-input" value={form.title} onChange={(e) => field("title", e.target.value)} maxLength={120} /></label>
    <label>Metin<textarea className="kv-input" rows={4} value={form.body} onChange={(e) => field("body", e.target.value)} maxLength={2000} /></label>
    <label>Seviye<select className="kv-input" value={form.level} onChange={(e) => field("level", e.target.value as AnnouncementForm["level"])}><option value="INFO">Bilgi</option><option value="WARNING">Uyarı</option></select></label>
    <label>Hedef<select className="kv-input" value={form.audience} onChange={(e) => field("audience", e.target.value as AnnouncementForm["audience"])}><option value="ALL">Herkes</option><option value="AUTHENTICATED">Giriş yapmış kullanıcılar</option></select></label>
    <label>Başlangıç<input className="kv-input" type="datetime-local" value={form.startsAt} onChange={(e) => field("startsAt", e.target.value)} /></label>
    <label>Bitiş (opsiyonel)<input className="kv-input" type="datetime-local" value={form.endsAt} onChange={(e) => field("endsAt", e.target.value)} /></label>
  </>;
}

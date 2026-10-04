"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Me, dataOf } from "@kararver/contracts";
import { useProduct } from "../../components/product-provider";
import { adminNav, canEnterAdmin, canSeeAdminItem, type AdminRole, type AdminSectionId } from "./admin-model";
import styles from "./admin-shell.module.css";

function currentRoles(demo: boolean, email: string | undefined): AdminRole[] {
  if (!demo || !email) return [];
  return email === "umit@example.test" ? ["SUPER_ADMIN"] : ["USER"];
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { demo, user } = useProduct();
  const pathname = usePathname();
  const [roles, setRoles] = useState<AdminRole[]>(() => currentRoles(demo, user?.email));
  const [ready, setReady] = useState(demo || !user);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);

  useEffect(() => {
    if (demo) {
      setRoles(currentRoles(true, user?.email));
      setReady(true);
      return;
    }
    if (!user) {
      setRoles([]);
      setReady(true);
      return;
    }
    const controller = new AbortController();
    setReady(false);
    setError("");
    const base = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "").replace(/\/v1$/, "");
    fetch(`${base}/v1/me`, {
      credentials: "include",
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = dataOf(Me).parse(await response.json());
        setRoles(parsed.data.roles as AdminRole[]);
      })
      .catch((error) => {
        if (error?.name !== "AbortError") { setRoles([]); setError("Yönetim yetkisi kontrol edilemedi. Bağlantını kontrol edip tekrar deneyebilirsin."); }
      })
      .finally(() => {
        if (!controller.signal.aborted) setReady(true);
      });
    return () => controller.abort();
  }, [demo, user?.id, user?.email, attempt]);

  const visible = useMemo(() => adminNav.filter((item) => canSeeAdminItem(roles, item)), [roles]);

  if (!ready) {
    return <section className="kv-card kv-state" aria-busy="true"><h1 role="status">Yönetim yetkisi kontrol ediliyor…</h1></section>;
  }

  if (error) return <section className="kv-card kv-state"><h1>Yönetim açılamadı.</h1><p role="alert">{error}</p><button className="kv-button" onClick={() => retry(n => n + 1)}>Yetkiyi tekrar kontrol et</button></section>;

  if (!user || !canEnterAdmin(roles)) {
    return (
      <section className={`kv-card ${styles.denied}`}>
        <span className="eyebrow">YÖNETİM</span>
        <h1>Yönetim erişimi gerekli</h1>
        <p className="kv-muted">Bu alan yalnız yetkili moderatör ve yöneticiler içindir. Menü gizliliği kullanıcı deneyimidir; asıl yetki kontrolü backend RBAC tarafından yapılır.</p>
        <Link className="kv-button" href={user ? "/" : `/giris?returnTo=${encodeURIComponent(pathname)}`}>{user ? "Ana sayfaya dön" : "Giriş yap"}</Link>
      </section>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.nav} aria-label="Yönetim navigasyonu">
        <div className={styles.navTitle}>KararVer Yönetim</div>
        {visible.map((item) => {
          const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          return (
            <Link key={item.id} href={item.href} aria-current={active ? "page" : undefined}>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </Link>
          );
        })}
        <div className={styles.role}>Rol: {roles.join(", ")}</div>
      </aside>
      <section className={styles.content}>{children}</section>
    </div>
  );
}

const sectionMeta: Record<AdminSectionId, { title: string; intro: string; metric: [string, string][] }> = {
  dashboard: { title: "Yönetim merkezi", intro: "Operasyon, moderasyon ve sistem alanlarına tek noktadan erişim.", metric: [["Açık rapor", "12"], ["İncelemedeki medya", "7"], ["Aktif topluluk", "24"]] },
  users: { title: "Kullanıcılar", intro: "Hesap, rol ve yaptırım işlemleri için ortak çalışma alanı.", metric: [["Aktif", "1.248"], ["Kısıtlı", "9"], ["Yeni / 24s", "43"]] },
  polls: { title: "İçerikler", intro: "Anket ve tartışmaların görünürlük ve moderasyon durumu.", metric: [["Aktif", "386"], ["Kilitli", "4"], ["İncelemede", "11"]] },
  comments: { title: "Yorumlar", intro: "Yorum ve cevap moderasyonu için filtrelenebilir liste.", metric: [["Bugün", "214"], ["Raporlu", "8"], ["Kaldırılan", "3"]] },
  reports: { title: "Raporlar", intro: "Açık raporları gerekçeli biçimde sonuçlandırma kuyruğu.", metric: [["Açık", "12"], ["Bugün sonuçlanan", "31"], ["SLA dışı", "2"]] },
  media: { title: "Medya", intro: "Karantina, inceleme ve görsel risk durumları.", metric: [["Bekleyen", "7"], ["Karantina", "2"], ["Onaylanan", "118"]] },
  categories: { title: "Kategoriler", intro: "Kategori sırası, açıklama ve aktiflik yönetimi.", metric: [["Aktif", "13"], ["Pasif", "1"], ["İçerik", "386"]] },
  communities: { title: "Topluluklar", intro: "Topluluk durumu, üyelik ve moderasyon bağlantıları.", metric: [["Aktif", "24"], ["Üye", "3.912"], ["Moderatör", "38"]] },
  featured: { title: "Öne çıkarılanlar", intro: "Öne çıkarılan içerik ve zamanlanmış duyuru alanı.", metric: [["Aktif", "5"], ["Planlı", "2"], ["Biten", "17"]] },
  settings: { title: "Sistem ayarları", intro: "Sunucu tarafı feature switch ve acil durum anahtarları.", metric: [["Ayar", "18"], ["Değişen / 7g", "3"], ["Acil anahtar", "4"]] },
  audit: { title: "Audit geçmişi", intro: "Kim, neyi, ne zaman ve hangi gerekçeyle değiştirdi görünümü.", metric: [["Bugün", "83"], ["Başarısız", "2"], ["Kritik", "6"]] },
};

export function AdminSection({ section }: { section: AdminSectionId }) {
  const meta = sectionMeta[section];
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <header className={styles.hero}>
        <div><span className="eyebrow">YÖNETİM</span><h1>{meta.title}</h1><p className="kv-muted">{meta.intro}</p></div>
        <button className="kv-button" onClick={() => dialogRef.current?.showModal()}>Örnek işlem</button>
      </header>
      <div className={styles.grid} aria-label="Özet metrikler">
        {meta.metric.map(([label, value]) => <div className={styles.metric} key={label}><span className="kv-muted">{label}</span><strong>{value}</strong></div>)}
      </div>
      <div className={styles.toolbar} aria-label="Yönetim filtreleri">
        <label>Arama<input className="kv-input" placeholder="ID, başlık veya kullanıcı" /></label>
        <label>Durum<select className="kv-input" defaultValue="all"><option value="all">Tümü</option><option value="active">Aktif</option><option value="review">İncelemede</option></select></label>
        <button className="kv-button kv-button--secondary">Filtrele</button>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Kayıt</th><th>Durum</th><th>Güncelleme</th><th>İşlem</th></tr></thead>
          <tbody>
            <tr><td>{meta.title} örnek kaydı</td><td>Aktif</td><td>Az önce</td><td><button className="kv-button kv-button--ghost" onClick={() => dialogRef.current?.showModal()}>İncele</button></td></tr>
            <tr><td>İkinci örnek kayıt</td><td>İncelemede</td><td>12 dk önce</td><td><button className="kv-button kv-button--ghost" onClick={() => dialogRef.current?.showModal()}>İncele</button></td></tr>
          </tbody>
        </table>
      </div>
      <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="admin-dialog-title" onCancel={() => dialogRef.current?.close()}>
        <div className={styles.dialogBody}>
          <span className="eyebrow">ORTAK MODAL KALIBI</span>
          <h2 id="admin-dialog-title">Yönetim işlemi</h2>
          <p className="kv-muted">Gerçek modüller bu kalıbı kendi yetkili API işlemlerine bağlar. Kritik işlemlerde gerekçe ve audit kaydı zorunludur.</p>
          <label>Gerekçe<textarea className="kv-input" rows={4} /></label>
          <div className={styles.dialogActions}><button className="kv-button kv-button--secondary" onClick={() => dialogRef.current?.close()}>Vazgeç</button><button className="kv-button" onClick={() => dialogRef.current?.close()}>Onayla</button></div>
        </div>
      </dialog>
    </>
  );
}

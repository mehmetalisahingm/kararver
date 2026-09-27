"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DemoClient } from "../lib/demo-client";
import { emptyDraft, safeReturnTo } from "../lib/model";
import type { Draft, ProductClient, User } from "../lib/model";

type Context = {
  client: ProductClient;
  user: User | null;
  syncUser: () => void;
  draft: Draft;
  setDraft: (draft: Draft) => void;
  selections: Record<string, string>;
  select: (id: string, option: string) => void;
  requireUser: (returnTo: string) => boolean;
  message: string;
  notify: (message: string) => void;
  returnTo: string;
  setReturnTo: (path: string) => void;
};
const ProductContext = createContext<Context | null>(null);
export function useProduct() {
  const value = useContext(ProductContext);
  if (!value) throw new Error("ProductProvider missing");
  return value;
}
const navigation = [
  { href: "/", icon: "⌂", label: "Ana Sayfa" },
  { href: "/kesfet", icon: "◇", label: "Keşfet" },
  { href: "/olustur", icon: "+", label: "Oluştur" },
  { href: "/bildirimler", icon: "♧", label: "Bildirimler" },
  { href: "/hesap", icon: "○", label: "Hesabım" },
];

export function ProductProvider({
  children,
  demo,
}: {
  children: ReactNode;
  demo: boolean;
}) {
  const [client] = useState(() => new DemoClient());
  const [user, setUser] = useState<User | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [message, notify] = useState("");
  const [returnTo, setReturn] = useState("/");
  const [theme, setTheme] = useState("dark");
  const [gate, setGate] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (gate) dialog.current?.showModal();
    else dialog.current?.close();
  }, [gate]);
  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      document.querySelector<HTMLElement>("#main")?.focus();
    }
  }, [pathname]);
  const syncUser = () => setUser(client.current());
  const setReturnTo = (path: string) => setReturn(safeReturnTo(path));
  function requireUser(path: string) {
    if (client.current()) return true;
    trigger.current = document.activeElement as HTMLElement;
    setReturnTo(path);
    setGate(true);
    return false;
  }
  function closeGate() {
    setGate(false);
    trigger.current?.focus();
  }
  const context = {
    client,
    user,
    syncUser,
    draft,
    setDraft,
    selections,
    select: (id: string, option: string) =>
      setSelections((old) => ({ ...old, [id]: option })),
    requireUser,
    message,
    notify,
    returnTo,
    setReturnTo,
  };
  return (
    <ProductContext.Provider value={context}>
      <div className="product" data-theme={theme}>
        <a className="kv-skip" href="#main">
          İçeriğe geç
        </a>
        <header className="app-header">
          <Link href="/" className="brand">
            <span aria-hidden="true">✓</span>Kararver
          </Link>
          <span className="header-caption">
            Birlikte düşün. Kendin karar ver.
          </span>
          <button
            className="kv-button kv-button--ghost"
            aria-label={
              theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç"
            }
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          {user ? (
            <>
              <span className="balance">{user.balance} puan</span>
              <button
                className="kv-button kv-button--secondary"
                onClick={async () => {
                  await client.logout();
                  syncUser();
                  notify("Demo oturumundan çıkış yaptın.");
                  router.push("/");
                }}
              >
                Çıkış
              </button>
            </>
          ) : (
            <Link
              className="kv-button kv-button--secondary"
              href="/giris"
              onClick={() => setReturnTo(pathname)}
            >
              Giriş yap
            </Link>
          )}
        </header>
        <div className="app-layout">
          <aside className="app-sidebar">
            <nav aria-label="Masaüstü navigasyonu">
              {navigation.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={pathname === n.href ? "page" : undefined}
                >
                  <span aria-hidden="true">{n.icon}</span>
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="sidebar-note">
              Sor. Fikrini paylaş.
              <br />
              Yeni bakış açıları keşfet.
            </div>
            <Link
              href="/kayit"
              onClick={() => setReturnTo(pathname)}
              className="kv-button"
            >
              Topluluğa katıl
            </Link>
          </aside>
          <main id="main" tabIndex={-1}>
            <p className="demo-banner">
              {demo
                ? "Demo ortamı · Örnek veriler, sayfa yenilendiğinde sıfırlanır. Gerçek hesap veya işlem değildir."
                : "API bağlantısı henüz hazırlanıyor. Gerçek hesap ve yayın işlemleri kullanılamıyor."}
            </p>
            <div className="announcement" role="status">
              {message}
            </div>
            {demo ? (
              children
            ) : (
              <div className="kv-card kv-state">
                <h1>Bağlantı hazırlanıyor.</h1>
                <p>
                  Bu ortamda demo oturum açılmaz. Ekranları yerelde denemek için
                  belgelenen demo komutunu kullanın.
                </p>
              </div>
            )}
          </main>
          <aside className="app-aside">
            <div className="kv-card kv-stack">
              <span className="eyebrow">TOPLULUĞUN GÜNDEMİ</span>
              <h2>Bir fikrin var mı?</h2>
              <p className="kv-muted">
                Bir soru bazen bütün bakış açını değiştirir.
              </p>
              <Link href="/olustur" className="kv-button">
                + Soru sor
              </Link>
            </div>
            <div className="kv-card kv-stack">
              <h2>Keşfetmeye başla</h2>
              <Link href="/karar/calisma-sekli">Uzaktan mı, ofisten mi?</Link>
              <Link href="/karar/tatil-rotasi">Sıradaki tatil rotan</Link>
              <Link href="/karar/ilk-bisiklet">İlk bisikletini seçerken</Link>
            </div>
            {demo && (
              <details className="demo-controls">
                <summary>Demo test araçları</summary>
                <p>Sonraki istekte bir hata örneği gösterir.</p>
                {[
                  ["list", "Akış"],
                  ["vote", "Oy"],
                  ["create", "Yayın"],
                  ["login", "Giriş"],
                ].map(([operation, label]) => (
                  <button
                    key={operation}
                    onClick={() => {
                      client.failNext(operation);
                      notify(
                        `${label} için sonraki istekte hata örneği etkin.`,
                      );
                    }}
                    className="kv-button kv-button--ghost"
                  >
                    {label} hatası
                  </button>
                ))}
              </details>
            )}
          </aside>
        </div>
        <nav className="app-mobile" aria-label="Mobil navigasyon">
          {navigation.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={pathname === n.href ? "page" : undefined}
            >
              <span aria-hidden="true">{n.icon}</span>
              {n.label}
            </Link>
          ))}
        </nav>
        <dialog
          ref={dialog}
          className="kv-dialog"
          aria-labelledby="gate-title"
          aria-describedby="gate-description"
          onCancel={closeGate}
          onClose={() => {
            setGate(false);
          }}
        >
          <div className="kv-stack">
            <span className="eyebrow">FİKRİN DEĞERLİ</span>
            <h2 id="gate-title">Katılmak için giriş yap.</h2>
            <p id="gate-description">
              Seçimin ve taslağın korunacak. Girişten sonra işlemi sen
              onaylayacaksın.
            </p>
            <Link
              className="kv-button"
              href={`/giris?returnTo=${encodeURIComponent(returnTo)}`}
              onClick={() => setGate(false)}
            >
              Girişe devam et
            </Link>
            <Link
              className="kv-button kv-button--secondary"
              href={`/kayit?returnTo=${encodeURIComponent(returnTo)}`}
              onClick={() => setGate(false)}
            >
              Yeni hesap oluştur
            </Link>
            <button
              className="kv-button kv-button--ghost"
              autoFocus
              onClick={closeGate}
            >
              Şimdilik gezinmeye devam et
            </button>
          </div>
        </dialog>
      </div>
    </ProductContext.Provider>
  );
}

"use client";
import { Fragment, createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ApiClient } from "../lib/api-client";
import { DemoClient } from "../lib/demo-client";
import { WelcomeEntry, WelcomeResume } from "../features/onboarding/welcome-entry";
import { hasWelcomeSeen } from "../lib/welcome-draft";
import { emptyDraft, safeReturnTo } from "../lib/model";
import type { Draft, ProductClient, User } from "../lib/model";
import type { CommentDraft } from "../features/social/model";

type Context = {
  demo: boolean;
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
  commentDrafts: Record<string, CommentDraft>;
  setCommentDraft: (key: string, draft: CommentDraft) => void;
};
const ProductContext = createContext<Context | null>(null);
export function useProduct() {
  const value = useContext(ProductContext);
  if (!value) throw new Error("ProductProvider missing");
  return value;
}
const navigation = [
  { href: "/", icon: "home", label: "Ana Sayfa" },
  { href: "/kesfet", icon: "compass", label: "Keşfet" },
  { href: "/topluluklar", icon: "community", label: "Topluluklar" },
  { href: "/olustur", icon: "plus", label: "Oluştur" },
  { href: "/bildirimler", icon: "bell", label: "Bildirimler" },
  { href: "/hesap", icon: "user", label: "Hesabım" },
] as const;

type NavigationIcon = (typeof navigation)[number]["icon"];
function NavIcon({ kind }: { kind: NavigationIcon }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "home" && <><path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 21v-8h6v8"/></>}
    {kind === "compass" && <><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z"/></>}
    {kind === "community" && <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>}
    {kind === "plus" && <><path d="M12 5v14M5 12h14"/></>}
    {kind === "bell" && <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>}
    {kind === "user" && <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>}
  </svg>;
}

export function ProductProvider({
  children,
  demo,
}: {
  children: ReactNode;
  demo: boolean;
}) {
  const [client] = useState<ProductClient>(() => demo ? new DemoClient() : new ApiClient(process.env.NEXT_PUBLIC_API_URL ?? ""));
  // Demo forms also wait for hydration so early input cannot be discarded.
  const [sessionReady, setSessionReady] = useState(false);
  const [welcomeSeen, setWelcomeSeen] = useState<boolean | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [sessionAttempt, retrySession] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [commentDrafts, setCommentDrafts] = useState<
    Record<string, CommentDraft>
  >({});
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [message, notify] = useState("");
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [returnTo, setReturn] = useState("/");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [gate, setGate] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("kararver:theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch { /* Private browsing or restricted storage: use safe light default. */ }
  }, []);
  function toggleTheme() {
    setTheme(previous => {
      const next = previous === "dark" ? "light" : "dark";
      try { window.localStorage.setItem("kararver:theme", next); } catch { /* Retain in-memory preference. */ }
      return next;
    });
  }
  useEffect(() => { setWelcomeSeen(hasWelcomeSeen()); }, [pathname]);
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
  useEffect(() => {
    if (!(client instanceof ApiClient)) {
      setSessionReady(true);
      return;
    }
    let active = true;
    const unsubscribe = client.subscribe(() => { if (active) setUser(client.current()); });
    setSessionError("");
    client.restore().then(() => { if (active) setSessionReady(true); }).catch((error) => {
      if (active) setSessionError(error.message);
    });
    return () => { active = false; unsubscribe(); };
  }, [client, sessionAttempt]);
  useEffect(() => {
    const notifications = client.notifications;
    if (!notifications || !user) {
      setUnreadNotifications(0);
      return;
    }
    let active = true;
    const refresh = () => {
      notifications.unreadCount()
        .then((count) => { if (active) setUnreadNotifications(count); })
        .catch(() => { /* Rozet kritik değil; bildirim ekranı hatayı ayrıca gösterir. */ });
    };
    refresh();
    window.addEventListener("kv:notifications-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("kv:notifications-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [client.notifications, user?.id, pathname]);
  const syncUser = () => {
    const current = client.current();
    if (current)
      setCommentDrafts((old) => {
        const next = { ...old };
        for (const key of Object.keys(old))
          if (key.startsWith("guest:")) {
            next[current.id + key.slice(5)] = old[key];
            delete next[key];
          }
        return next;
      });
    setUser(current);
  };
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
    demo,
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
    commentDrafts,
    setCommentDraft: (key: string, value: CommentDraft) =>
      setCommentDrafts((old) => ({ ...old, [key]: value })),
  };
  if (pathname === "/basla") return <ProductContext.Provider value={context}>{children}</ProductContext.Provider>;
  if (!demo && sessionReady && !user && pathname === "/" && welcomeSeen === null)
    return <ProductContext.Provider value={context}><main id="main" aria-busy="true" /></ProductContext.Provider>;
  if (!demo && sessionReady && !user && pathname === "/" && welcomeSeen === false)
    return <ProductContext.Provider value={context}><WelcomeEntry returnTo="/" /></ProductContext.Provider>;
  if (!demo && sessionReady && !user && pathname === "/" && welcomeSeen === true)
    return <ProductContext.Provider value={context}><WelcomeResume fallbackReturnTo="/" /></ProductContext.Provider>;
  // Giriş sonrası interests kaydı hata verirse AuthScreen retry UI'sı kalmalı.
  // Oturum geçişi sırasında giriş sayfasını remount etmek hata/taslak durumunu kaybettirir.
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
            onClick={toggleTheme}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          {user ? (
            <>
              {user.balance !== null && <span className="balance">{user.balance} puan</span>}
              <button
                className="kv-button kv-button--secondary"
                onClick={async () => {
                  try {
                    await client.logout();
                    syncUser();
                    notify("Oturumundan çıkış yaptın.");
                    router.push("/");
                  } catch (error) { notify((error as Error).message); }
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
          <aside className="app-sidebar" aria-label="Ana gezinme">
            <nav aria-label="Masaüstü navigasyonu">
              {navigation.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={pathname === n.href ? "page" : undefined}
                >
                  <span aria-hidden="true"><NavIcon kind={n.icon} /></span>
                  {n.label}
                  {n.href === "/bildirimler" && unreadNotifications > 0 ? (
                    <small className="notification-badge" aria-label={`${unreadNotifications} okunmamış bildirim`}>
                      {unreadNotifications > 99 ? "99+" : unreadNotifications}
                    </small>
                  ) : null}
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
            {demo && <p className="demo-banner">Demo ortamı · Örnek veriler, sayfa yenilendiğinde sıfırlanır. Gerçek hesap veya işlem değildir.</p>}
            <div className="announcement" role="status">
              {message}
            </div>
            {sessionReady ? <Fragment key={(pathname === "/giris" || pathname === "/kayit") ? "auth-session" : (user?.id ?? "guest")}>{children}</Fragment> : <div className="kv-card kv-state">
              <h1>{sessionError ? "Bağlantı kurulamadı." : "Oturum kontrol ediliyor…"}</h1>
              {sessionError && <><p role="alert">{sessionError}</p><button className="kv-button" onClick={() => retrySession(n => n + 1)}>Tekrar dene</button></>}
            </div>}
          </main>
          <aside className="app-aside" aria-label="Topluluk önerileri">
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
            {demo && <div className="kv-card kv-stack">
              <h2>Keşfetmeye başla</h2>
              <Link href="/karar/calisma-sekli">Uzaktan mı, ofisten mi?</Link>
              <Link href="/karar/tatil-rotasi">Sıradaki tatil rotan</Link>
              <Link href="/karar/ilk-bisiklet">İlk bisikletini seçerken</Link>
            </div>}
            {client instanceof DemoClient && (
              <details className="demo-controls">
                <summary>Demo test araçları</summary>
                <p>Sonraki istekte bir hata örneği gösterir.</p>
                {[
                  ["list", "Akış"],
                  ["vote", "Oy"],
                  ["create", "Yayın"],
                  ["login", "Giriş"],
                  ["engagement", "Yorum yükleme"],
                  ["reaction", "Tepki"],
                  ["comment", "Yorum gönderme"],
                  ["editComment", "Yorum düzenleme"],
                  ["deleteComment", "Yorum silme"],
                  ["discovery", "Keşfet"],
                  ["categories", "Kategori"],
                  ["search", "Arama"],
                  ["trends", "Trend"],
                  ["discoveryMore", "Liste devamı"],
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
                <button
                  className="kv-button kv-button--ghost"
                  onClick={() => {
                    client.expireDiscoveryPages();
                    notify(
                      "Demo liste imleçleri sıfırlandı. Devamını yüklerken yenileme istenecek.",
                    );
                  }}
                >
                  Liste süresini doldur
                </button>
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
              <span aria-hidden="true"><NavIcon kind={n.icon} /></span>
              {n.label}
              {n.href === "/bildirimler" && unreadNotifications > 0 ? (
                <small className="notification-badge" aria-label={`${unreadNotifications} okunmamış bildirim`}>
                  {unreadNotifications > 99 ? "99+" : unreadNotifications}
                </small>
              ) : null}
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

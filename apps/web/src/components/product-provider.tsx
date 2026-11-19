"use client";
import { Fragment, createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { ApiClient } from "../lib/api-client";
import type { DemoClient } from "../lib/demo-client";
import { SpaceHero } from "./space-hero";
import { SceneMotionProvider } from "./scene-motion";
import { StudioAtmosphere } from "./studio-atmosphere";
import { emptyDraft, safeReturnTo } from "../lib/model";
import type { Draft, ProductClient, User } from "../lib/model";
import type { CommentDraft } from "../features/social/model";

const MissionScene = dynamic(() => import("./mission-scene").then(module => module.MissionScene), {
  loading: () => <div className="mission-scene" aria-busy="true"><div className="mission-viewport" /></div>,
});

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

export function ProductProvider({ children }: { children: ReactNode }) {
  // #187: build sabiti; api modu build'inde demo dalları ölü koddur ve bundle'dan elenir. DemoClient yalnız demo
  // dalında yüklenir: statik import kullanılmasa da modülü (demo hesapları, örnek anketler) bundle'da tutardı.
  const demo = process.env.NEXT_PUBLIC_KV_DATA_MODE === "demo";
  const [client] = useState<ProductClient>(() => {
    if (process.env.NEXT_PUBLIC_KV_DATA_MODE === "demo") {
      const { DemoClient } = require("../lib/demo-client") as typeof import("../lib/demo-client");
      return new DemoClient();
    }
    return new ApiClient(process.env.NEXT_PUBLIC_API_URL ?? "");
  });
  // Demo forms also wait for hydration so early input cannot be discarded.
  const [sessionReady, setSessionReady] = useState(false);
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
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [themeReady, setThemeReady] = useState(false);
  const [gate, setGate] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const pointerTrigger = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  // The server supplies only the anonymous API projection on these routes.
  // Do not hide that public HTML behind client-only session restoration.
  const publicPollRead = pathname.startsWith("/karar/");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("kararver:theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch { /* Retain the default theme when storage is unavailable. */ }
    setThemeReady(true);
  }, []);
  function toggleTheme() {
    if (!themeReady) return;
    setTheme(previous => {
      const next = previous === "dark" ? "light" : "dark";
      try { window.localStorage.setItem("kararver:theme", next); } catch { /* Retain in-memory preference. */ }
      return next;
    });
  }
  const router = useRouter();
  const previousPath = useRef(pathname);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (gate && !element.open) element.showModal();
    if (!gate && element.open) {
      element.close();
      trigger.current?.focus();
    }
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
    // WebKit pointer clicks may leave focus on the page instead of the invoker.
    trigger.current = pointerTrigger.current ?? document.activeElement as HTMLElement;
    setReturnTo(path);
    setGate(true);
    return false;
  }
  function closeGate() {
    setGate(false);
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
  // Giriş sonrası interests kaydı hata verirse AuthScreen retry UI'sı kalmalı.
  // Oturum geçişi sırasında giriş sayfasını remount etmek hata/taslak durumunu kaybettirir.
  return (
    <ProductContext.Provider value={context}>
      <SceneMotionProvider>
      <div className="product" data-theme={theme} data-experience={pathname === "/" ? "gravity" : pathname === "/kesfet" || pathname === "/topluluklar" ? "mission" : "studio"} data-area={pathname.startsWith("/admin") ? "admin" : pathname === "/olustur" ? "compose" : pathname === "/bildirimler" ? "notifications" : ["/kayit", "/giris", "/sifremi-unuttum", "/sifre-yenile", "/dogrula"].includes(pathname) ? "auth" : undefined}
        onClickCapture={event => {
          const control = event.target instanceof Element ? event.target.closest("button,a,input,textarea,select") : null;
          pointerTrigger.current = control instanceof HTMLElement ? control : null;
        }}
        onKeyDownCapture={() => { pointerTrigger.current = null; }}
      >
        <a className="kv-skip" href="#main" tabIndex={0}>
          İçeriğe geç
        </a>
        <header className="app-header">
          <Link href="/" className="brand">
            <span aria-hidden="true">↗</span>KararVer
          </Link>
          <span className="header-caption">
            Birlikte düşün. Kendin karar ver.
          </span>
          <nav className="space-header-nav" aria-label="Üst gezinme">
            {[["/", "Ana Sayfa"], ["/kesfet", "Keşfet"], ["/yukselenler", "Trendler"], ["/topluluklar", "Topluluklar"]].map(([href, label]) =>
              <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>
            )}
          </nav>
          <form className="space-header-search" role="search" aria-label="Üst menü araması" action="/kesfet">
            <label className="space-search-label" htmlFor="header-search">Anketlerde ara</label>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
            <input id="header-search" name="q" type="search" placeholder="Anketlerde ara…" minLength={2} maxLength={100} required />
            <button type="submit" aria-label="Üst menüde ara">↗</button>
          </form>
          <button
            className="kv-button kv-button--ghost"
            aria-label={
              theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç"
            }
            onClick={toggleTheme}
            aria-disabled={!themeReady}
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
        <main id="main" tabIndex={-1} className="space-main">
          {pathname === "/" && <SpaceHero />}
          {(pathname === "/kesfet" || pathname === "/topluluklar") && <MissionScene key={pathname} kind={pathname === "/kesfet" ? "landing" : "launch"} />}
          <div className="app-layout" id={pathname === "/kesfet" || pathname === "/topluluklar" ? "mission-content" : undefined} tabIndex={pathname === "/kesfet" || pathname === "/topluluklar" ? -1 : undefined}>
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
          <div className="app-main">
            {demo && <p className="demo-banner">Demo ortamı · Örnek veriler, sayfa yenilendiğinde sıfırlanır. Gerçek hesap veya işlem değildir.</p>}
            <div className="announcement" role="status">
              {message}
            </div>
            {pathname !== "/" && pathname !== "/kesfet" && pathname !== "/topluluklar" && <StudioAtmosphere pathname={pathname} unread={unreadNotifications} />}
            {sessionReady || publicPollRead ? <Fragment key={(pathname === "/giris" || pathname === "/kayit") ? "auth-session" : (user?.id ?? "guest")}>{children}</Fragment> : <div className="kv-card kv-state">
              <h1>{sessionError ? "Bağlantı kurulamadı." : "Oturum kontrol ediliyor…"}</h1>
              {sessionError && <><p role="alert">{sessionError}</p><button className="kv-button" onClick={() => retrySession(n => n + 1)}>Tekrar dene</button></>}
            </div>}
          </div>
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
            {demo && (
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
                      (client as DemoClient).failNext(operation);
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
                    (client as DemoClient).expireDiscoveryPages();
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
        </main>
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
          onCancel={event => { event.preventDefault(); closeGate(); }}
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
      </SceneMotionProvider>
    </ProductContext.Provider>
  );
}

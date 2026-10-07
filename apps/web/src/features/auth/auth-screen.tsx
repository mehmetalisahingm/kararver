"use client";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProduct } from "../../components/product-provider";
import { ErrorMessage, Field } from "../../components/fields";
import { ApiClient } from "../../lib/api-client";
import { safeReturnTo } from "../../lib/model";
import { WelcomeAuthContext } from "../onboarding/welcome";
export type AuthMode = "login" | "register" | "verify" | "forgot" | "reset";
const titles: Record<AuthMode, string> = {
  login: "Tekrar hoş geldin.",
  register: "Fikrinle aramıza katıl.",
  verify: "E-postanı doğrula.",
  forgot: "Şifreni mi unuttun?",
  reset: "Yeni bir şifre belirle.",
};
export function AuthScreen({
  mode,
  target,
  initialEmail = "",
  onboarding = false,
}: {
  mode: AuthMode;
  target?: string;
  initialEmail?: string;
  onboarding?: boolean;
}) {
  const { client, demo, user, syncUser, notify, returnTo } = useProduct();
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (demo || !["verify", "reset"].includes(mode)) return;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (token) {
      setCode(token);
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, [demo, mode]);
  const destination = safeReturnTo(target || returnTo);
  const suffix = `?returnTo=${encodeURIComponent(destination)}${onboarding ? "&onboarding=1" : ""}`;
  const emailSuffix = `${suffix}&email=${encodeURIComponent(email)}`;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "login") {
        await client.login(email, password);
        syncUser();
        notify(
          "Giriş yaptın. Seçimin korunuyor; işlemi tamamlamak için yeniden onayla.",
        );
        router.push(destination);
      }
      if (mode === "register") {
        await client.register(name, email, password, username);
        if (demo) router.push(`/dogrula${emailSuffix}`); else setDone(true);
      }
      if (mode === "verify") {
        await client.verify(email, code);
        setDone(true);
      }
      if (mode === "forgot") {
        await client.requestReset(email);
        setDone(true);
      }
      if (mode === "reset") {
        await client.reset(email, code, password);
        syncUser();
        setDone(true);
      }
      setPassword("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-card kv-card screen-stack">
      {onboarding && <WelcomeAuthContext />}
      <span className="eyebrow">KARARVER TOPLULUĞU</span>
      <h1>{titles[mode]}</h1>
      <p className="kv-muted">
        {mode === "login"
          ? "Birlikte düşünmek için küçük bir adım."
          : demo ? "Örnek hesap akışını burada deneyebilirsin." : "Hesabını güvenle yönet."}
      </p>
      {demo && <div className="demo-note">
        Yalnızca demo bilgileri kullan. Hazır hesap:{" "}
        <strong>umit@example.test</strong> / <strong>Demo12345!</strong>. Diğer
        hesap: deniz@example.test. Yeni kayıt .test uzantılı olmalı. Kod:{" "}
        <strong>123456</strong>. Gerçek e-posta gönderilmez.
      </div>}
      {done ? (
        <div className="screen-stack">
          <p role="status">
            {mode === "register" ? "E-postanı kontrol et. Hesap uygunsa doğrulama bağlantısı gönderildi." : mode === "forgot"
              ? "Bu hesap varsa sıfırlama bağlantısı gönderildi."
              : mode === "verify"
                ? "E-postan doğrulandı. Şimdi giriş yapabilirsin."
                : "Şifren yenilendi. Yeniden giriş yap."}
          </p>
          <Link
            className="kv-button"
            href={
              mode === "forgot" && demo
                ? `/sifre-yenile${emailSuffix}`
                : `/giris${emailSuffix}`
            }
          >
            {mode === "forgot" && demo ? "Sıfırlama ekranına geç" : "Giriş yap"}
          </Link>
        </div>
      ) : (
        <form className="screen-stack" onSubmit={submit}>
          {mode === "register" && (
            <Field id="name" label="Görünen ad">
              <input
                id="name"
                name="name"
                autoComplete="nickname"
                required
                maxLength={60}
                className="kv-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}
          {mode === "register" && !demo && <Field id="username" label="Kullanıcı adı" help="3–30 karakter: küçük harf, rakam, alt çizgi.">
            <input id="username" name="username" className="kv-input" autoComplete="username" required pattern="[a-z0-9_]{3,30}" minLength={3} maxLength={30} value={username} onChange={e => setUsername(e.target.value)} />
          </Field>}
          {(demo || !["verify", "reset"].includes(mode)) && <Field id="email" label={demo ? "Demo e-posta" : "E-posta"}>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="kv-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>}
          {["login", "register", "reset"].includes(mode) && (
            <Field
              id="password"
              label={demo ? (mode === "reset" ? "Yeni demo şifre" : "Demo şifre") : "Şifre"}
              help={demo ? "En az 8 karakter. Gerçek şifreni kullanma." : "Yeni şifre 10–128 karakter olmalı."}
            >
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
                minLength={demo ? 8 : mode === "login" ? 1 : 10}
                maxLength={128}
                className="kv-input"
                value={password}
                aria-describedby="password-help"
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
          {demo && ["verify", "reset"].includes(mode) && (
            <Field id="code" label="Demo kodu">
              <input
                id="code"
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                required
                maxLength={6}
                minLength={6}
                className="kv-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
          )}
          {!demo && ["verify", "reset"].includes(mode) && <p className="kv-help">{code ? "E-postadaki bağlantı alındı. İşlemi tamamlamak için onayla." : "E-postana gönderilen bağlantıyı açmalısın."}</p>}
          <ErrorMessage message={error} />
          <button className="kv-button" disabled={busy || (!demo && ["verify", "reset"].includes(mode) && !code)} aria-busy={busy}>
            {busy
              ? "İşlem sürüyor…"
              : mode === "login"
                ? "Giriş yap"
                : mode === "register"
                  ? (demo ? "Demo hesabı oluştur" : "Hesap oluştur")
                  : mode === "verify"
                    ? (demo ? "Kodu doğrula" : "E-postayı doğrula")
                    : mode === "forgot"
                      ? "Sıfırlama isteği oluştur"
                      : (demo ? "Demo şifreyi yenile" : "Şifreyi yenile")}
          </button>
        </form>
      )}
      {!demo && mode === "verify" && user && !user.verified && <button type="button" className="kv-button kv-button--secondary" disabled={busy} onClick={async () => {
        if (!(client instanceof ApiClient)) return;
        setBusy(true); setError("");
        try { await client.resendVerification(); notify("Doğrulama bağlantısı gönderildi."); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
      }}>Doğrulama bağlantısını yeniden gönder</button>}
      <div className="auth-links">
        {mode === "login" && (
          <>
            <Link href={`/kayit${suffix}`}>Yeni hesap oluştur</Link>
            <Link href={`/sifremi-unuttum${emailSuffix}`}>Şifremi unuttum</Link>
            <Link href={`/dogrula${emailSuffix}`}>E-postamı doğrula</Link>
          </>
        )}
        <Link href={destination}>← İşlem yapmadan geri dön</Link>
      </div>
    </section>
  );
}

"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProduct } from "../../components/product-provider";
import { ErrorMessage, Field } from "../../components/fields";
import { safeReturnTo } from "../../lib/model";
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
}: {
  mode: AuthMode;
  target?: string;
  initialEmail?: string;
}) {
  const { client, syncUser, notify, returnTo } = useProduct();
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const destination = safeReturnTo(target || returnTo);
  const suffix = `?returnTo=${encodeURIComponent(destination)}`;
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
        await client.register(name, email, password);
        router.push(`/dogrula${emailSuffix}`);
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
      <span className="eyebrow">KARARVER TOPLULUĞU</span>
      <h1>{titles[mode]}</h1>
      <p className="kv-muted">
        {mode === "login"
          ? "Birlikte düşünmek için küçük bir adım."
          : "Örnek hesap akışını burada deneyebilirsin."}
      </p>
      <div className="demo-note">
        Yalnızca demo bilgileri kullan. Hazır hesap:{" "}
        <strong>umit@example.test</strong> / <strong>Demo12345!</strong>. Diğer
        hesap: deniz@example.test. Yeni kayıt .test uzantılı olmalı. Kod:{" "}
        <strong>123456</strong>. Gerçek e-posta gönderilmez.
      </div>
      {done ? (
        <div className="screen-stack">
          <p role="status">
            {mode === "forgot"
              ? "Bu demo hesap varsa sıfırlama isteği hazırlandı."
              : mode === "verify"
                ? "Demo e-postan doğrulandı. Şimdi giriş yapabilirsin."
                : "Demo şifren yenilendi. Yeniden giriş yap."}
          </p>
          <Link
            className="kv-button"
            href={
              mode === "forgot"
                ? `/sifre-yenile${emailSuffix}`
                : `/giris${emailSuffix}`
            }
          >
            {mode === "forgot" ? "Sıfırlama ekranına geç" : "Giriş yap"}
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
          <Field id="email" label="Demo e-posta">
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
          </Field>
          {["login", "register", "reset"].includes(mode) && (
            <Field
              id="password"
              label={mode === "reset" ? "Yeni demo şifre" : "Demo şifre"}
              help="En az 8 karakter. Gerçek şifreni kullanma."
            >
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
                minLength={8}
                className="kv-input"
                value={password}
                aria-describedby="password-help"
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
          {["verify", "reset"].includes(mode) && (
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
          <ErrorMessage message={error} />
          <button className="kv-button" disabled={busy} aria-busy={busy}>
            {busy
              ? "İşlem sürüyor…"
              : mode === "login"
                ? "Giriş yap"
                : mode === "register"
                  ? "Demo hesabı oluştur"
                  : mode === "verify"
                    ? "Kodu doğrula"
                    : mode === "forgot"
                      ? "Sıfırlama isteği oluştur"
                      : "Demo şifreyi yenile"}
          </button>
        </form>
      )}
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

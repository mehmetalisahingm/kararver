"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProduct } from "../../components/product-provider";
import { safeReturnTo } from "../../lib/model";
import {
  makeWelcomeDraft,
  markWelcomeSeen,
  readWelcomeDraft,
  writeWelcomeDraft,
  type WelcomeDemoChoice,
} from "../../lib/welcome-draft";
import { Welcome, WelcomeAuthContext } from "./welcome";

type Category = { id: string; name: string };

export function WelcomeEntry({ returnTo = "/" }: { returnTo?: string }) {
  const { client } = useProduct();
  const router = useRouter();
  const destination = safeReturnTo(returnTo);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    client.getCategories()
      .then((items) => {
        if (!active) return;
        setCategories(items.map(({ id, name }) => ({ id, name })));
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [client, attempt]);

  function continueTo(
    mode: "giris" | "kayit",
    payload: { categoryIds: string[]; demoChoice: WelcomeDemoChoice | null },
  ) {
    const draft = makeWelcomeDraft({ ...payload, returnTo: destination });
    writeWelcomeDraft(draft);
    markWelcomeSeen();
    router.push(`/${mode}?onboarding=1&returnTo=${encodeURIComponent(destination)}`);
  }

  return (
    <Welcome
      categories={categories}
      categoriesLoading={loading}
      categoriesError={error}
      onRetryCategories={() => setAttempt((value) => value + 1)}
      onComplete={(payload) => continueTo("giris", payload)}
      onRegister={(payload) => continueTo("kayit", payload)}
      onSkip={() => continueTo("giris", { categoryIds: [], demoChoice: null })}
    />
  );
}

export function WelcomeResume({ fallbackReturnTo = "/" }: { fallbackReturnTo?: string }) {
  const draft = readWelcomeDraft();
  const destination = safeReturnTo(draft?.returnTo ?? fallbackReturnTo);
  const suffix = `?onboarding=1&returnTo=${encodeURIComponent(destination)}`;
  return (
    <main id="main" className="welcome-resume">
      <section className="auth-card kv-card screen-stack">
        <WelcomeAuthContext />
        <span className="eyebrow">KALDIĞIN YERDEN DEVAM ET</span>
        <h1>Kararlarını kişiselleştirmek için hesabınla devam et.</h1>
        <p className="kv-muted">
          Tanıtımı tekrar oynatmıyoruz. Varsa seçtiğin ilgi alanları girişten sonra güvenli biçimde hesabına bağlanacak.
        </p>
        <Link className="kv-button" href={`/giris${suffix}`}>Giriş yap</Link>
        <Link className="kv-button kv-button--secondary" href={`/kayit${suffix}`}>Yeni hesap oluştur</Link>
        <Link href="/basla">Tanıtımı tekrar izle</Link>
      </section>
    </main>
  );
}

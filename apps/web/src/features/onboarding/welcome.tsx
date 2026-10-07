"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { WelcomeDemoChoice } from "../../lib/welcome-draft";
import { WELCOME_SEEN } from "../../lib/welcome-draft";
import styles from "./welcome.module.css";

export { WELCOME_SEEN };

type Category = { id: string; name: string };
type CompletePayload = { categoryIds: string[]; demoChoice: WelcomeDemoChoice | null };

const titles = [
  "İnsanlar gerçekten ne düşünüyor?",
  "Kararsız kaldığında yalnız değilsin.",
  "Bir mesaj. İki farklı bakış.",
  "Senin kararın, başka birinin bakış açısı.",
  "Merakının peşinden git.",
];

export function Welcome({
  categories,
  categoriesLoading = false,
  categoriesError = "",
  onRetryCategories,
  onComplete,
  onRegister,
  onSkip,
}: {
  categories: Category[];
  categoriesLoading?: boolean;
  categoriesError?: string;
  onRetryCategories?: () => void;
  onComplete: (payload: CompletePayload) => void;
  onRegister?: (payload: CompletePayload) => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const [choice, setChoice] = useState<WelcomeDemoChoice | null>(null);
  const [selected, select] = useState<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);

  const choiceLabel = choice === "write" ? "Yazarım" : choice === "wait" ? "Beklerim" : "—";
  const payload = (): CompletePayload => ({ categoryIds: selected, demoChoice: choice });

  return <main className={styles.welcome} id="main">
    <header className={styles.header}>
      <Link href="/basla" className={styles.logo}>↗ KARARVER</Link>
      <Link href="/giris?onboarding=1" onClick={(event) => { event.preventDefault(); onSkip(); }}>
        Zaten üye misin? Giriş yap ↗
      </Link>
    </header>
    <div className={styles.orbit} aria-hidden="true">
      <span>Bir fikir değiştirir.</span><span>Sen ne düşünüyorsun?</span><span>İki seçenek. Yeni bir bakış.</span>
    </div>
    <section className={styles.stage} key={step} aria-labelledby="welcome-title">
      <p className={styles.eyebrow}>FARKLI FİKİRLER. ORTAK MERAK. <span>0{step + 1} / 05</span></p>
      {step === 0 && <p className={styles.wordmark} aria-hidden="true">KARAR<span>VER</span></p>}
      <h1 id="welcome-title" ref={heading} tabIndex={-1}>{titles[step]}</h1>

      {step < 2 && <>
        <p className={styles.lead}>{step === 0 ? "Bir seçimin, düşündüğünden daha çok şey anlatır." : "Sor. Oy ver. Sonucu gör."}</p>
        <button disabled={!ready} className={styles.primary} onClick={() => setStep(step + 1)}>
          {step === 0 ? "Bir karar verelim" : "Kendin dene"} <span aria-hidden="true">↗</span>
        </button>
      </>}

      {step === 2 && <div className={styles.card}>
        <span className={styles.badge}>30 SANİYELİK DEMO · SOSYAL YAŞAM</span>
        <p className={styles.question}>Bir arkadaşın mesajına 6 saattir cevap vermedi. Tekrar yazar mısın?</p>
        <div className={styles.options}>
          <button onClick={() => { setChoice("write"); setStep(3); }}><span aria-hidden="true">↗</span>Yazarım</button>
          <button onClick={() => { setChoice("wait"); setStep(3); }}><span aria-hidden="true">◷</span>Beklerim</button>
        </div>
        <small>Örnek senaryo. Seçimin gerçek bir ankete oy olarak eklenmez.</small>
      </div>}

      {step === 3 && <div className={styles.card}>
        <span className={styles.badge}>SENİN SEÇİMİN · {choiceLabel}</span>
        <div className={styles.results} aria-label="Örnek sonuçlar: yüzde 68 Beklerim, yüzde 32 Yazarım">
          <div><strong>%68</strong><span>Beklerim</span></div>
          <div><strong>%32</strong><span>Yazarım</span></div>
          <div className={styles.bar} aria-hidden="true"><span /></div>
        </div>
        <p>Farklı kararlar, aynı soruda buluşuyor.</p>
        <small>Oranlar demo için hazırlanmıştır; gerçek katılımcı verisi değildir.</small>
        <p className={styles.hook}>Peki diğer konularda çoğunlukla aynı mı düşünüyorsun?</p>
        <button className={styles.primary} onClick={() => setStep(4)}>Keşfetmeye devam et ↗</button>
      </div>}

      {step === 4 && <>
        <p className={styles.lead}>Seni hangi kararlar düşündürüyor?</p>
        {categoriesLoading && <p role="status" className={styles.note}>Gerçek kategoriler yükleniyor…</p>}
        {categoriesError && <div role="alert" className={styles.card}>
          <p>İlgi alanları yüklenemedi: {categoriesError}</p>
          {onRetryCategories && <button className={styles.secondary} onClick={onRetryCategories}>Tekrar dene</button>}
        </div>}
        {!categoriesLoading && !categoriesError && <div className={styles.interests}>
          {categories.map((category, index) => <button
            key={category.id}
            aria-pressed={selected.includes(category.id)}
            onClick={() => select((old) => old.includes(category.id) ? old.filter((id) => id !== category.id) : [...old, category.id])}
          >
            <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            {category.name}
            <span aria-hidden="true">{selected.includes(category.id) ? "✓" : "+"}</span>
          </button>)}
        </div>}
        {!categoriesLoading && !categoriesError && categories.length === 0 && <p className={styles.note}>Şu an seçilebilecek kategori yok. Girişten sonra tekrar deneyebilirsin.</p>}
        <p className={styles.note}>Seçimler gerçek kategori kimlikleriyle girişten sonra hesabına bağlanır. Demo seçimin gerçek oy değildir.</p>
        <Link
          className={styles.primary}
          href="/giris?onboarding=1&returnTo=%2F"
          onClick={(event) => { event.preventDefault(); onComplete(payload()); }}
        >
          Sana göre olan kararları gösterelim ↗
        </Link>
        <Link
          className={styles.secondary}
          href="/kayit?onboarding=1&returnTo=%2F"
          onClick={(event) => {
            if (!onRegister) return;
            event.preventDefault();
            onRegister(payload());
          }}
        >
          Yeni hesap oluştur
        </Link>
      </>}
    </section>
    <footer className={styles.footer}>
      <span>Herkesin fikri var. Karar senin.</span>
      <nav aria-label="Tanıtım adımları">
        {titles.map((title, index) => <span role="img" key={title} className={index === step ? styles.current : ""} aria-current={index === step ? "step" : undefined} aria-label={`${index + 1}. adım${index === step ? ", geçerli" : ""}`} />)}
      </nav>
      {step > 0 && <button onClick={() => setStep(step - 1)}>← Geri</button>}
    </footer>
  </main>;
}

export function WelcomeAuthContext() {
  return <aside className={styles.authContext}>
    <p className={styles.eyebrow}>KARARVER · BİR SONRAKİ KARARIN</p>
    <h2>Fikrin burada bir yer bulsun.</h2>
    <p>Demo bitti. Gerçek sorular, farklı bakış açıları ve senin kararların için hesabınla devam et.</p>
  </aside>;
}

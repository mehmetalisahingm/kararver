"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./welcome.module.css";

export const WELCOME_SEEN = "kv-welcome-v1";
const interests = ["İlişkiler", "Günlük hayat", "Teknoloji", "Üniversite / Kampüs", "Sosyal yaşam"];
const titles = ["İnsanlar gerçekten ne düşünüyor?", "Kararsız kaldığında yalnız değilsin.", "Bir mesaj. İki farklı bakış.", "Senin kararın, başka birinin bakış açısı.", "Merakının peşinden git."];

export function Welcome() {
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const [choice, setChoice] = useState<"Yazarım" | "Beklerim" | null>(null);
  const [selected, select] = useState<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  function finish() {
    try { localStorage.setItem(WELCOME_SEEN, "1"); } catch { /* Storage is optional. */ }
  }
  return <main className={styles.welcome} id="main">
    <header className={styles.header}><Link href="/basla" className={styles.logo}>↗ KARARVER</Link><Link href="/giris?onboarding=1" onClick={finish}>Zaten üye misin? Giriş yap ↗</Link></header>
    <div className={styles.orbit} aria-hidden="true"><span>Bir fikir değiştirir.</span><span>Sen ne düşünüyorsun?</span><span>İki seçenek. Yeni bir bakış.</span></div>
    <section className={styles.stage} key={step} aria-labelledby="welcome-title">
      <p className={styles.eyebrow}>FARKLI FİKİRLER. ORTAK MERAK. <span>0{step + 1} / 05</span></p>
      {step === 0 && <p className={styles.wordmark} aria-hidden="true">KARAR<span>VER</span></p>}
      <h1 id="welcome-title" ref={heading} tabIndex={-1}>{titles[step]}</h1>
      {step < 2 && <><p className={styles.lead}>{step === 0 ? "Bir seçimin, düşündüğünden daha çok şey anlatır." : "Sor. Oy ver. Sonucu gör."}</p><button disabled={!ready} className={styles.primary} onClick={() => setStep(step + 1)}>{step === 0 ? "Bir karar verelim" : "Kendin dene"} <span aria-hidden="true">↗</span></button></>}
      {step === 2 && <div className={styles.card}><span className={styles.badge}>30 SANİYELİK DEMO · SOSYAL YAŞAM</span><p className={styles.question}>Bir arkadaşın mesajına 6 saattir cevap vermedi. Tekrar yazar mısın?</p><div className={styles.options}>{(["Yazarım", "Beklerim"] as const).map((label, i) => <button key={label} onClick={() => { setChoice(label); setStep(3); }}><span aria-hidden="true">{i ? "◷" : "↗"}</span>{label}</button>)}</div><small>Örnek senaryo. Seçimin gerçek bir ankete oy olarak eklenmez.</small></div>}
      {step === 3 && <div className={styles.card}><span className={styles.badge}>SENİN SEÇİMİN · {choice}</span><div className={styles.results} aria-label="Örnek sonuçlar: yüzde 68 Beklerim, yüzde 32 Yazarım"><div><strong>%68</strong><span>Beklerim</span></div><div><strong>%32</strong><span>Yazarım</span></div><div className={styles.bar} aria-hidden="true"><span /></div></div><p>Farklı kararlar, aynı soruda buluşuyor.</p><small>Oranlar demo için hazırlanmıştır; gerçek katılımcı verisi değildir.</small><p className={styles.hook}>Peki diğer konularda çoğunlukla aynı mı düşünüyorsun?</p><button className={styles.primary} onClick={() => setStep(4)}>Keşfetmeye devam et ↗</button></div>}
      {step === 4 && <><p className={styles.lead}>Seni hangi kararlar düşündürüyor?</p><div className={styles.interests}>{interests.map((label, i) => <button key={label} aria-pressed={selected.includes(label)} onClick={() => select(old => old.includes(label) ? old.filter(x => x !== label) : [...old, label])}><span aria-hidden="true">0{i + 1}</span>{label}<span aria-hidden="true">{selected.includes(label) ? "✓" : "+"}</span></button>)}</div><p className={styles.note}>Bu seçimler ön izleme içindir. İlgi alanlarını hesabında düzenleyebilirsin.</p><Link className={styles.primary} onClick={finish} href="/giris?onboarding=1&returnTo=%2Filgi-alanlari">Sana göre olan kararları gösterelim ↗</Link><Link className={styles.secondary} onClick={finish} href="/kayit?onboarding=1&returnTo=%2Filgi-alanlari">Yeni hesap oluştur</Link></>}
    </section>
    <footer className={styles.footer}><span>Herkesin fikri var. Karar senin.</span><nav aria-label="Tanıtım adımları">{titles.map((title, i) => <span role="img" key={title} className={i === step ? styles.current : ""} aria-current={i === step ? "step" : undefined} aria-label={`${i + 1}. adım${i === step ? ", geçerli" : ""}`} />)}</nav>{step > 0 && <button onClick={() => setStep(step - 1)}>← Geri</button>}</footer>
  </main>;
}

export function WelcomeAuthContext() {
  return <aside className={styles.authContext}><p className={styles.eyebrow}>KARARVER · BİR SONRAKİ KARARIN</p><h2>Fikrin burada bir yer bulsun.</h2><p>Demo bitti. Gerçek sorular, farklı bakış açıları ve senin kararların için hesabınla devam et.</p></aside>;
}

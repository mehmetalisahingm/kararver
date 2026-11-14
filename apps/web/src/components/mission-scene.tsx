"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useSceneMotion, useScrollScene } from "./scene-motion";
import { MissionEffects, type MissionKind, type MissionPhase } from "./mission-effects";

const phaseLabels: Record<MissionPhase, string> = {
  ready: "Yola çıkmaya hazır.", approach: "Yüzeye yaklaşıyor.", contact: "İlk temas.", landed: "Yeni bir başlangıç.",
  "countdown-3": "Fırlatma için üç.", "countdown-2": "İki.", "countdown-1": "Bir.", flight: "Yükseliyoruz.", orbit: "Yeni bir yörünge.",
};

export function MissionScene({ kind }: { kind: MissionKind }) {
  const { ref, still } = useScrollScene("orbit");
  const { paused, reduced, toggle } = useSceneMotion();
  const viewport = useRef<HTMLDivElement>(null);
  const actor = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(kind === "landing" ? 1 : 0);
  const [phase, setPhase] = useState<MissionPhase>(kind === "landing" ? "approach" : "ready");
  const landing = kind === "landing";
  const running = landing ? phase === "approach" || phase === "contact" : phase.startsWith("countdown") || phase === "flight";
  const countdown = phase.startsWith("countdown") ? phase.at(-1) : null;
  return <section ref={ref} className={"mission-scene mission-" + kind} data-still={still} data-phase={phase} aria-labelledby="mission-title">
    <div className="mission-viewport" ref={viewport}>
      <img className="mission-terrain" src="/art/space/lunar-surface-v3.webp" alt="" width="1672" height="941" fetchPriority="high" />
      <div className="mission-vignette" aria-hidden="true" />
      <div className="mission-coordinates"><span>{landing ? "KEŞFET / İLK TEMAS" : "TOPLULUKLAR / ORTAK YÖRÜNGE"}</span><span aria-hidden="true">{landing ? "02 — YÜZEYE İNİŞ" : "03 — BİRLİKTE KALKIŞ"}</span></div>
      <div className="mission-copy">
        <h1 id="mission-title" aria-label={landing ? "Keşfet" : "Topluluklar"}><span aria-hidden="true">{landing ? "İlk adım" : "Birlikte"}<em>{landing ? "senin." : "yüksel."}</em></span></h1>
        <p>{landing ? <>Bildiğinin dışına çık.<br />Belki de fikrin değişir.</> : <>Aynı merak. Farklı insanlar.<br />Bir araya gelince başka.</>}</p>
      </div>
      <div className="mission-contact-shadow" aria-hidden="true" />
      <div ref={actor} className="mission-actor" aria-hidden="true"><img src={landing ? "/art/space/landed-astronaut-v3.webp" : "/art/space/launch-rocket-v3.webp"} alt="" width={landing ? 768 : 400} height={landing ? 1152 : 1200} fetchPriority="high" /></div>
      <MissionEffects kind={kind} run={run} viewport={viewport} actor={actor} onPhase={setPhase} />
      <button className="mission-motion" disabled={reduced} onClick={toggle} aria-pressed={paused} aria-label={reduced ? "Azaltılmış hareket etkin" : paused ? "Hareketi başlat" : "Hareketi durdur"}><span aria-hidden="true">{still ? "▷" : "Ⅱ"}</span><span>{reduced ? "Hareket azaltıldı" : paused ? "Devam et" : "Hareketi durdur"}</span></button>
      <div className="mission-flight-controls">
        <span className="mission-flight-status" role="status" aria-live="polite">{phaseLabels[phase]}</span>
        <button type="button" className={landing ? "mission-replay" : "mission-ignite"} disabled={still || running} onClick={() => setRun(value => value + 1)}>
          {landing ? running ? "İniş sürüyor…" : "İnişi yeniden izle ↻" : running ? "Fırlatma sürüyor…" : phase === "orbit" ? "Yeniden fırlat ↗" : "Fırlatmayı başlat ↗"}
        </button>
      </div>
      {countdown && <span className="mission-countdown" aria-hidden="true" key={countdown}>{countdown.padStart(2,"0")}</span>}
      <a className="mission-browse" href="#mission-content"><span>{landing ? "Sorulara in." : "Ekibini bul."}</span><span aria-hidden="true">↓</span></a>
      <div className="mission-endnote"><span>{landing ? "HER FİKİR YENİ BİR YÜZEY." : "TEK BAŞINA ÇIKILMAZ."}</span><Link href={landing ? "/topluluklar" : "/kesfet"}>{landing ? "Birlikte devam et ↗" : "Yeni fikirler keşfet ↗"}</Link></div>
    </div>
  </section>;
}

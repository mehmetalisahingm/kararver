"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useScrollScene } from "./scene-motion";

export function OrbitalJourney() {
  const windowScene = useScrollScene("reveal");
  const choices = useScrollScene("reveal");
  const router = useRouter();
  const [selected, setSelected] = useState<"explore" | "create" | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const choose = (event: MouseEvent<HTMLAnchorElement>, choice: "explore" | "create", href: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (choices.still && timer.current === null) return;
    event.preventDefault();
    if (timer.current !== null) return;
    setSelected(choice);
    timer.current = window.setTimeout(() => router.push(href), 520);
  };
  return <>
    <section ref={windowScene.ref} className="orbit-window" data-still={windowScene.still} aria-labelledby="orbit-window-title">
      <div className="orbit-window-art" aria-hidden="true"><img className="orbit-window-earth" src="/art/space/window-earth-journey.webp" alt="" loading="lazy" /><img className="orbit-window-frame" src="/art/space/window-frame-journey.webp" alt="" loading="lazy" /></div>
      <div className="orbit-window-shade" aria-hidden="true" />
      <div className="orbit-window-copy"><span className="journey-kicker">02 / BİR ADIM UZAKTAN</span><h2 id="orbit-window-title">Bazen uzaklaşmak,<br /><em>yakından görmektir.</em></h2><p>Dünya aynı dünya. Ama baktığın yer değişince, ihtimaller de değişir.</p><a href="#decision-capsules">Yeni bir açıya bak <span aria-hidden="true">↓</span></a></div>
      <div className="orbit-window-coordinate" aria-hidden="true">YÖRÜNGEDE / 408 KM<br />BİR BAŞKA BAKIŞ</div>
    </section>
    <section ref={choices.ref} className="decision-capsules" id="decision-capsules" data-still={choices.still} aria-labelledby="decision-title">
      <div className="decision-topline"><span className="journey-kicker">03 / YÖNÜNÜ BELİRLE</span><span aria-hidden="true">İKİ YOL / TEK SEN</span></div>
      <div className="decision-heading"><h2 id="decision-title">Bir seçim yap.<br /><em>Yolun değişsin.</em></h2><p>Bir soru, başka bir bakış açısı ya da hiç düşünmediğin bir cevap. İlk adım senin.</p></div>
      <div className="decision-bay" data-selected={selected || undefined} aria-busy={selected !== null}>
        <img src="/art/space/decision-capsules-journey.webp" alt="" loading="lazy" />
        <Link className="decision-path decision-path--left" href="/kesfet" onClick={event => choose(event, "explore", "/kesfet")}><span className="decision-number">01 / KEŞFET</span><span className="decision-path-title">Fikirlere<br />yaklaş.</span><span className="decision-action">Soruları keşfet <b aria-hidden="true">↗</b></span></Link>
        <Link className="decision-path decision-path--right" href="/olustur" onClick={event => choose(event, "create", "/olustur")}><span className="decision-number">02 / OLUŞTUR</span><span className="decision-path-title">Sorunu<br />ortaya koy.</span><span className="decision-action">Bir soru oluştur <b aria-hidden="true">↗</b></span></Link>
      </div>
      <div className="decision-bottom"><span>HER YÖN YENİ BİR İHTİMAL.</span><a href="#discovery-stage">Yolculuğa devam et ↓</a></div>
    </section>
  </>;
}

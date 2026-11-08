"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSceneMotion, useScrollScene } from "./scene-motion";
import { OrbitalJourney } from "./orbital-journey";

function CabinHero() {
  const section = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [visible, setVisible] = useState(false);

  // An iframe one viewport below the fold can still be eagerly fetched by
  // browser lazy-loading heuristics. Loading the 3D engine while users are
  // trying to read the feed can stall hydration and accessibility tests.
  // Mount it only once the user actually reaches the cabin.
  useEffect(() => {
    const element = section.current;
    if (!element) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !frame.current) return;
    const observer = new IntersectionObserver(([entry]) => frame.current?.contentWindow?.postMessage({ type: "kararver-cabin-visibility", visible: entry.isIntersecting }, location.origin));
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [visible]);

  return <section ref={section} id="cabin-stage" aria-label="Bir fikre kapıl: etkileşimli 3D kabin" style={{ height: "100svh", minHeight: 660, position: "relative", background: "#171a1b" }}>
    {visible
      ? <iframe loading="lazy" ref={frame} onLoad={() => { const rect = frame.current?.getBoundingClientRect(); if (rect) frame.current?.contentWindow?.postMessage({ type: "kararver-cabin-visibility", visible: rect.bottom > 0 && rect.top < innerHeight }, location.origin); }} title="Yer çekimiyle etkileşimli 3D uzay kabini" src="/experiences/cabin/index.html?embed=1" style={{ width: "100%", height: "100%", border: 0, display: "block" }} />
      : <div aria-hidden="true" style={{ width: "100%", height: "100%" }} />}
    <a href="#discovery-stage" style={{ position: "absolute", bottom: 94, right: "4vw", color: "#e7f3a5", background: "#171e1bd9", padding: "10px 14px", fontSize: 12, textDecoration: "none", borderRadius: 3 }}>Keşfetmeye devam et ↓</a>
  </section>;
}

function GravityWord({ children, offset = 0 }: { children: string; offset?: number }) {
  return <span className="gravity-word" aria-hidden="true">{Array.from(children).map((letter, index) =>
    <span key={index} style={{ "--fall": (110 + ((index + offset) % 4) * 85) + "px", "--turn": (((index + offset) % 2 ? 1 : -1) * (12 + index * 5)) + "deg" } as CSSProperties}>{letter === " " ? "\u00a0" : letter}</span>
  )}</span>;
}

function OriginalHero() {
  const { ref, still } = useScrollScene("orbit");
  const { paused, reduced, toggle } = useSceneMotion();
  return <section ref={ref} className="gravity-hero" data-still={still} aria-labelledby="space-hero-title">
    <div className="gravity-viewport">
      <img className="gravity-earth" src="/art/space/orbital-earth-v2.webp" alt="" width="2160" height="1215" fetchPriority="high" />
      <div className="gravity-shade" aria-hidden="true" />
      <div className="gravity-coordinates" aria-hidden="true"><span>FARKLI FİKİRLERİN ÇEKİM ALANI</span><span>01 / YÖRÜNGEYE GİRİŞ</span></div>
      <h1 id="space-hero-title" className="gravity-title" aria-label="Bir fikre kapıl.">
        <GravityWord>Bir fikre</GravityWord><GravityWord offset={3}>kapıl.</GravityWord>
      </h1>
      <div className="gravity-astronaut" aria-hidden="true">
        <div className="gravity-astronaut-float"><img src="/art/space/floating-astronaut-v2.webp" alt="" width="960" height="1280" fetchPriority="high" /></div>
      </div>
      <svg className="gravity-orbit" viewBox="0 0 1000 650" fill="none" aria-hidden="true"><ellipse cx="500" cy="325" rx="460" ry="160" transform="rotate(-24 500 325)" /><circle cx="103" cy="493" r="5" /></svg>
      <button className="gravity-motion" onClick={toggle} disabled={reduced} aria-pressed={paused} aria-label={reduced ? "Azaltılmış hareket etkin" : paused ? "Hareketi başlat" : "Hareketi durdur"}>
        <span aria-hidden="true">{still ? "▷" : "Ⅱ"}</span><span>{reduced ? "Hareket azaltıldı" : paused ? "Devam et" : "Hareketi durdur"}</span>
      </button>
      <div className="gravity-footnote"><p>Herkes aynı düşünseydi,<br />burada olmazdık.</p><Link href="/basla">Burası nasıl bir yer? ↗</Link></div>
      <a className="gravity-scroll" href="#cabin-stage"><span>Aşağı in.<br /><strong>Bir taraf seç.</strong></span><span className="gravity-scroll-icon" aria-hidden="true">↓</span></a>
      <div className="gravity-bottom-note" aria-hidden="true"><span>KARAR SENİN.</span><span>BAŞKA BİR BAKIŞ MÜMKÜN.</span></div>
    </div>
  </section>;
}
export function SpaceHero() { return <><OriginalHero /><CabinHero /><OrbitalJourney /></>; }

"use client";
import { useEffect, useRef } from "react";

export function SpaceHero() {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => frame.current?.contentWindow?.postMessage({ type: "kararver-cabin-visibility", visible: entry.isIntersecting }, location.origin));
    if (frame.current) observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  return <section aria-label="Bir fikre kapıl: etkileşimli 3D kabin" style={{ height: "100svh", minHeight: 660, position: "relative", background: "#171a1b" }}>
    <iframe ref={frame} title="Yer çekimiyle etkileşimli 3D uzay kabini" src="/experiences/cabin/index.html?embed=1" style={{ width: "100%", height: "100%", border: 0, display: "block" }} />
    <a href="#discovery-stage" style={{ position: "absolute", bottom: 94, right: "4vw", color: "#e7f3a5", background: "#171e1bd9", padding: "10px 14px", fontSize: 12, textDecoration: "none", borderRadius: 3 }}>Keşfetmeye devam et ↓</a>
  </section>;
}

"use client";

import { useEffect, useState } from "react";

// Only show the introduction once per client-side visit, not on every return home.
let shown = false;

export function OpeningScreen() {
  const [mounted, setMounted] = useState(true);
  const [complete, setComplete] = useState(false);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (shown) {
      setMounted(false);
      return;
    }
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    let closing = false;
    let disposed = false;
    let imagesReady = false;
    let minimumPassed = false;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (closing || disposed) return;
      closing = true;
      clearInterval(checkImages);
      shown = true;
      setComplete(true);
      fadeTimer = setTimeout(() => {
        document.documentElement.style.overflow = previousOverflow;
        setMounted(false);
      }, 450);
    };
    const second = setTimeout(() => setStage(1), 1600);
    const third = setTimeout(() => setStage(2), 3200);
    const minimum = setTimeout(() => { minimumPassed = true; if (imagesReady) finish(); }, 4900);
    const checkImages = setInterval(() => {
      const images = Array.from(document.querySelectorAll<HTMLImageElement>(".gravity-hero img"));
      if (images.length < 2 || !images.every(image => image.complete)) return;
      clearInterval(checkImages);
      void Promise.allSettled(images.map(image => image.decode())).then(() => {
        imagesReady = true;
        if (minimumPassed) finish();
      });
    }, 80);
    const deadline = setTimeout(finish, 5900);
    return () => {
      disposed = true;
      document.documentElement.style.overflow = previousOverflow;
      clearInterval(checkImages);
      clearTimeout(second);
      clearTimeout(third);
      clearTimeout(minimum);
      clearTimeout(deadline);
      clearTimeout(fadeTimer);
    };
  }, []);

  if (!mounted) return null;
  const messages = ["Kararsız kalma, sen de bizimle", "Karar ver", "Her zaman yanındayız"];
  return <div className="opening-screen" data-stage={stage} data-complete={complete}>
    <div className="opening-screen__sky" aria-hidden="true" />
    <div className="opening-screen__orbit" aria-hidden="true"><div className="opening-screen__world" /></div>
    <div className="opening-screen__header" aria-hidden="true">kararver<span>.</span></div>
    <div className="opening-screen__content">
      <p key={stage} className="opening-screen__message" role="status" aria-live="polite">{messages[stage]}</p>
    </div>
    <div className="opening-screen__footer" aria-hidden="true"><span>0{stage + 1} / 03</span><div className="opening-screen__progress"><i data-active={stage >= 0} /><i data-active={stage >= 1} /><i data-active={stage >= 2} /></div><span>KARARVER</span></div>
  </div>;
}

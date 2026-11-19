"use client";

import { useEffect, useState } from "react";

// Only show the introduction once per client-side visit, not on every return home.
let shown = false;

export function OpeningScreen() {
  const [mounted, setMounted] = useState(true);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (shown) {
      setMounted(false);
      return;
    }
    const started = performance.now();
    let closing = false;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    let minimumTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (closing) return;
      closing = true;
      clearInterval(checkImages);
      minimumTimer = setTimeout(() => {
        shown = true;
        setComplete(true);
        fadeTimer = setTimeout(() => setMounted(false), 300);
      }, Math.max(0, 850 - (performance.now() - started)));
    };
    const checkImages = setInterval(() => {
      const images = Array.from(document.querySelectorAll<HTMLImageElement>(".gravity-hero img"));
      if (images.length < 2 || !images.every(image => image.complete)) return;
      clearInterval(checkImages);
      void Promise.allSettled(images.map(image => image.decode())).then(finish);
    }, 80);
    const deadline = setTimeout(finish, 1600);
    return () => {
      clearInterval(checkImages);
      clearTimeout(deadline);
      clearTimeout(minimumTimer);
      clearTimeout(fadeTimer);
    };
  }, []);

  if (!mounted) return null;
  return <div className="opening-screen" data-complete={complete} role="status" aria-live="polite">
    <div className="opening-screen__content">
      <span className="opening-screen__mark" aria-hidden="true">✳</span>
      <span className="opening-screen__brand">kararver<span>.</span></span>
      <span className="opening-screen__line" aria-hidden="true"><i /></span>
      <span className="opening-screen__caption">Fikirler yörüngeye giriyor</span>
    </div>
  </div>;
}

"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const MotionContext = createContext({ paused: false, reduced: false, toggle: () => {} });
export function SceneMotionProvider({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return <MotionContext.Provider value={{ paused, reduced, toggle: () => setPaused(value => !value) }}>{children}</MotionContext.Provider>;
}
export const useSceneMotion = () => useContext(MotionContext);

/** Scroll schedules one paint; React never renders per scroll frame. */
export function useScrollScene(kind: "orbit" | "reveal") {
  const ref = useRef<HTMLElement>(null);
  const { paused, reduced } = useSceneMotion();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    const still = paused || reduced;
    const paint = () => {
      frame = 0;
      const box = element.getBoundingClientRect();
      const raw = kind === "orbit" ? -box.top / Math.max(1, box.height - innerHeight) : (innerHeight - box.top) / (innerHeight + box.height * .2);
      const progress = still ? (kind === "reveal" ? 1 : 0) : Math.max(0, Math.min(1, raw));
      element.style.setProperty("--scene-progress", progress.toFixed(4));
      element.style.setProperty("--scene-opacity", Math.max(0, 1 - progress * 1.5).toFixed(4));
      element.style.setProperty("--pointer-x", still ? "0" : pointerX.toFixed(3));
      element.style.setProperty("--pointer-y", still ? "0" : pointerY.toFixed(3));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const point = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const box = element.getBoundingClientRect();
      pointerX = (event.clientX - box.left) / box.width - .5;
      pointerY = event.clientY / innerHeight - .5;
      schedule();
    };
    const leave = () => { pointerX = 0; pointerY = 0; schedule(); };
    paint();
    if (!still) {
      addEventListener("scroll", schedule, { passive: true });
      addEventListener("resize", schedule, { passive: true });
      element.addEventListener("pointermove", point, { passive: true });
      element.addEventListener("pointerleave", leave);
    }
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      element.removeEventListener("pointermove", point);
      element.removeEventListener("pointerleave", leave);
    };
  }, [kind, paused, reduced]);
  return { ref, still: paused || reduced };
}

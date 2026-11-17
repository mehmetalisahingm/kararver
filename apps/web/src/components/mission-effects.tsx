"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useSceneMotion } from "./scene-motion";

export type MissionKind = "landing" | "launch";
export type MissionPhase = "ready" | "approach" | "contact" | "landed" | "countdown-3" | "countdown-2" | "countdown-1" | "flight" | "orbit";
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const noise = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function sprite(stops: [number, string][]) {
  const image = document.createElement("canvas");
  image.width = image.height = 128;
  const ctx = image.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([position, color]) => gradient.addColorStop(position, color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return image;
}

/** Analytic particles are bounded, deterministic, and allocated once per scene. */
class PlumeRenderer {
  private hot = sprite([[0,"#fffef6"],[.18,"#fff5bce8"],[.42,"#ffb54090"],[1,"#e6470000"]]);
  private fire = sprite([[0,"#fff6ccf0"],[.28,"#ffb537c0"],[.62,"#d84d1b55"],[1,"#b52f0000"]]);
  private smoke = sprite([[0,"#c1b39bba"],[.3,"#a99b85a0"],[.7,"#82776455"],[1,"#514c4200"]]);
  private dust = sprite([[0,"#b8ad9599"],[.35,"#a59b845e"],[1,"#8b816c00"]]);
  private seeds = Array.from({length: 240}, (_, i) => noise(i + 1));

  draw(ctx: CanvasRenderingContext2D, kind: MissionKind, time: number, x: number, y: number, ground: number, width: number, actorWidth: number, thrust: number) {
    if (kind === "landing") { this.landing(ctx, time - 2.15, x, ground, actorWidth); return; }
    if (thrust < .001) return;
    const length = Math.min(470, width * .38) * (.35 + thrust * .65);
    // Soft reflected light, independent from the small, bright exhaust core.
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = thrust * .28;
    ctx.drawImage(this.fire, x - length * .65, y - length * .24, length * 1.3, length * 1.7);
    // Three white-hot jets merge into a turbulent amber plume.
    for (let jet = -1; jet <= 1; jet++) {
      const nozzle = x + jet * actorWidth * .13;
      const flame = ctx.createLinearGradient(nozzle, y, nozzle, y + length);
      flame.addColorStop(0, "#fffef5ed"); flame.addColorStop(.2, "#fff0a8db"); flame.addColorStop(.55, "#ff94116a"); flame.addColorStop(1, "#c3440000");
      ctx.globalAlpha = thrust * .85;
      ctx.fillStyle = flame;
      const spread = actorWidth * .085;
      ctx.beginPath();
      for (let edge = 0; edge < 2; edge++) for (let step = 0; step <= 20; step++) {
        const age = (edge ? 20 - step : step) / 20;
        const ripple = Math.sin(age * 28 - time * 26 + jet) * age * 5;
        const radius = spread * (.4 + age * 2.2) * (.9 + Math.sin(age * 19 + time * 20 + jet) * .12);
        const px = nozzle + Math.sin(age * 8 + time * 8 + jet) * age * 9 + ripple + (edge ? radius : -radius);
        if (!edge && !step) ctx.moveTo(px,y); else ctx.lineTo(px,y + age * length);
      }
      ctx.closePath(); ctx.fill();
    }
    for (let i = 0; i < 170; i++) {
      const seed = this.seeds[i];
      const age = (time * (1.7 + seed * 1.8) + seed * 17) % 1;
      const spread = actorWidth * (.12 + age * .24);
      const px = x + (this.seeds[(i + 47) % 240] - .5) * spread * 2 + Math.sin(time * 8 + i * 2.3) * age * 18;
      const py = y + age * length;
      const size = (12 + age * 58 + seed * 14) * Math.max(.4, thrust);
      ctx.globalAlpha = (1 - age) * thrust * (age < .3 ? .52 : .38);
      ctx.drawImage(age < .28 ? this.hot : this.fire, px - size / 2, py - size, size, size * 1.9);
    }
    // Ground-hugging regolith rolls outward, then remains behind as the vehicle climbs.
    ctx.globalCompositeOperation = "source-over";
    const groundForce = clamp(1 - (ground - y) / 470);
    for (let i = 0; i < 95; i++) {
      const seed = this.seeds[i + 100];
      const age = (time * (.12 + seed * .13) + seed * 3) % 1;
      const side = i % 2 ? 1 : -1;
      const travel = Math.pow(age, .8) * width * .48;
      const px = x + side * (15 + travel);
      const py = ground - age * (20 + seed * 70) + Math.sin(age * 7 + seed) * 8;
      const size = 30 + age * 170 + seed * 40;
      ctx.globalAlpha = Math.pow(1 - age, 1.4) * thrust * Math.max(.2, groundForce) * .65;
      ctx.drawImage(this.smoke, px - size, py - size * .5, size * 2, size * .9);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private landing(ctx: CanvasRenderingContext2D, age: number, x: number, y: number, actorWidth: number) {
    if (age < 0 || age > 4.8) return;
    const fade = Math.pow(1 - age / 4.8, 1.6);
    const rise = smooth(age * 6);
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < 170; i++) {
      const seed = this.seeds[i];
      const side = i % 2 ? 1 : -1;
      const speed = 18 + seed * 85;
      const px = x + side * (actorWidth * .18 + speed * age);
      const py = Math.min(y + 5, y - (8 + this.seeds[(i + 71) % 240] * 25) * age + 5 * age * age);
      const size = 10 + seed * 20 + age * 10;
      ctx.globalAlpha = fade * rise * .3;
      ctx.drawImage(this.dust, px - size, py - size * .35, size * 2, size * .7);
    }
    ctx.strokeStyle = "#c8b793";
    ctx.globalAlpha = fade * .18;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y, actorWidth * .22 + age * 85, 3 + age * 8, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export function MissionEffects({ kind, run, viewport, actor, onPhase }: {
  kind: MissionKind;
  run: number;
  viewport: RefObject<HTMLDivElement | null>;
  actor: RefObject<HTMLDivElement | null>;
  onPhase: (phase: MissionPhase) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef(0);
  const previousRun = useRef(run);
  const { paused, reduced } = useSceneMotion();
  useEffect(() => {
    const surface = canvas.current;
    const stage = viewport.current;
    const vehicle = actor.current;
    const ctx = surface?.getContext("2d", { alpha: true });
    if (!surface || !stage || !vehicle || !ctx) return;
    if (previousRun.current !== run) { elapsed.current = 0; previousRun.current = run; }
    const renderer = new PlumeRenderer();
    let frame = 0;
    let visible = false;
    let last = 0;
    let nextPaint = 0;
    let phase: MissionPhase | undefined;
    let width = 0;
    let height = 0;
    let scale = 1;
    const still = paused || reduced;
    const resize = () => {
      const box = stage.getBoundingClientRect();
      width = box.width; height = box.height;
      scale = Math.min(devicePixelRatio || 1, 1.25) * .8;
      surface.width = Math.round(width * scale); surface.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    const paint = (now: number) => {
      frame = 0;
      if (!width || !height) return;
      if (!nextPaint || now - nextPaint > 100) nextPaint = now;
      if (!still && last && now < nextPaint) { frame = requestAnimationFrame(paint); return; }
      nextPaint += 1000 / 60;
      if (run && !still && visible && last) elapsed.current += Math.min(50, now - last);
      last = now;
      const t = elapsed.current / 1000;
      let thrust = 0;
      let next: MissionPhase;
      if (kind === "landing") {
        const approach = reduced ? 1 : smooth(t / 2.15);
        const bounce = t > 2.15 && t < 2.7 ? -Math.sin((t - 2.15) / .55 * Math.PI) * 5 : 0;
        stage.style.setProperty("--flight-y", ((1 - approach) * -110 + bounce) + "px");
        stage.style.setProperty("--actor-turn", ((1 - approach) * -5) + "deg");
        stage.style.setProperty("--contact", String(approach));
        next = reduced ? "landed" : approach < 1 ? "approach" : t < 3 ? "contact" : "landed";
      } else {
        const climb = run && !reduced ? clamp((t - 3) / 6) : 0;
        const travel = Math.pow(climb, 1.65) * height * 1.5;
        thrust = run && !reduced ? smooth((t - .4) / 1.6) * (1 - smooth((t - 8.5) / 1.3)) : 0;
        stage.style.setProperty("--flight-y", -travel + "px");
        stage.style.setProperty("--actor-turn", (climb * -3) + "deg");
        stage.style.setProperty("--thrust", thrust.toFixed(3));
        next = !run || reduced ? "ready" : t < 1 ? "countdown-3" : t < 2 ? "countdown-2" : t < 3 ? "countdown-1" : t < 9 ? "flight" : "orbit";
      }
      if (phase !== next) { phase = next; onPhase(next); }
      const stageBox = stage.getBoundingClientRect();
      const actorBox = vehicle.getBoundingClientRect();
      const x = actorBox.left - stageBox.left + actorBox.width / 2;
      const y = actorBox.bottom - stageBox.top - actorBox.height * (kind === "landing" ? .035 : .024);
      ctx.clearRect(0, 0, width, height);
      if (!reduced) renderer.draw(ctx, kind, t, x, y, height * .85, width, actorBox.width, thrust);
      if (!still && visible && run && t < (kind === "landing" ? 7.1 : 10)) frame = requestAnimationFrame(paint);
    };
    const restart = () => {
      cancelAnimationFrame(frame); frame = 0; last = 0; nextPaint = 0;
      if (visible && document.visibilityState === "visible") frame = requestAnimationFrame(paint);
    };
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; restart(); }, { threshold: .01 });
    resize(); paint(performance.now());
    observer.observe(stage);
    const onResize = () => { resize(); restart(); };
    addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", restart);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); removeEventListener("resize", onResize); document.removeEventListener("visibilitychange", restart); };
  }, [kind, run, paused, reduced, viewport, actor, onPhase]);
  return <canvas className="mission-effects" ref={canvas} aria-hidden="true" />;
}

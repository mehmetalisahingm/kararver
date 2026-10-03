"use client";

import { useEffect } from "react";

const KEY = "kv.share.attribution";
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ShareAttribution = { shareId: string; capturedAt: string };

export function readShareAttribution(): ShareAttribution | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ShareAttribution>;
    const time = typeof value.capturedAt === "string" ? Date.parse(value.capturedAt) : Number.NaN;
    if (typeof value.shareId !== "string" || !UUID.test(value.shareId) || !Number.isFinite(time) || Date.now() - time > WINDOW_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return { shareId: value.shareId, capturedAt: value.capturedAt! };
  } catch {
    window.localStorage.removeItem(KEY);
    return null;
  }
}

export function SourceAttribution() {
  useEffect(() => {
    const current = readShareAttribution();
    if (current) return;
    const shareId = new URLSearchParams(window.location.search).get("src");
    if (!shareId || !UUID.test(shareId)) return;
    const value: ShareAttribution = { shareId, capturedAt: new Date().toISOString() };
    window.localStorage.setItem(KEY, JSON.stringify(value));
  }, []);
  return null;
}

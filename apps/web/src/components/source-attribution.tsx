"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { captureShareAttribution } from "../lib/share-attribution";
import { PRIVACY_PREFERENCE_EVENT, PRIVACY_PREFERENCE_KEY } from "../lib/privacy-preferences";

export { readShareAttribution, type ShareAttribution } from "../lib/share-attribution";

export function SourceAttribution() {
  const searchParams = useSearchParams();
  useEffect(() => {
    const capture = () => captureShareAttribution(new URLSearchParams(window.location.search).get("src"));
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === PRIVACY_PREFERENCE_KEY) capture();
    };
    capture();
    window.addEventListener(PRIVACY_PREFERENCE_EVENT, capture);
    window.addEventListener("storage", storageChanged);
    window.addEventListener("focus", capture);
    return () => {
      window.removeEventListener(PRIVACY_PREFERENCE_EVENT, capture);
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("focus", capture);
    };
  }, [searchParams]);
  return null;
}

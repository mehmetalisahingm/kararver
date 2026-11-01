"use client";

import { useEffect, useRef, useState } from "react";
import {
  PRIVACY_PREFERENCE_EVENT, PRIVACY_PREFERENCE_KEY, PREFERENCE_LIFETIME_MS,
  readPrivacyPreference, savePrivacyPreference, type PrivacyPreference,
} from "../lib/privacy-preferences";

export function PrivacyPreferences() {
  const [ready, setReady] = useState(false);
  const [preference, setPreference] = useState<PrivacyPreference | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [measurement, setMeasurement] = useState(false);
  const [message, setMessage] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const sync = () => {
      const saved = readPrivacyPreference();
      setPreference(saved);
      setMeasurement(saved?.measurement ?? false);
      setReady(true);
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === PRIVACY_PREFERENCE_KEY) sync();
    };
    sync();
    window.addEventListener("storage", storageChanged);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("focus", sync);
    };
  }, []);

  useEffect(() => {
    if (!preference) return;
    const remaining = Date.parse(preference.updatedAt) + PREFERENCE_LIFETIME_MS - Date.now();
    const timer = window.setTimeout(() => {
      const saved = readPrivacyPreference();
      setPreference(saved);
      if (!saved) {
        setMeasurement(false);
        setMessage("Ölçüm tercihinin süresi doldu. Yeniden izin vermedikçe isteğe bağlı ölçüm kapalı.");
        window.dispatchEvent(new Event(PRIVACY_PREFERENCE_EVENT));
      }
    }, Math.max(0, Math.min(remaining, 2_147_483_647)));
    return () => window.clearTimeout(timer);
  }, [preference]);

  function save(allowed: boolean) {
    const persisted = savePrivacyPreference(allowed);
    setPreference(readPrivacyPreference());
    setMeasurement(persisted && allowed);
    setMessage(persisted ? (allowed ? "İsteğe bağlı kaynak ölçümü açık." : "İsteğe bağlı kaynak ölçümü kapalı; bu tarayıcıdaki kaynak kaydı temizlendi.")
      : "Tercih kaydedilemedi; ölçüm bu sayfada kapalı. Eski izni kalıcı olarak kaldırmak için tarayıcının site verilerini temizleyebilirsin.");
    window.dispatchEvent(new Event(PRIVACY_PREFERENCE_EVENT));
    setExpanded(false);
    setCustomizing(false);
    trigger.current?.focus();
  }

  return (
    <section className="privacy-preferences" aria-label="Çerez ve depolama tercihleri">
      <div className="privacy-preferences__bar">
        <button type="button" ref={trigger} disabled={!ready} aria-expanded={expanded} aria-controls={expanded ? "privacy-choices" : undefined}
          onClick={() => {
            setExpanded(open => !open);
            if (!expanded) requestAnimationFrame(() => heading.current?.focus());
          }}>Çerez ve depolama tercihleri</button>
        <span role="status">{message}</span>
      </div>
      {expanded ? <div id="privacy-choices" className="privacy-preferences__choices">
        <h2 ref={heading} tabIndex={-1}>Depolama seçimi sana ait</h2>
        <p>Oturum ve güvenlik işlevleri ile seçtiğin tema ve devam eden form tercihleri ayrı çalışır.
          İsteğe bağlı kaynak ölçümü, geldiğin paylaşım bağlantısının kimliğini ve geliş zamanını en fazla 30 gün bu tarayıcıda tutar.
          Seçim yapmadan bu ölçüm başlamaz; reddetmek siteyi kullanmanı engellemez.</p>
        <p>Seçimin 30 gün hatırlanır. Bu bölümden istediğin zaman değiştirebilir veya iznini geri çekebilirsin.</p>
        {customizing ? <div className="privacy-preferences__category">
          <label><input type="checkbox" checked={measurement} onChange={event => setMeasurement(event.target.checked)} />
            İsteğe bağlı kaynak ölçümü</label>
          <p>Paylaşım kimliği ve geliş zamanı. Reddetmek veya geri çekmek bu tarayıcıdaki eski kaynak kaydını temizler.</p>
        </div> : null}
        <div className="privacy-preferences__actions">
          <button type="button" onClick={() => save(false)}>Reddet</button>
          <button type="button" onClick={() => save(true)}>Kabul et</button>
          {customizing ? <button type="button" onClick={() => save(measurement)}>Seçimi kaydet</button>
            : <button type="button" onClick={() => setCustomizing(true)}>Özelleştir</button>}
          {preference ? <button type="button" onClick={() => save(false)}>İzni geri çek</button> : null}
        </div>
      </div> : null}
    </section>
  );
}

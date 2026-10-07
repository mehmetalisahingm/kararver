"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorMessage, Loading } from "../../components/fields";
import { useProduct } from "../../components/product-provider";
import { UiError } from "../../lib/model.ts";
import {
  notificationCopy,
  notificationHref,
  notificationTypeLabels,
  optionalPreferenceTypes,
  pollIdOf,
} from "./notification-client.ts";
import type { NotificationItem, NotificationPage } from "./notification-client.ts";
import type { NotificationType } from "@kararver/contracts";

function messageOf(error: unknown) {
  return error instanceof UiError ? error.message : "Beklenmeyen bir hata oluştu. Tekrar deneyebilirsin.";
}

function announceChanged() {
  window.dispatchEvent(new Event("kv:notifications-changed"));
}

function optionalServiceUnavailable(error: unknown) {
  return error instanceof UiError && (error.code === "ENDPOINT_UNAVAILABLE" || error.code === "NOT_FOUND");
}

function mergeNotifications(previous: NotificationItem[], incoming: NotificationItem[]) {
  const seen = new Set(previous.map((item) => item.id));
  return [...previous, ...incoming.filter((item) => !seen.has(item.id))];
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(new Date(value));
}

function PreferencesPanel({ onAvailabilityChange }: { onAvailabilityChange: (available: boolean) => void }) {
  const { client } = useProduct();
  const api = client.notifications;
  const [preferences, setPreferences] = useState<Partial<Record<NotificationType, boolean>> | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">(api ? "loading" : "unavailable");
  const [busy, setBusy] = useState<NotificationType | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!api) return;
    let active = true;
    setState("loading");
    api.preferences()
      .then((value) => {
        if (!active) return;
        setPreferences(value.types);
        setState("ready");
        onAvailabilityChange(true);
      })
      .catch((cause) => {
        if (!active) return;
        if (optionalServiceUnavailable(cause)) {
          setState("unavailable");
          onAvailabilityChange(false);
        } else {
          setError(messageOf(cause));
          setState("error");
        }
      });
    return () => { active = false; };
  }, [api, onAvailabilityChange]);

  if (state === "loading") return <div className="kv-card kv-state"><p role="status">Bildirim tercihleri yükleniyor…</p></div>;
  if (state === "unavailable") {
    return (
      <section className="kv-card kv-stack" aria-labelledby="notification-preferences">
        <h2 id="notification-preferences">Bildirim tercihleri</h2>
        <p className="kv-muted">Tercih ve sessize alma hizmeti bu ortamda henüz kullanıma açılmadı. Bildirim merkezi kullanılmaya devam edebilir.</p>
      </section>
    );
  }
  if (state === "error" || !api || !preferences) {
    return (
      <section className="kv-card kv-stack" aria-labelledby="notification-preferences">
        <h2 id="notification-preferences">Bildirim tercihleri</h2>
        <ErrorMessage message={error || "Bildirim tercihleri yüklenemedi."} />
      </section>
    );
  }

  async function toggle(type: NotificationType, enabled: boolean) {
    setBusy(type);
    setError("");
    try {
      const next = await api!.updatePreferences({ [type]: enabled });
      setPreferences(next.types);
    } catch (cause) {
      if (optionalServiceUnavailable(cause)) {
        setState("unavailable");
        onAvailabilityChange(false);
      } else {
        setError(messageOf(cause));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="kv-card kv-stack" aria-labelledby="notification-preferences">
      <div>
        <h2 id="notification-preferences">Bildirim tercihleri</h2>
        <p className="kv-muted">Hangi isteğe bağlı bildirimleri görmek istediğini seç.</p>
      </div>
      <ErrorMessage message={error} />
      <div className="notification-preferences">
        {optionalPreferenceTypes.map((type) => {
          const checked = preferences[type] ?? true;
          return (
            <label key={type} className="notification-preference">
              <span>{notificationTypeLabels[type]}</span>
              <input
                type="checkbox"
                checked={checked}
                disabled={busy === type}
                onChange={(event) => void toggle(type, event.currentTarget.checked)}
              />
            </label>
          );
        })}
      </div>
      <p className="kv-help">Moderasyon ve hesap güvenliği bildirimleri kapatılamaz.</p>
    </section>
  );
}

export function NotificationsScreen() {
  const { client, user } = useProduct();
  const api = client.notifications;
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(api && user));
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mutedPolls, setMutedPolls] = useState<Set<string>>(() => new Set());
  const [preferencesAvailable, setPreferencesAvailable] = useState(false);
  const [targetNotice, setTargetNotice] = useState("");
  const [attempt, retry] = useState(0);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async (cursor: string | undefined, signal: AbortSignal): Promise<NotificationPage> => {
    return api!.list(unreadOnly, cursor, signal);
  }, [api, unreadOnly]);

  useEffect(() => {
    controller.current?.abort();
    if (!api || !user) {
      setLoading(false);
      setItems([]);
      setNext(null);
      return;
    }
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError("");
    load(undefined, current.signal)
      .then((page) => {
        if (current.signal.aborted) return;
        setItems(page.items);
        setNext(page.next);
      })
      .catch((cause) => {
        if (current.signal.aborted) return;
        setItems([]);
        setNext(null);
        setError(messageOf(cause));
      })
      .finally(() => {
        if (!current.signal.aborted) setLoading(false);
      });
    return () => current.abort();
  }, [api, user?.id, unreadOnly, attempt, load]);

  if (!api) {
    return (
      <section className="kv-card kv-state">
        <span className="eyebrow">BİLDİRİMLER</span>
        <h1>Bildirimler</h1>
        <p className="kv-muted">Bildirim merkezi demo veri kipinde gösterilmez; gerçek API ile açılır.</p>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="kv-card kv-state">
        <span className="eyebrow">BİLDİRİMLER</span>
        <h1>Bildirimlerini görmek için giriş yap.</h1>
        <p className="kv-muted">Yorumlar, cevaplar, takip ettiğin sonuçlar ve hesap bildirimleri burada toplanır.</p>
        <Link className="kv-button" href="/giris?returnTo=%2Fbildirimler">Giriş yap</Link>
      </section>
    );
  }

  async function markAll() {
    setBusyId("all");
    setError("");
    try {
      await api!.markRead({ all: true });
      const readAt = new Date().toISOString();
      setItems((previous) => unreadOnly ? [] : previous.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
      announceChanged();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function openNotification(notification: NotificationItem) {
    setBusyId(notification.id);
    setError("");
    setTargetNotice("");
    try {
      const pollId = pollIdOf(notification);
      if (pollId) {
        try {
          await client.get(pollId);
        } catch (cause) {
          if (!optionalServiceUnavailable(cause)) throw cause;
          if (!notification.readAt) {
            await api!.markRead({ ids: [notification.id] });
            const readAt = new Date().toISOString();
            setItems((previous) => previous.map((item) => item.id === notification.id ? { ...item, readAt } : item));
            announceChanged();
          }
          setTargetNotice("Bu bildirimin bağlı olduğu içerik artık erişilebilir değil. Kaldırılmış veya görünürlüğü değişmiş olabilir.");
          setBusyId(null);
          return;
        }
      }
      if (!notification.readAt) {
        await api!.markRead({ ids: [notification.id] });
        const readAt = new Date().toISOString();
        setItems((previous) => previous.map((item) => item.id === notification.id ? { ...item, readAt } : item));
        announceChanged();
      }
      router.push(notificationHref(notification));
    } catch (cause) {
      setError(messageOf(cause));
      setBusyId(null);
    }
  }

  async function toggleMute(notification: NotificationItem) {
    const pollId = pollIdOf(notification);
    if (!pollId) return;
    const muted = mutedPolls.has(pollId);
    setBusyId(`mute:${notification.id}`);
    setError("");
    try {
      const next = await api!.setPollMuted(pollId, !muted);
      setMutedPolls((previous) => {
        const copy = new Set(previous);
        if (next) copy.add(pollId); else copy.delete(pollId);
        return copy;
      });
    } catch (cause) {
      if (optionalServiceUnavailable(cause)) {
        setPreferencesAvailable(false);
        setError("Sessize alma hizmeti bu ortamda henüz kullanıma açılmadı.");
      } else {
        setError(messageOf(cause));
      }
    } finally {
      setBusyId(null);
    }
  }

  function loadMore() {
    if (!next || more) return;
    const signal = controller.current?.signal ?? new AbortController().signal;
    setMore(true);
    load(next, signal)
      .then((page) => {
        if (signal.aborted) return;
        setItems((previous) => mergeNotifications(previous, page.items));
        setNext(page.next);
      })
      .catch((cause) => {
        if (!signal.aborted) setError(messageOf(cause));
      })
      .finally(() => setMore(false));
  }

  return (
    <div className="screen-stack">
      <section className="notification-heading">
        <div>
          <span className="eyebrow">BİLDİRİMLER</span>
          <h1>Bildirim merkezi</h1>
          <p className="kv-muted">Yorum, cevap, sonuç, karar ve hesap hareketlerini tek yerde takip et.</p>
        </div>
        <button className="kv-button kv-button--secondary" onClick={() => void markAll()} disabled={busyId === "all" || items.every((item) => item.readAt)}>
          {busyId === "all" ? "İşleniyor…" : "Tümünü okundu yap"}
        </button>
      </section>

      <div className="notification-filters" role="group" aria-label="Bildirim filtresi">
        <button className={unreadOnly ? "kv-button kv-button--ghost" : "kv-button"} aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>Tümü</button>
        <button className={unreadOnly ? "kv-button" : "kv-button kv-button--ghost"} aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Okunmamış</button>
      </div>

      <ErrorMessage message={error} />
      {targetNotice ? (
        <section className="kv-card kv-state" role="status">
          <h2>Bildirim hedefi artık erişilebilir değil.</h2>
          <p className="kv-muted">{targetNotice}</p>
          <Link href="/">Akışa dön</Link>
        </section>
      ) : null}
      {loading ? <Loading label="Bildirimler yükleniyor…" /> : null}
      {!loading && error ? <button className="kv-button kv-button--secondary" onClick={() => retry((n) => n + 1)}>Tekrar dene</button> : null}
      {!loading && !error && items.length === 0 ? (
        <section className="kv-card kv-state">
          <h2>{unreadOnly ? "Okunmamış bildirimin yok." : "Henüz bildirimin yok."}</h2>
          <p className="kv-muted">Yeni hareketler olduğunda burada görünecek.</p>
        </section>
      ) : null}

      <div className="notification-list" aria-live="polite">
        {items.map((notification) => {
          const copy = notificationCopy(notification);
          const pollId = pollIdOf(notification);
          const muted = pollId ? mutedPolls.has(pollId) : false;
          return (
            <article key={notification.id} className={notification.readAt ? "kv-card notification-item" : "kv-card notification-item notification-item--unread"}>
              <button className="notification-open" onClick={() => void openNotification(notification)} disabled={busyId === notification.id}>
                <span className="notification-dot" aria-hidden="true" />
                <span>
                  <strong>{copy.title}</strong>
                  <small>{copy.detail}</small>
                  <time dateTime={notification.createdAt}>{dateLabel(notification.createdAt)}</time>
                </span>
                <span aria-hidden="true">›</span>
              </button>
              {pollId && preferencesAvailable ? (
                <button className="kv-button kv-button--ghost notification-mute" onClick={() => void toggleMute(notification)} disabled={busyId === `mute:${notification.id}`}>
                  {busyId === `mute:${notification.id}` ? "İşleniyor…" : muted ? "Sessizi kaldır" : "Bu anketi sessize al"}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>

      {next ? <button className="kv-button kv-button--secondary" onClick={loadMore} disabled={more}>{more ? "Yükleniyor…" : "Daha fazla göster"}</button> : null}
      <PreferencesPanel onAvailabilityChange={setPreferencesAvailable} />
    </div>
  );
}

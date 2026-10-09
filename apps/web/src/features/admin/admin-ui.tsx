"use client";

// Yönetim panellerinin ortak parçaları: sayfalı liste yükleme, gerekçeli işlem penceresi, durum bildirimi.
// Ekran durumları (yükleniyor, boş, hata + tekrar dene, işlem sürüyor) her panelde aynıdır.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { UiError } from "../../lib/model.ts";
import type { Page } from "./admin-client.ts";
import styles from "./admin-shell.module.css";
import type { AdminRole } from "./admin-model";

// ── Roller ──────────────────────────────────────────────────

/** Menü ve düğme gizleme içindir; yetkiyi sunucu verir (RBAC). */
export const AdminRolesContext = createContext<readonly AdminRole[]>([]);
export const useAdminRoles = () => useContext(AdminRolesContext);
export const isAdminRole = (roles: readonly AdminRole[]) => roles.includes("ADMIN") || roles.includes("SUPER_ADMIN");

// ── Biçim ───────────────────────────────────────────────────

export const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }) : "—");
export const shortId = (id: string) => `${id.slice(0, 8)}…`;

export const reasonLabels: Record<string, string> = {
  SPAM: "Spam",
  INAPPROPRIATE: "Uygunsuz içerik",
  HARASSMENT: "Taciz",
  HATE: "Nefret söylemi",
  PERSONAL_INFO: "Kişisel bilgi",
  MISLEADING: "Yanıltıcı",
  COPYRIGHT: "Telif",
  OTHER: "Diğer",
};
export const targetLabels: Record<string, string> = { POLL: "Anket", COMMENT: "Yorum", MEDIA: "Görsel", USER: "Kullanıcı" };

export function errorMessage(error: unknown): string {
  if (error instanceof UiError) {
    if (error.code === "FORBIDDEN") return "Bu işlem için yetkin yok.";
    if (error.code === "UNAUTHENTICATED") return "Oturumun sona ermiş. Tekrar giriş yap.";
    return error.message;
  }
  return "Beklenmeyen bir hata oluştu. Tekrar deneyebilirsin.";
}

// ── Sayfalı uzak liste ──────────────────────────────────────

export type Remote<T> = {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  reload: () => void;
  loadMore: () => void;
};

/**
 * `load` her değiştiğinde (filtre değişimi) liste baştan yüklenir; eski isteğin cevabı yeni filtreye karışmaz
 * (AbortController). `reload` işlemden sonra listeyi yeniler.
 */
export function useRemoteList<T>(load: (cursor: string | undefined, signal: AbortSignal) => Promise<Page<T>>): Remote<T> {
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError("");
    load(undefined, current.signal)
      .then((result) => {
        if (current.signal.aborted) return;
        setItems(result.items);
        setNext(result.next);
      })
      .catch((cause) => {
        if (current.signal.aborted) return;
        setItems([]);
        setNext(null);
        setError(errorMessage(cause));
      })
      .finally(() => {
        if (!current.signal.aborted) setLoading(false);
      });
    return () => current.abort();
  }, [load, attempt]);

  const loadMore = useCallback(() => {
    if (!next || loadingMore) return;
    const signal = controller.current?.signal ?? new AbortController().signal;
    setLoadingMore(true);
    setError("");
    load(next, signal)
      .then((result) => {
        if (signal.aborted) return;
        setItems((previous) => [...previous, ...result.items]);
        setNext(result.next);
      })
      .catch((cause) => {
        if (!signal.aborted) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!signal.aborted) setLoadingMore(false);
      });
  }, [load, next, loadingMore]);

  return { items, loading, loadingMore, error, hasMore: next !== null, reload: () => setAttempt((n) => n + 1), loadMore };
}

/** Listenin altındaki ortak durum satırı: yükleniyor / hata / boş / daha fazla. */
export function ListState<T>({ remote, empty }: { remote: Remote<T>; empty: string }) {
  if (remote.loading) return <p className="kv-muted" role="status" aria-busy="true">Yükleniyor…</p>;
  return (
    <>
      {remote.error ? (
        <div role="alert" className={styles.inlineError}>
          <span>{remote.error}</span>
          <button className="kv-button kv-button--secondary" onClick={remote.reload}>Tekrar dene</button>
        </div>
      ) : null}
      {!remote.error && remote.items.length === 0 ? <p className="kv-muted">{empty}</p> : null}
      {remote.hasMore ? (
        <button className="kv-button kv-button--secondary" onClick={remote.loadMore} disabled={remote.loadingMore}>
          {remote.loadingMore ? "Yükleniyor…" : "Daha fazla göster"}
        </button>
      ) : null}
    </>
  );
}

// ── Bildirim ────────────────────────────────────────────────

export function useNotice() {
  const [notice, setNotice] = useState("");
  const element = <p className={styles.notice} role="status" aria-live="polite">{notice}</p>;
  return { notice, setNotice, element };
}

// ── Gerekçeli işlem penceresi ───────────────────────────────

export type ActionDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  submitLabel: string;
  /** Gerekçe alanı: yönetim işlemleri gerekçe ister (min 3 karakter, sözleşme). */
  reasonLabel?: string | null;
  onClose: () => void;
  /** Hata fırlatırsa pencere açık kalır ve mesaj gösterilir. */
  onSubmit: (reason: string) => Promise<void>;
  children?: ReactNode;
  /** Ek alanların doğrulaması; mesaj döner ya da null. */
  validate?: () => string | null;
};

export function ActionDialog({ open, title, description, submitLabel, reasonLabel = "Gerekçe", onClose, onSubmit, children, validate }: ActionDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setReason("");
      setError("");
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = reason.trim();
    if (reasonLabel !== null && text.length < 3) return setError("Gerekçe en az 3 karakter olmalı.");
    const invalid = validate?.() ?? null;
    if (invalid) return setError(invalid);
    setBusy(true);
    setError("");
    try {
      await onSubmit(text);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form className={styles.dialogBody} onSubmit={submit}>
        <h2 id={titleId}>{title}</h2>
        {description ? <p className="kv-muted">{description}</p> : null}
        {children}
        {reasonLabel !== null ? (
          <label>
            {reasonLabel}
            <textarea className="kv-input" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required />
          </label>
        ) : null}
        {error ? <p role="alert" className={styles.formError}>{error}</p> : null}
        <div className={styles.dialogActions}>
          <button type="button" className="kv-button kv-button--secondary" onClick={onClose} disabled={busy}>Vazgeç</button>
          <button type="submit" className="kv-button" disabled={busy}>{busy ? "İşleniyor…" : submitLabel}</button>
        </div>
      </form>
    </dialog>
  );
}

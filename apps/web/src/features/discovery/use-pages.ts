"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { UiError } from "../../lib/model";
import type { Page } from "./model";

export function usePages<T, P extends Page<T>>(
  loader: (cursor: string | undefined, signal: AbortSignal) => Promise<P>,
) {
  const [result, setResult] = useState<P | null>(null);
  const [error, setError] = useState<{
    message: string;
    invalidCursor: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const fetchPage = useCallback(
    async (cursor?: string) => {
      if (locked.current) return;
      locked.current = true;
      const current = new AbortController();
      controller.current = current;
      setBusy(true);
      setError(null);
      try {
        const next = await loader(cursor, current.signal);
        if (!current.signal.aborted)
          setResult((old) => ({
            ...next,
            data: cursor && old ? [...old.data, ...next.data] : next.data,
          }));
      } catch (e) {
        if (!current.signal.aborted)
          setError({
            message: (e as Error).message,
            invalidCursor: e instanceof UiError && e.code === "INVALID_CURSOR",
          });
      } finally {
        if (!current.signal.aborted) {
          locked.current = false;
          setBusy(false);
        }
      }
    },
    [loader],
  );
  useEffect(() => {
    setResult(null);
    locked.current = false;
    void fetchPage();
    return () => {
      controller.current?.abort();
      locked.current = false;
    };
  }, [fetchPage, attempt]);
  return {
    result,
    error,
    busy,
    refresh: () => setAttempt((n) => n + 1),
    more: () => void fetchPage(result?.page.nextCursor || undefined),
  };
}

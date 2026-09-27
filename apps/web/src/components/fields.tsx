import type { ReactNode } from "react";
export function Field({
  id,
  label,
  error,
  help,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="kv-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {help && (
        <span id={`${id}-help`} className="kv-help">
          {help}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="kv-field-error">
          {error}
        </span>
      )}
    </div>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p className="error-message" role="alert">
      {message}
    </p>
  ) : null;
}
export function Loading({ label = "Yükleniyor…" }: { label?: string }) {
  return (
    <div className="kv-card kv-stack" aria-busy="true">
      <p role="status">{label}</p>
      <span className="kv-skeleton kv-skeleton--title" aria-hidden="true" />
      <span className="kv-skeleton kv-skeleton--option" aria-hidden="true" />
    </div>
  );
}

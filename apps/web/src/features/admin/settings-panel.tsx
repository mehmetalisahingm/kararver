"use client";

// Sistem ayarları ve acil durum anahtarları (KV-40, #42). ADMIN okur, yalnız SUPER_ADMIN değiştirir (sunucu 403 verir;
// düğmeler yalnız gizlenir). Her değişiklik gerekçe ister ve audit'e yazılır. Değişiklik bu API sürecinde anında, diğer
// süreçlerde ve worker'da en geç ~5 sn sonra, public config'i okuyan istemcilerde en geç ~35 sn sonra etkilidir.
import { useCallback, useEffect, useState } from "react";
import { AdminClient } from "./admin-client.ts";
import type { EmergencyState, SettingView } from "./admin-client.ts";
import {
  definitionOf,
  emergencySwitches,
  formatValue,
  groupSettings,
  isRisky,
  labelOf,
  parseInput,
  rangeOf,
  sameValue,
  type EmergencyName,
} from "./settings-model.ts";
import { ActionDialog, errorMessage, formatDate, useAdminRoles, useNotice } from "./admin-ui";
import { UiError } from "../../lib/model.ts";
import styles from "./admin-shell.module.css";

type Draft = string | boolean | string[];

export function SettingsPanel({ admin }: { admin: AdminClient }) {
  const canEdit = useAdminRoles().includes("SUPER_ADMIN");
  const [items, setItems] = useState<SettingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<SettingView | null>(null);
  const [draft, setDraft] = useState<Draft>("");
  const [switching, setSwitching] = useState<EmergencyName | null>(null);
  const { setNotice, element } = useNotice();
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    admin
      .settings(controller.signal)
      .then((list) => !controller.signal.aborted && setItems(list))
      .catch((cause) => !controller.signal.aborted && setError(errorMessage(cause)))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [admin, attempt]);

  const valueOf = (key: string) => items.find((item) => item.key === key)?.value;
  const stateOf = (name: EmergencyName, key: string) => valueOf(key) === true;

  function startEdit(item: SettingView) {
    setDraft(typeof item.value === "boolean" ? item.value : Array.isArray(item.value) ? [...(item.value as string[])] : String(item.value));
    setEditing(item);
  }

  const allowedTypes = (() => {
    const d = definitionOf("media.allowedTypes");
    return d && d.default ? [...(d.default.value as readonly string[])] : [];
  })();

  if (loading && items.length === 0) return <p className="kv-muted" role="status" aria-busy="true">Yükleniyor…</p>;
  if (error && items.length === 0) {
    return (
      <div role="alert" className={styles.inlineError}>
        <span>{error}</span>
        <button className="kv-button kv-button--secondary" onClick={reload}>Tekrar dene</button>
      </div>
    );
  }

  const groups = groupSettings(items);
  const switchTarget = emergencySwitches.find((s) => s.name === switching);
  const parsed = editing ? parseInput(editing.key, editing.value, draft) : null;

  return (
    <>
      {element}
      {!canEdit ? <p className="kv-muted">Ayarları yalnız SUPER_ADMIN değiştirebilir; bu ekran salt okunurdur.</p> : null}

      <section aria-labelledby="emergency-title">
        <h2 id="emergency-title">Acil durum anahtarları</h2>
        <p className="kv-muted">
          Anahtarlar her istekte okunur: kapatılan özellik açık oturumlarda da yeni işlemi hemen engeller. Birden çok API sürecinde
          en geç birkaç saniye, public config'i önbellekten okuyan istemcilerde en geç yarım dakika sürebilir.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="sr-only">Acil durum anahtarları</caption>
            <thead>
              <tr><th scope="col">Anahtar</th><th scope="col">Durum</th><th scope="col">Etkisi</th><th scope="col">İşlem</th></tr>
            </thead>
            <tbody>
              {emergencySwitches.map((s) => {
                const on = stateOf(s.name, s.key);
                const risky = isRisky(s.name, on);
                return (
                  <tr key={s.name}>
                    <th scope="row">{s.label}</th>
                    <td>
                      <strong>{on ? "Açık" : "Kapalı"}</strong>
                      {risky ? <><br /><small className="kv-muted">{s.name === "maintenance" ? "Bakım sürüyor" : "Özellik devre dışı"}</small></> : null}
                    </td>
                    <td><small>{s.effect}</small></td>
                    <td>
                      {canEdit ? (
                        <button className={`kv-button ${on && s.name !== "maintenance" ? "kv-button--secondary" : ""}`} onClick={() => setSwitching(s.name)} aria-label={`${s.label}: ${on ? "kapat" : "aç"}`}>
                          {on ? "Kapat" : "Aç"}
                        </button>
                      ) : (
                        <span className="kv-muted">Yetkin yok</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {groups.map((group) => (
        <section key={group.group} aria-labelledby={`group-${group.group}`}>
          <h2 id={`group-${group.group}`}>{group.label}</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="sr-only">{group.label} ayarları</caption>
              <thead>
                <tr><th scope="col">Ayar</th><th scope="col">Değer</th><th scope="col">Sürüm</th><th scope="col">Son değişiklik</th>{canEdit ? <th scope="col">İşlem</th> : null}</tr>
              </thead>
              <tbody>
                {group.items.map((item) => (
                  <tr key={item.key}>
                    <th scope="row">
                      {labelOf(item.key)}
                      <br />
                      <small className="kv-muted">{item.key}{rangeOf(item.key) ? ` · ${rangeOf(item.key)}` : ""}</small>
                    </th>
                    <td><strong>{formatValue(item.key, item.value)}</strong></td>
                    <td>{item.version === 1 ? <span className="kv-muted">Varsayılan</span> : `v${item.version}`}</td>
                    <td>{item.updatedBy ? <>{formatDate(item.updatedAt)}<br /><small className="kv-muted">{item.updatedBy.displayName}</small></> : <span className="kv-muted">—</span>}</td>
                    {canEdit ? (
                      <td><button className="kv-button kv-button--ghost" onClick={() => startEdit(item)} aria-label={`${labelOf(item.key)} değiştir`}>Değiştir</button></td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <ActionDialog
        open={switching !== null}
        title={switchTarget ? `${switchTarget.label}: ${stateOf(switchTarget.name, switchTarget.key) ? "kapat" : "aç"}` : ""}
        description={
          switchTarget ? (
            <>
              {switchTarget.effect}{" "}
              {switchTarget.name === "maintenance" && !stateOf("maintenance", switchTarget.key)
                ? "Bakım modu açılınca kullanıcılar hiçbir yazma işlemi yapamaz; bu panel çalışmaya devam eder ve modu buradan kapatırsın."
                : ""}
            </>
          ) : null
        }
        submitLabel={switchTarget && stateOf(switchTarget.name, switchTarget.key) ? "Kapat" : "Aç"}
        onClose={() => setSwitching(null)}
        onSubmit={async (reason) => {
          const target = switchTarget!;
          const next: Partial<EmergencyState> = { [target.name]: !stateOf(target.name, target.key) };
          await admin.putEmergency(next, reason);
          setNotice(`${target.label} güncellendi ve audit kaydına yazıldı.`);
          reload();
        }}
      />

      <ActionDialog
        open={editing !== null}
        title={editing ? `${labelOf(editing.key)}` : ""}
        description={editing ? <>Anahtar: <code>{editing.key}</code>. Mevcut değer: <strong>{formatValue(editing.key, editing.value)}</strong>. Değişiklik deploy gerektirmez.</> : null}
        submitLabel="Kaydet"
        onClose={() => setEditing(null)}
        validate={() => {
          if (!parsed) return null;
          if (!parsed.ok) return parsed.message;
          return sameValue(parsed.value, editing!.value) ? "Değer değişmedi." : null;
        }}
        onSubmit={async (reason) => {
          const item = editing!;
          const result = parseInput(item.key, item.value, draft);
          if (!result.ok) throw new UiError("VALIDATION_ERROR", result.message);
          try {
            await admin.updateSetting(item.key, result.value, item.version, reason);
          } catch (cause) {
            // Başka biri değiştirmişse liste güncel sürümle yenilenir; pencere açık kalır ve mesaj gösterilir.
            if (cause instanceof UiError && cause.code === "VERSION_CONFLICT") reload();
            throw cause;
          }
          setNotice(`${labelOf(item.key)} güncellendi ve audit kaydına yazıldı.`);
          reload();
        }}
      >
        {editing ? (
          typeof editing.value === "boolean" ? (
            <label>
              Değer
              <select className="kv-input" value={String(draft)} onChange={(event) => setDraft(event.target.value === "true")}>
                <option value="true">Açık</option>
                <option value="false">Kapalı</option>
              </select>
            </label>
          ) : Array.isArray(editing.value) ? (
            <fieldset>
              <legend>İzin verilen türler</legend>
              {allowedTypes.map((type) => (
                <label key={type} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={(draft as string[]).includes(type)}
                    onChange={(event) => setDraft((previous) => (event.target.checked ? [...(previous as string[]), type] : (previous as string[]).filter((t) => t !== type)))}
                  />{" "}
                  {type}
                </label>
              ))}
            </fieldset>
          ) : (
            <label>
              Değer{rangeOf(editing.key) ? ` (${rangeOf(editing.key)})` : ""}
              <input className="kv-input" inputMode="numeric" value={String(draft)} onChange={(event) => setDraft(event.target.value)} />
            </label>
          )
        ) : null}
      </ActionDialog>
    </>
  );
}

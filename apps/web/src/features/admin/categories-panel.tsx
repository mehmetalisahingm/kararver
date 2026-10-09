"use client";

// Kategori yönetimi (KV-41): gerçek admin.categories.* API ile liste, oluşturma, düzenleme, sıralama ve pasife alma.
// Düğme görünürlüğü yalnız UX'tir; category.manage yetkisi backend RBAC tarafından zorunlu tutulur.
import { useCallback, useRef, useState } from "react";
import type { AdminClient, Category, CategoryInput } from "./admin-client.ts";
import { ActionDialog, ListState, shortId, useNotice, useRemoteList } from "./admin-ui";
import styles from "./admin-shell.module.css";

const SLUG = /^[a-z0-9-]{2,60}$/;
const INT4_MAX = 2_147_483_647;

type Dialog = { kind: "create" } | { kind: "edit"; category: Category } | { kind: "toggle"; category: Category } | null;

type Form = {
  slug: string;
  name: string;
  description: string;
  iconKey: string;
  sortOrder: string;
  isActive: boolean;
};

const emptyForm = (): Form => ({ slug: "", name: "", description: "", iconKey: "", sortOrder: "0", isActive: true });

export function CategoriesPanel({ admin }: { admin: AdminClient }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const createKey = useRef("");
  const { setNotice, element } = useNotice();
  const load = useCallback((cursor: string | undefined, signal: AbortSignal) => admin.categories(cursor, signal), [admin]);
  const remote = useRemoteList(load);

  const close = () => setDialog(null);
  const done = (message: string) => {
    setNotice(message);
    remote.reload();
  };
  const field = (key: keyof Form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  function openCreate() {
    setForm(emptyForm());
    createKey.current = `kategori-${crypto.randomUUID()}`;
    setDialog({ kind: "create" });
  }

  function openEdit(category: Category) {
    setForm({
      slug: category.slug,
      name: category.name,
      description: category.description ?? "",
      iconKey: category.iconKey ?? "",
      sortOrder: String(category.sortOrder),
      isActive: category.isActive,
    });
    setDialog({ kind: "edit", category });
  }

  function validation(): string | null {
    const order = Number(form.sortOrder);
    if (!SLUG.test(form.slug)) return "Slug 2–60 karakter, küçük harf, rakam ve tire içermeli.";
    if (form.name.trim().length < 2) return "Kategori adı en az 2 karakter olmalı.";
    if (form.description.length > 300) return "Açıklama en fazla 300 karakter olabilir.";
    if (form.iconKey.length > 60) return "İkon anahtarı en fazla 60 karakter olabilir.";
    if (!Number.isInteger(order) || Math.abs(order) > INT4_MAX) return "Sıra geçerli bir tam sayı olmalı.";
    return null;
  }

  function payload(): CategoryInput {
    return {
      slug: form.slug,
      name: form.name.trim(),
      description: form.description.trim() || null,
      iconKey: form.iconKey.trim() || null,
      sortOrder: Number(form.sortOrder),
      isActive: form.isActive,
    };
  }

  return (
    <>
      <div className={styles.toolbar}>
        <button className="kv-button" onClick={openCreate}>Kategori ekle</button>
        <p className="kv-muted">Silme yerine pasife alma kullanılır; bağlı anketler kategorisini korur.</p>
      </div>
      {element}
      {remote.items.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="sr-only">Kategori yönetimi</caption>
            <thead><tr><th scope="col">Kategori</th><th scope="col">Sıra</th><th scope="col">İçerik</th><th scope="col">Durum</th><th scope="col">İşlem</th></tr></thead>
            <tbody>
              {remote.items.map((category) => (
                <tr key={category.id}>
                  <td><strong>{category.name}</strong><br /><small className="kv-muted">/{category.slug} · {shortId(category.id)}</small></td>
                  <td>{category.sortOrder}</td>
                  <td>{category.pollCount}</td>
                  <td>{category.isActive ? "Aktif" : "Pasif"}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button className="kv-button kv-button--ghost" onClick={() => openEdit(category)}>Düzenle</button>
                      <button className="kv-button kv-button--ghost" onClick={() => setDialog({ kind: "toggle", category })}>
                        {category.isActive ? "Pasife al" : "Aktifleştir"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <ListState remote={remote} empty="Kategori bulunamadı." />

      <ActionDialog
        open={dialog?.kind === "create"}
        title="Kategori ekle"
        description="Kategori public keşifte görünür. Gerekçe audit kaydına yazılır."
        submitLabel="Ekle"
        validate={validation}
        onClose={close}
        onSubmit={async (reason) => {
          await admin.createCategory(payload(), reason, createKey.current);
          done("Kategori eklendi.");
        }}
      >
        <CategoryFields form={form} field={field} />
      </ActionDialog>

      <ActionDialog
        open={dialog?.kind === "edit"}
        title="Kategoriyi düzenle"
        description="Slug, açıklama, ikon, sıra ve aktiflik değişiklikleri sunucuda doğrulanır ve audit'e yazılır."
        submitLabel="Kaydet"
        validate={validation}
        onClose={close}
        onSubmit={async (reason) => {
          if (dialog?.kind !== "edit") return;
          await admin.updateCategory(dialog.category.id, payload(), reason);
          done("Kategori güncellendi.");
        }}
      >
        <CategoryFields form={form} field={field} />
      </ActionDialog>

      <ActionDialog
        open={dialog?.kind === "toggle"}
        title={dialog?.kind === "toggle" && dialog.category.isActive ? "Kategoriyi pasife al" : "Kategoriyi aktifleştir"}
        description={dialog?.kind === "toggle" && dialog.category.isActive
          ? "Kategori yeni içeriklerde ve public listelerde görünmez; mevcut anketler silinmez."
          : "Kategori yeniden public listelerde ve yeni içerik seçiminde görünür."}
        submitLabel={dialog?.kind === "toggle" && dialog.category.isActive ? "Pasife al" : "Aktifleştir"}
        onClose={close}
        onSubmit={async (reason) => {
          if (dialog?.kind !== "toggle") return;
          const next = !dialog.category.isActive;
          await admin.updateCategory(dialog.category.id, { isActive: next }, reason);
          done(next ? "Kategori aktifleştirildi." : "Kategori pasife alındı.");
        }}
      />
    </>
  );
}

function CategoryFields({ form, field }: { form: Form; field: (key: keyof Form, value: string | boolean) => void }) {
  return (
    <>
      <label>Slug<input className="kv-input" value={form.slug} onChange={(event) => field("slug", event.target.value.trim())} maxLength={60} required /></label>
      <label>Ad<input className="kv-input" value={form.name} onChange={(event) => field("name", event.target.value)} maxLength={60} required /></label>
      <label>Açıklama<textarea className="kv-input" rows={3} value={form.description} onChange={(event) => field("description", event.target.value)} maxLength={300} /></label>
      <label>İkon anahtarı<input className="kv-input" value={form.iconKey} onChange={(event) => field("iconKey", event.target.value)} maxLength={60} /></label>
      <label>Sıra<input className="kv-input" type="number" value={form.sortOrder} onChange={(event) => field("sortOrder", event.target.value)} /></label>
      <label>
        Durum
        <select className="kv-input" value={form.isActive ? "active" : "inactive"} onChange={(event) => field("isActive", event.target.value === "active")}>
          <option value="active">Aktif</option>
          <option value="inactive">Pasif</option>
        </select>
      </label>
    </>
  );
}
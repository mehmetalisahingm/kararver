"use client";

// Anket ve yorum moderasyonu (KV-37): arama + tablo. Gizli, kilitli ve kaldırılmış içerik de listelenir; moderatör yalnız
// atandığı toplulukların içeriğini görür (sunucu süzer). Satırdan gerekçeli işlem, kategori/topluluk taşıma ve rapor +
// moderasyon geçmişi açılır; her işlem audit'e yazılır. İlk oydan sonra soru/seçenek değişmez (yönetici için de):
// bu ekranda bu alanları düzenleyen bir yol yoktur.
import { useCallback, useEffect, useState } from "react";
import { AdminClient } from "./admin-client.ts";
import type { AdminComment, AdminPoll, Community, ContentKind, ContentStatus, ModerationAction, PollCategory } from "./admin-client.ts";
import { HistoryDialog } from "./content-history";
import { actionLabels, availableActions, placementDiff, statusLabels } from "./content-model.ts";
import { ActionDialog, ListState, formatDate, isAdminRole, useAdminRoles, useNotice, useRemoteList } from "./admin-ui";
import styles from "./admin-shell.module.css";

type Row = AdminPoll | AdminComment;
type Dialog = { type: "action" | "move" | "history"; row: Row } | null;

const NO_COMMUNITY = "";

export function ContentPanel({ admin, kind }: { admin: AdminClient; kind: ContentKind }) {
  const isAdmin = isAdminRole(useAdminRoles());
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState<ContentStatus | "">("");
  const [communityId, setCommunityId] = useState("");
  const [reported, setReported] = useState(false);
  const [trendExcluded, setTrendExcluded] = useState(false);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [action, setAction] = useState<ModerationAction>("HIDE");
  const { setNotice, element } = useNotice();
  const noun = kind === "polls" ? "anket" : "yorum";

  // Topluluk süzgeci ve taşıma seçenekleri (ilk sayfa); alınamazsa süzgeç gizli kalır, liste etkilenmez.
  useEffect(() => {
    const controller = new AbortController();
    admin.communities(undefined, controller.signal).then((page) => setCommunities(page.items), () => setCommunities([]));
    return () => controller.abort();
  }, [admin]);

  const load = useCallback(
    (cursor: string | undefined, signal: AbortSignal) => {
      const common = { q: term || undefined, status: status || undefined, communityId: communityId || undefined, reported: reported ? true : undefined };
      return kind === "polls"
        ? admin.polls({ ...common, trendExcluded: trendExcluded ? true : undefined }, cursor, signal)
        : admin.comments(common, cursor, signal);
    },
    [admin, kind, term, status, communityId, reported, trendExcluded],
  ) as (cursor: string | undefined, signal: AbortSignal) => Promise<{ items: Row[]; next: string | null }>;
  const remote = useRemoteList<Row>(load);
  const close = () => setDialog(null);
  const done = (message: string) => {
    setNotice(message);
    remote.reload();
  };

  function search(event: React.FormEvent) {
    event.preventDefault();
    const text = q.trim();
    // Sunucu en az 2 karakter ister; tek karakter aramayı süzgeç yapmaz.
    setTerm(text.length >= 2 ? text : "");
  }

  const row = dialog?.row;
  const poll = kind === "polls" ? (row as AdminPoll | undefined) : undefined;
  const options = row ? availableActions(kind, row, isAdmin) : [];

  return (
    <>
      <form className={styles.toolbar} role="search" aria-label={`${noun} ara`} onSubmit={search}>
        <label>
          {kind === "polls" ? "Başlık veya açıklama" : "Yorum metni"}
          <input className="kv-input" type="search" value={q} onChange={(event) => setQ(event.target.value)} minLength={2} maxLength={100} placeholder="En az 2 karakter" />
        </label>
        <label>
          Durum
          <select className="kv-input" value={status} onChange={(event) => setStatus(event.target.value as ContentStatus | "")}>
            <option value="">Tümü</option>
            {(Object.keys(statusLabels) as ContentStatus[]).map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
          </select>
        </label>
        {communities.length > 0 ? (
          <label>
            Topluluk
            <select className="kv-input" value={communityId} onChange={(event) => setCommunityId(event.target.value)}>
              <option value="">Tümü</option>
              {communities.map((community) => <option key={community.id} value={community.id}>{community.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className={styles.check}>
          <input type="checkbox" checked={reported} onChange={(event) => setReported(event.target.checked)} /> Açık raporu olanlar
        </label>
        {kind === "polls" ? (
          <label className={styles.check}>
            <input type="checkbox" checked={trendExcluded} onChange={(event) => setTrendExcluded(event.target.checked)} /> Trendden çıkarılmış
          </label>
        ) : null}
        <button className="kv-button" type="submit">Ara</button>
      </form>
      {element}

      {remote.items.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="sr-only">{kind === "polls" ? "Anketler" : "Yorumlar"}</caption>
            <thead>
              <tr>
                <th scope="col">{kind === "polls" ? "Anket" : "Yorum"}</th>
                <th scope="col">Durum</th>
                <th scope="col">{kind === "polls" ? "Oy / yorum" : "Anket"}</th>
                <th scope="col">Rapor</th>
                <th scope="col">Tarih</th>
                <th scope="col">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {remote.items.map((item) => (kind === "polls" ? <PollRow key={item.id} item={item as AdminPoll} onOpen={(type) => { setAction(availableActions("polls", item as AdminPoll, isAdmin)[0] ?? "HIDE"); setDialog({ type, row: item }); }} isAdmin={isAdmin} /> : <CommentRow key={item.id} item={item as AdminComment} onOpen={(type) => { setAction(availableActions("comments", item as AdminComment, isAdmin)[0] ?? "HIDE"); setDialog({ type, row: item }); }} isAdmin={isAdmin} />))}
            </tbody>
          </table>
        </div>
      ) : null}
      <ListState remote={remote} empty={`Süzgeçe uyan ${noun} yok.`} />

      <ActionDialog
        open={dialog?.type === "action"}
        title={`${kind === "polls" ? "Ankete" : "Yoruma"} işlem uygula`}
        description="Gizleme, kaldırma ve kilitleme içeriğin açık raporlarını da kapatır. Yorumları kapatmak oyu etkilemez. Her işlem audit kaydına yazılır."
        submitLabel="Uygula"
        onClose={close}
        validate={() => (options.length === 0 ? "Bu içeriğe uygulanabilecek işlem yok." : null)}
        onSubmit={async (reason) => {
          await admin.moderate(kind, row!.id, action, reason);
          done("İşlem uygulandı ve audit kaydına yazıldı.");
        }}
      >
        <label>
          İşlem
          <select className="kv-input" value={action} onChange={(event) => setAction(event.target.value as ModerationAction)}>
            {options.map((value) => <option key={value} value={value}>{actionLabels[value]}</option>)}
          </select>
        </label>
      </ActionDialog>

      {poll ? <MoveDialog admin={admin} poll={dialog?.type === "move" ? poll : null} communities={communities} isAdmin={isAdmin} onClose={close} onDone={done} /> : null}

      <HistoryDialog
        admin={admin}
        kind={kind}
        id={dialog?.type === "history" ? dialog.row.id : null}
        title={row ? ("title" in row ? row.title : row.body.slice(0, 120)) : ""}
        onClose={close}
      />
    </>
  );
}

function RowActions({ canAct, canMove, onOpen }: { canAct: boolean; canMove: boolean; onOpen: (type: "action" | "move" | "history") => void }) {
  return (
    <div className={styles.rowActions}>
      {canAct ? <button className="kv-button kv-button--ghost" onClick={() => onOpen("action")}>İşlem</button> : null}
      {canMove ? <button className="kv-button kv-button--ghost" onClick={() => onOpen("move")}>Taşı</button> : null}
      <button className="kv-button kv-button--ghost" onClick={() => onOpen("history")}>Geçmiş</button>
    </div>
  );
}

function PollRow({ item, onOpen, isAdmin }: { item: AdminPoll; onOpen: (type: "action" | "move" | "history") => void; isAdmin: boolean }) {
  return (
    <tr>
      <td>
        <strong>{item.title}</strong>
        <br />
        <small className="kv-muted">
          @{item.author.username} · {item.category.name}
          {item.community ? ` · ${item.community.name}` : ""}
        </small>
      </td>
      <td>
        {statusLabels[item.status]}
        {item.trendExcluded ? <><br /><small className="kv-muted">Trend dışı</small></> : null}
        {item.commentsClosed ? <><br /><small className="kv-muted">Yorumlar kapalı</small></> : null}
        {item.contentLocked ? <><br /><small className="kv-muted">İlk oy geldi: soru kilitli</small></> : null}
      </td>
      <td>{item.voteCount} / {item.commentCount}</td>
      <td>{item.openReportCount}</td>
      <td>{formatDate(item.createdAt)}</td>
      <td><RowActions canAct={availableActions("polls", item, isAdmin).length > 0} canMove={item.status !== "REMOVED"} onOpen={onOpen} /></td>
    </tr>
  );
}

function CommentRow({ item, onOpen, isAdmin }: { item: AdminComment; onOpen: (type: "action" | "move" | "history") => void; isAdmin: boolean }) {
  return (
    <tr>
      <td>
        {item.body.length > 160 ? `${item.body.slice(0, 159)}…` : item.body}
        <br />
        <small className="kv-muted">@{item.author.username}{item.parentId ? " · cevap" : ""}</small>
      </td>
      <td>{statusLabels[item.status]}</td>
      <td><small>{item.pollTitle}</small></td>
      <td>{item.openReportCount}</td>
      <td>{formatDate(item.createdAt)}</td>
      <td><RowActions canAct={availableActions("comments", item, isAdmin).length > 0} canMove={false} onOpen={onOpen} /></td>
    </tr>
  );
}

function MoveDialog({
  admin,
  poll,
  communities,
  isAdmin,
  onClose,
  onDone,
}: {
  admin: AdminClient;
  poll: AdminPoll | null;
  communities: Community[];
  isAdmin: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [categories, setCategories] = useState<PollCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [toCommunity, setToCommunity] = useState(NO_COMMUNITY);

  useEffect(() => {
    if (!poll) return;
    setCategoryId(poll.category.id);
    setToCommunity(poll.community?.id ?? NO_COMMUNITY);
    const controller = new AbortController();
    admin.pollCategories(controller.signal).then(setCategories, () => setCategories([]));
    return () => controller.abort();
  }, [admin, poll]);

  const diff = poll ? placementDiff({ categoryId: poll.category.id, communityId: poll.community?.id ?? null }, { categoryId, communityId: toCommunity === NO_COMMUNITY ? null : toCommunity }) : null;
  const canLeaveCommunity = isAdmin;

  return (
    <ActionDialog
      open={poll !== null}
      title="Kategori veya topluluk taşı"
      description="Soru metni, seçenekler, oylar ve yorumlar olduğu gibi kalır; ilk oydan sonra da taşınabilir. Anket feed, arama ve trendlerde yeni yerinde görünür. Gerekçe audit ve içerik geçmişine yazılır."
      submitLabel="Taşı"
      onClose={onClose}
      validate={() => (diff ? null : "Kategori veya topluluğu değiştirmeden taşınamaz.")}
      onSubmit={async (reason) => {
        await admin.movePoll(poll!.id, diff!, reason);
        onDone("Anket taşındı ve audit kaydına yazıldı.");
      }}
    >
      <label>
        Kategori
        <select className="kv-input" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          {categories.length === 0 && poll ? <option value={poll.category.id}>{poll.category.name}</option> : null}
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
      <label>
        Topluluk
        <select className="kv-input" value={toCommunity} onChange={(event) => setToCommunity(event.target.value)}>
          <option value={NO_COMMUNITY} disabled={!canLeaveCommunity && poll?.community !== null}>Topluluksuz{canLeaveCommunity ? "" : " (yalnız yönetici)"}</option>
          {poll?.community && !communities.some((community) => community.id === poll.community!.id) ? <option value={poll.community.id}>{poll.community.name}</option> : null}
          {communities.map((community) => <option key={community.id} value={community.id}>{community.name}</option>)}
        </select>
      </label>
    </ActionDialog>
  );
}

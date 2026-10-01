// KV-22 (#24) — public profil ve private kaydetme endpoint'leri.
import { ApiError } from "../../http/errors.ts";
import { decodeCursor, encodeCursor, invalidCursor } from "../../http/cursor.ts";
import type { Route } from "../../http/route.ts";
import { toPollDetail } from "../polls/view.ts";
import type { PollSettings, PollStore } from "../polls/store.ts";
import type { ProfilePageCursor, ProfileStore } from "./store.ts";

const PROFILE_POLLS_CURSOR = "profiles.polls:v1";
const PROFILE_COMMENTS_CURSOR = "profiles.comments:v1";
const BOOKMARKS_CURSOR = "bookmarks.list:v1";

const notFound = (message = "Profil bulunamadı.") => new ApiError("NOT_FOUND", message);

function pageCursor(raw: string | undefined, namespace: string): ProfilePageCursor {
  const cursor = decodeCursor(raw, namespace);
  if (!cursor) return null;
  const [rawDate] = cursor.keys;
  if (cursor.keys.length !== 1 || typeof rawDate !== "string") throw invalidCursor();
  const createdAt = new Date(rawDate);
  if (Number.isNaN(createdAt.getTime())) throw invalidCursor();
  return { createdAt, id: cursor.id };
}

function pollCard(detail: ReturnType<typeof toPollDetail>) {
  return {
    id: detail.id,
    publicId: detail.publicId,
    slug: detail.slug,
    kind: detail.kind,
    title: detail.title,
    excerpt: detail.excerpt,
    author: detail.author,
    category: detail.category,
    community: detail.community,
    coverImage: detail.coverImage,
    status: detail.status,
    createdAt: detail.createdAt,
    closesAt: detail.closesAt,
    closed: detail.closed,
    commentCount: detail.commentCount,
    reactions: detail.reactions,
    results: detail.results,
    viewer: detail.viewer,
  };
}

export type ProfileDeps = {
  store: ProfileStore;
  polls: PollStore;
  now: () => Date;
  mediaPublicBaseUrl: string;
  settings: () => Promise<PollSettings>;
};

export function registerProfileRoutes(route: Route, deps: ProfileDeps): void {
  const { store, polls, now, mediaPublicBaseUrl } = deps;
  const avatarUrl = (key: string | null) => (key ? `${mediaPublicBaseUrl}/${key}` : null);

  route("profiles.get", async ({ params }) => {
    const profile = await store.findPublicProfile(params.username);
    if (!profile) throw notFound();
    return {
      status: 200,
      body: {
        data: {
          id: profile.id,
          username: profile.username,
          displayName: profile.displayName,
          avatarUrl: avatarUrl(profile.avatarPublicKey),
          bio: profile.bio,
          joinedAt: profile.joinedAt.toISOString(),
          stats: {
            pollCount: profile.pollCount,
            votesReceived: profile.votesReceived,
            commentCount: profile.commentCount,
          },
        },
      },
    };
  });

  route("profiles.polls", async ({ params, query, viewer }) => {
    const profile = await store.findPublicProfile(params.username);
    if (!profile) throw notFound();
    const after = pageCursor(query.cursor, `${PROFILE_POLLS_CURSOR}:${profile.id}`);
    const raw = await store.listPublicPollIds(profile.id, after, query.limit + 1);
    const page = raw.slice(0, query.limit);
    const records = await polls.listByIds(page.map((row) => row.id), viewer?.id ?? null);
    const settings = await deps.settings();
    const data = records.map((poll) => pollCard(toPollDetail(poll, viewer ?? null, now(), settings, mediaPublicBaseUrl)));
    const last = page.at(-1);
    const hasMore = raw.length > query.limit;
    return {
      status: 200,
      body: {
        data,
        page: {
          hasMore,
          nextCursor:
            hasMore && last
              ? encodeCursor(`${PROFILE_POLLS_CURSOR}:${profile.id}`, [last.createdAt.toISOString()], last.id)
              : null,
        },
      },
    };
  });

  route("profiles.comments", async ({ params, query, viewer }) => {
    const profile = await store.findPublicProfile(params.username);
    if (!profile) throw notFound();
    const namespace = `${PROFILE_COMMENTS_CURSOR}:${profile.id}`;
    const after = pageCursor(query.cursor, namespace);
    const raw = await store.listPublicComments(profile.id, viewer?.id ?? null, after, query.limit + 1);
    const page = raw.slice(0, query.limit);
    const hasMore = raw.length > query.limit;
    const last = page.at(-1);
    return {
      status: 200,
      body: {
        data: page.map((comment) => ({
          id: comment.id,
          pollId: comment.pollId,
          parentId: comment.parentId,
          kind: comment.kind,
          body: comment.body,
          deleted: false,
          author: {
            id: comment.author.id,
            username: comment.author.username,
            displayName: comment.author.displayName,
            avatarUrl: avatarUrl(comment.author.avatarPublicKey),
          },
          reactions: {
            likes: comment.likeCount,
            dislikes: comment.dislikeCount,
            viewer: viewer ? comment.viewerReaction : null,
          },
          replyCount: comment.replyCount,
          editedAt: comment.editedAt?.toISOString() ?? null,
          createdAt: comment.createdAt.toISOString(),
          viewer: viewer ? { canEdit: viewer.id === comment.author.id, reaction: comment.viewerReaction } : null,
        })),
        page: {
          hasMore,
          nextCursor:
            hasMore && last ? encodeCursor(namespace, [last.createdAt.toISOString()], last.id) : null,
        },
      },
    };
  });

  route("bookmarks.put", async ({ params, viewer }) => {
    const result = await store.putBookmark(viewer!.id, params.id);
    if (result === "not_found") throw notFound("İçerik bulunamadı.");
    return { status: 200, body: { data: { saved: true as const } } };
  });

  route("bookmarks.delete", async ({ params, viewer }) => {
    await store.deleteBookmark(viewer!.id, params.id);
    return { status: 200, body: { data: { saved: false as const } } };
  });

  route("bookmarks.list", async ({ query, viewer }) => {
    const after = pageCursor(query.cursor, BOOKMARKS_CURSOR);
    const raw = await store.listBookmarkPollIds(viewer!.id, after, query.limit + 1);
    const page = raw.slice(0, query.limit);
    const records = await polls.listByIds(page.map((row) => row.id), viewer!.id);
    const settings = await deps.settings();
    const data = records.map((poll) => pollCard(toPollDetail(poll, viewer!, now(), settings, mediaPublicBaseUrl)));
    const last = page.at(-1);
    const hasMore = raw.length > query.limit;
    return {
      status: 200,
      body: {
        data,
        page: {
          hasMore,
          nextCursor: hasMore && last ? encodeCursor(BOOKMARKS_CURSOR, [last.createdAt.toISOString()], last.id) : null,
        },
      },
    };
  });
}

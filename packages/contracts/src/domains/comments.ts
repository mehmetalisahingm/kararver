// Yorum, tek seviye cevap, alternatif öneri ve yorum tepkisi — sağlayıcı Faruk
// KV-17 (#19), #66 (tepki)
import { z } from "zod";
import { Count, CursorQuery, dataOf, Empty, Id, IdParams, pageOf, PublicUser, ReactionSummary, ReactionValue, Timestamp } from "../common.ts";
import { defineEndpoint } from "../endpoint.ts";

export const CommentKind = z.enum(["COMMENT", "ALTERNATIVE"]);

export const CommentView = z.strictObject({
  id: Id,
  pollId: Id,
  parentId: Id.nullable(),
  kind: CommentKind,
  /** Kaldırılmış ama cevabı olan yorum tombstone olarak kalır: body null, deleted true. */
  body: z.string().nullable(),
  deleted: z.boolean(),
  author: PublicUser.nullable(),
  reactions: ReactionSummary,
  replyCount: Count,
  editedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  viewer: z.strictObject({ canEdit: z.boolean(), reaction: ReactionValue.nullable() }).nullable(),
});

const Body = z.string().trim().min(1).max(2000);

const comments = { owner: "Faruk", module: "comments" } as const;
const reactions = { owner: "Faruk", module: "reactions" } as const;
const web = ["Ümit (web, KV-18)"];

export const commentEndpoints = [
  defineEndpoint({
    id: "comments.list",
    domain: "comments",
    method: "GET",
    path: "/polls/:id/comments",
    summary: "Üst seviye yorumlar veya alternatifler",
    auth: "public",
    provider: comments,
    consumers: web,
    unblocks: ["#19", "#20"],
    availability: { status: "ready" },
    request: {
      params: IdParams,
      query: z.strictObject({
        ...CursorQuery.shape,
        kind: CommentKind.default("COMMENT"),
        sort: z.enum(["new", "top"]).default("new"),
      }),
    },
    responses: { 200: pageOf(CommentView) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "viewer",
  }),
  defineEndpoint({
    id: "comments.replies",
    domain: "comments",
    method: "GET",
    path: "/comments/:id/replies",
    summary: "Bir yorumun cevapları (tek seviye)",
    auth: "public",
    provider: comments,
    consumers: web,
    unblocks: ["#19", "#20"],
    availability: { status: "ready" },
    request: { params: IdParams, query: CursorQuery },
    responses: { 200: pageOf(CommentView) },
    errors: ["INVALID_CURSOR"],
    idempotency: "none",
    cache: "viewer",
  }),
  defineEndpoint({
    id: "comments.create",
    domain: "comments",
    method: "POST",
    path: "/polls/:id/comments",
    summary: "Yorum, cevap veya alternatif öneri",
    auth: "verified",
    provider: comments,
    consumers: web,
    unblocks: ["#19", "#20"],
    availability: { status: "ready" },
    request: {
      params: IdParams,
      body: z
        .strictObject({ body: Body, kind: CommentKind.default("COMMENT"), parentId: Id.optional() })
        .refine((b) => !(b.kind === "ALTERNATIVE" && b.parentId), {
          message: "Alternatif öneri sadece üst seviyede olabilir",
          path: ["parentId"],
        }),
    },
    responses: { 201: dataOf(CommentView) },
    errors: ["COMMENTS_DISABLED", "COMMENT_DEPTH_EXCEEDED", "CONTENT_LOCKED", "FEATURE_DISABLED"],
    idempotency: "key-optional",
    cache: "private",
    notes: [
      "Cevaba cevap → 400 COMMENT_DEPTH_EXCEEDED (DB: KV_COMMENT_DEPTH).",
      "Anket kapandıktan sonra yorum serbest; allowComments=false veya comments.enabled=false engeller.",
    ],
  }),
  defineEndpoint({
    id: "comments.update",
    domain: "comments",
    method: "PATCH",
    path: "/comments/:id",
    summary: "Kendi yorumunu düzenler",
    auth: "owner",
    provider: comments,
    consumers: web,
    unblocks: ["#19", "#20"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ body: Body }) },
    responses: { 200: dataOf(CommentView) },
    errors: ["CONTENT_LOCKED"],
    idempotency: "natural",
    cache: "private",
    notes: ["Önceki sürüm içerik geçmişine yazılır (planlı, #66)."],
  }),
  defineEndpoint({
    id: "comments.delete",
    domain: "comments",
    method: "DELETE",
    path: "/comments/:id",
    summary: "Kendi yorumunu kaldırır (soft delete)",
    auth: "owner",
    provider: comments,
    consumers: web,
    unblocks: ["#19", "#20"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: { 204: Empty },
    errors: [],
    idempotency: "natural",
    cache: "private",
  }),
  defineEndpoint({
    id: "reactions.comment.put",
    domain: "comments",
    method: "PUT",
    path: "/comments/:id/reaction",
    summary: "Yoruma beğeni/dislike (#64'teki /comments/:id/like'ın yerine)",
    auth: "user",
    provider: reactions,
    consumers: web,
    unblocks: ["#66", "#19", "#20"],
    availability: { status: "ready" },
    request: { params: IdParams, body: z.strictObject({ value: ReactionValue }) },
    responses: { 200: dataOf(ReactionSummary) },
    errors: [],
    idempotency: "natural",
    cache: "private",
  }),
  defineEndpoint({
    id: "reactions.comment.delete",
    domain: "comments",
    method: "DELETE",
    path: "/comments/:id/reaction",
    summary: "Yorum tepkisini kaldırır",
    auth: "user",
    provider: reactions,
    consumers: web,
    unblocks: ["#66", "#19", "#20"],
    availability: { status: "ready" },
    request: { params: IdParams },
    responses: { 200: dataOf(ReactionSummary) },
    errors: [],
    idempotency: "natural",
    cache: "private",
  }),
];

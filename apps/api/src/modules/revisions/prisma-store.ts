// RevisionStore'un PostgreSQL uygulaması: poll_revisions, comment_revisions (append-only).
import type { PrismaClient } from "@kararver/db";
import type { RevisionRecord, RevisionStore } from "./store.ts";

const editorSelect = {
  select: { id: true, username: true, displayName: true, avatarMedia: { select: { status: true, publicObjectKey: true } } },
} as const;

type Row = {
  version: number;
  editedAt: Date;
  snapshot: unknown;
  editor: { id: string; username: string; displayName: string; avatarMedia: { status: string; publicObjectKey: string | null } | null };
};

const toRecord = (r: Row): RevisionRecord => ({
  version: r.version,
  editedAt: r.editedAt,
  snapshot: r.snapshot as Record<string, unknown>,
  editor: {
    id: r.editor.id,
    username: r.editor.username,
    displayName: r.editor.displayName,
    avatarPublicKey: r.editor.avatarMedia?.status === "APPROVED" ? r.editor.avatarMedia.publicObjectKey : null,
  },
});

export function createPrismaRevisionStore(prisma: PrismaClient): RevisionStore {
  return {
    async exists(target, id) {
      return target === "poll"
        ? (await prisma.poll.count({ where: { id } })) > 0
        : (await prisma.comment.count({ where: { id } })) > 0;
    },

    async list(target, id, beforeVersion, limit) {
      const version = beforeVersion === null ? {} : { version: { lt: beforeVersion } };
      const query = { orderBy: { version: "desc" as const }, take: limit, select: { version: true, editedAt: true, snapshot: true, editor: editorSelect } };
      const rows =
        target === "poll"
          ? await prisma.pollRevision.findMany({ where: { pollId: id, ...version }, ...query })
          : await prisma.commentRevision.findMany({ where: { commentId: id, ...version }, ...query });
      return (rows as Row[]).map(toRecord);
    },
  };
}

import { createEvent, newEventId } from "@kararver/contracts";
import type { PrismaClient } from "@kararver/db";
import { ApiError } from "../../http/errors.ts";
import { writeRevision } from "../revisions/write.ts";
import { writeEvent } from "../events/write.ts";
import type { DecisionStore } from "./store.ts";
export function createPrismaDecisionStore(prisma: PrismaClient): DecisionStore {
 return {
  async get(pollId, viewerId) {
   return prisma.$transaction(async tx => {
    const [poll] = await tx.$queryRaw<{ authorId: string }[]>`SELECT author_id AS "authorId" FROM polls WHERE id = ${pollId}::uuid AND status IN ('ACTIVE','LOCKED') FOR SHARE`;
    if (!poll) return null;
    const decision = await tx.pollDecision.findUnique({ where: { pollId } });
    const following = viewerId ? !!await tx.pollFollow.findUnique({ where: { userId_pollId: { userId: viewerId, pollId } } }) : false;
    return { decision, following, isAuthor: viewerId === poll.authorId };
   });
  },
  async follow(pollId, userId, following) {
   await prisma.$transaction(async tx => {
    if (!following) { await tx.pollFollow.deleteMany({ where: { pollId, userId } }); return; }
    const rows = await tx.$queryRaw<unknown[]>`SELECT id FROM polls WHERE id = ${pollId}::uuid AND status IN ('ACTIVE','LOCKED') FOR SHARE`;
    if (!rows.length) throw new ApiError("NOT_FOUND", "İçerik bulunamadı.");
    await tx.pollFollow.createMany({ data: [{ pollId, userId }], skipDuplicates: true });
   });
  },
  async put(pollId, userId, input, now, authorize) {
   return prisma.$transaction(async tx => {
    const [poll] = await tx.$queryRaw<{ authorId: string; status: string; kind: string }[]>`SELECT author_id AS "authorId", status::text, kind::text FROM polls WHERE id = ${pollId}::uuid FOR UPDATE`;
    if (!poll || !['ACTIVE','LOCKED'].includes(poll.status)) throw new ApiError("NOT_FOUND", "İçerik bulunamadı.");
    await authorize({ ownerId: poll.authorId });
    if (poll.authorId !== userId) throw new ApiError("FORBIDDEN", "Yalnızca sahibi kararını güncelleyebilir.");
    if (poll.status === 'LOCKED') throw new ApiError("CONTENT_LOCKED", "İçerik moderasyon tarafından kilitlenmiş.");
    if (input.chosenOptionId && (poll.kind !== 'POLL' || !await tx.pollOption.findFirst({ where: { id: input.chosenOptionId, pollId } }))) throw new ApiError("VALIDATION_ERROR", "Seçenek bu ankete ait olmalı.");
    const previous = await tx.pollDecision.findUnique({ where: { pollId } });
    if (previous?.chosenOptionId === input.chosenOptionId && previous.note === input.note) return previous;
    const decision = await tx.pollDecision.upsert({ where: { pollId }, create: { pollId, ...input, updatedAt: now }, update: { ...input, updatedAt: now } });
    await writeRevision(tx, "poll", pollId, userId, now);
    await writeEvent(tx, createEvent({ id: newEventId(now), type: "decision.updated", occurredAt: now.toISOString(), actorId: userId, subject: { type: "POLL", id: pollId }, payload: { chosenOptionId: input.chosenOptionId, first: !previous } }));
    return decision;
   });
  },
 };
}

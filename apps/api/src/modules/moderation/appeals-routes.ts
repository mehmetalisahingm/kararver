import { decodeCursor, encodeCursor, invalidCursor } from "../../http/cursor.ts";
import { appealResolutionDueAt, appealResolutionUrgency } from "./appeal-resolution-sla.ts";
import { ApiError } from "../../http/errors.ts";
import type { Route } from "../../http/route.ts";
import { appealStatus, type ModerationAppealStore } from "./appeals-store.ts";

function view(receipt: {
  rejectionActionId: string; deliveredAt: Date; deadlineAt: Date; filedAt: Date | null;
}, now: Date) {
  return {
    rejectionActionId: receipt.rejectionActionId,
    deliveredAt: receipt.deliveredAt.toISOString(),
    deadlineAt: receipt.deadlineAt.toISOString(),
    filedAt: receipt.filedAt?.toISOString() ?? null,
    status: appealStatus(receipt, now),
  };
}

export function registerMyModerationAppealRoutes(
  route: Route,
  deps: { store: ModerationAppealStore },
): void {
  route("admin.moderation.appeals.list", async ({ query, moderationScope }) => {
    // Defense in depth: the registry grants only ADMIN+, not community moderators.
    if (!(await moderationScope()).all) throw new ApiError("FORBIDDEN", "İtiraz kuyruğu yalnız yöneticilere açıktır.");
    const key = "admin.moderation.appeals.list:pending";
    const decoded = decodeCursor(query.cursor, key);
    let after: { at: Date; id: string } | null = null;
    if (decoded) {
      const at = new Date(decoded.keys[0] as string);
      if (decoded.keys.length !== 1 || typeof decoded.keys[0] !== "string" ||
          !Number.isFinite(at.getTime()) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded.id)) throw invalidCursor();
      after = { at, id: decoded.id };
    }
    const { rows, evaluatedAt } = await deps.store.listPending({ after, limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last
      ? encodeCursor(key, [last.filedAt.toISOString()], last.rejectionActionId) : null;
    return { status: 200, body: { data: page.map(row => ({
      rejectionActionId: row.rejectionActionId, pollId: row.pollId,
      filedAt: row.filedAt.toISOString(),
      resolutionTargetAt: appealResolutionDueAt(row.filedAt).toISOString(),
      urgency: appealResolutionUrgency({ submittedAt: row.filedAt, status: "OPEN", resolvedAt: null }, evaluatedAt),
    })), page: { nextCursor, hasMore: nextCursor !== null } } };
  });

  route("me.moderationAppeals.acceptedReceipt", async ({ viewer, params }) => {
    const receipt = await deps.store.getAccepted(viewer!.id, params.id);
    if (!receipt) throw new ApiError("NOT_FOUND", "Kabul edilmiş itiraz makbuzu bulunamadı.");
    return { status: 200, body: { data: {
      rejectionActionId: receipt.rejectionActionId, pollId: receipt.pollId,
      resolvedAt: receipt.resolvedAt.toISOString(), outcome: "ACCEPTED",
      message: "İtirazın kabul edildi. Bu karar için yeniden yayın ücreti alınmadı.",
    } } };
  });

  route("me.moderationAppeals.get", async ({ viewer, params }) => {
    const receipt = await deps.store.get(viewer!.id, params.id);
    if (!receipt) throw new ApiError("NOT_FOUND", "İtiraz başvurusu veya ret bildirimi bulunamadı.");
    return { status: 200, body: { data: view(receipt, receipt.evaluatedAt) } };
  });

  route("me.moderationAppeals.file", async ({ viewer, params, body }) => {
    const filed = await deps.store.file({
      userId: viewer!.id, rejectionActionId: params.id, reason: body.reason,
    });
    if (filed.kind === "not_found") throw new ApiError("NOT_FOUND", "Kendine ait teslim edilmiş ret bildirimi bulunamadı.");
    if (filed.kind === "expired")
      throw new ApiError("CONFLICT", "İtiraz süresi bildirimin tesliminden itibaren 30 günü geçti.", [
        { code: "appeal_window_closed" },
      ]);
    if (filed.kind === "not_reviewable")
      throw new ApiError("CONFLICT", "Ret kararı artık bu yoldan incelenemiyor.", [
        { code: "appeal_not_reviewable" },
      ]);
    return { status: 200, body: { data: view(filed.receipt, filed.receipt.filedAt!) } };
  });
}

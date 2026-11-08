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
  deps: { store: ModerationAppealStore; now: () => Date },
): void {
  route("me.moderationAppeals.get", async ({ viewer, params }) => {
    const receipt = await deps.store.get(viewer!.id, params.id);
    if (!receipt) throw new ApiError("NOT_FOUND", "İtiraz başvurusu veya ret bildirimi bulunamadı.");
    return { status: 200, body: { data: view(receipt, deps.now()) } };
  });

  route("me.moderationAppeals.file", async ({ viewer, params, body }) => {
    const filed = await deps.store.file({
      userId: viewer!.id, rejectionActionId: params.id, reason: body.reason, now: deps.now(),
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
    return { status: 200, body: { data: view(filed.receipt, deps.now()) } };
  });
}

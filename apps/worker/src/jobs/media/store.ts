// media.process'in veri erişimi — media_assets (DATA_MODEL.md §9). DB CHECK'leri son güvencedir:
// APPROVED olmayan kayıt public anahtar taşıyamaz, APPROVED kayıt işlenmiş kopya olmadan var olamaz.
import type { Prisma, PrismaClient } from "@kararver/db";
import type { RiskLevel } from "./policy.ts";

export type ClaimedMedia = { id: string; originalObjectKey: string; processingAttempts: number };

export type MediaFacts = {
  originalMimeType?: string;
  originalSizeBytes?: number;
  contentSha256?: string;
  width?: number;
  height?: number;
  processedSizeBytes?: number;
  processedObjectKey?: string;
  riskLevel?: RiskLevel;
  riskScore?: number;
  moderationLabels?: { class: string; score: number }[];
  moderationModel?: string;
  moderatedAt?: Date;
};

export type Outcome =
  | { status: "APPROVED"; publicObjectKey: string; facts: MediaFacts & { processedObjectKey: string } }
  | { status: "QUARANTINED" | "REJECTED"; error: string | null; facts: MediaFacts };

export interface MediaJobStore {
  /** Sadece PENDING kaydı alır ve deneme sayısını artırır; işlenmiş/olmayan kayıtta null. */
  claim(id: string): Promise<ClaimedMedia | null>;
  /** Sadece hâlâ PENDING ise yazar (başka bir iş sonuçlandırdıysa false). */
  finish(id: string, outcome: Outcome): Promise<boolean>;
}

export function createPrismaMediaJobStore(prisma: PrismaClient): MediaJobStore {
  return {
    async claim(id) {
      try {
        return await prisma.mediaAsset.update({
          where: { id, status: "PENDING" },
          data: { processingAttempts: { increment: 1 } },
          select: { id: true, originalObjectKey: true, processingAttempts: true },
        });
      } catch (err) {
        if ((err as { code?: unknown }).code === "P2025") return null;
        throw err;
      }
    },

    async finish(id, outcome) {
      const { moderationLabels, ...facts } = outcome.facts;
      const data: Prisma.MediaAssetUpdateManyMutationInput = {
        ...facts,
        ...(moderationLabels ? { moderationLabels } : {}),
        status: outcome.status,
        publicObjectKey: outcome.status === "APPROVED" ? outcome.publicObjectKey : null,
        processingError: outcome.status === "APPROVED" ? null : outcome.error,
      };
      const { count } = await prisma.mediaAsset.updateMany({ where: { id, status: "PENDING" }, data });
      return count === 1;
    },
  };
}

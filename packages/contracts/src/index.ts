// @kararver/contracts — KararVer v1 API sözleşmesi.
// Belge: docs/API_CONTRACTS.md · Ortak temel: docs/FOUNDATION_CONTRACTS.md
import { adminEndpoints } from "./domains/admin.ts";
import { authEndpoints } from "./domains/auth.ts";
import { commentEndpoints } from "./domains/comments.ts";
import { communityEndpoints } from "./domains/communities.ts";
import { discoveryEndpoints } from "./domains/discovery.ts";
import { growthEndpoints } from "./domains/growth.ts";
import { mediaEndpoints } from "./domains/media.ts";
import { moderationEndpoints } from "./domains/moderation.ts";
import { notificationEndpoints } from "./domains/notifications.ts";
import { pollEndpoints } from "./domains/polls.ts";
import type { EndpointContract } from "./endpoint.ts";

// #64 yardımcıları (aynı adlar ve davranış)
export {
  canModerate,
  contractVersion,
  errorResponse,
  errorStatuses,
  eventEnvelope,
  eventTypes,
  pageResponse,
  pollResults,
  resultsVisibleTo,
  roles,
} from "./helpers.ts";
export type { ErrorResponseBody, EventEnvelope, PageBody, ResultsProjection } from "./helpers.ts";

export * from "./common.ts";
export * from "./errors.ts";
export * from "./endpoint.ts";
export * from "./domains/admin.ts";
export * from "./domains/auth.ts";
export * from "./domains/comments.ts";
export * from "./domains/communities.ts";
export * from "./domains/discovery.ts";
export * from "./domains/growth.ts";
export * from "./domains/media.ts";
export * from "./domains/moderation.ts";
export * from "./domains/notifications.ts";
export * from "./domains/polls.ts";

/** Bütün v1 endpointleri. Sıra docs/API_CONTRACTS.md envanter sırasıdır. */
export const endpoints: readonly EndpointContract[] = Object.freeze([
  ...authEndpoints,
  ...pollEndpoints,
  ...commentEndpoints,
  ...discoveryEndpoints,
  ...growthEndpoints,
  ...mediaEndpoints,
  ...moderationEndpoints,
  ...communityEndpoints,
  ...notificationEndpoints,
  ...adminEndpoints,
]);

export function getEndpoint(id: string): EndpointContract {
  const endpoint = endpoints.find((e) => e.id === id);
  if (!endpoint) throw new Error(`Bilinmeyen endpoint: ${id}`);
  return endpoint;
}

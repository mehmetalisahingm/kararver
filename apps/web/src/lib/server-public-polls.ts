import { PollCard, PollDetail, dataOf, pageOf } from "@kararver/contracts";

function apiBaseUrl(): string | null {
  const raw = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";
  if (!raw) return null;
  return raw.replace(/\/$/, "").replace(/\/v1$/, "") + "/v1";
}

export function webBaseUrl(): URL {
  return new URL(process.env.WEB_URL ?? "http://localhost:3000");
}

export async function loadPublicPoll(routeId: string, options: { strict?: boolean } = {}): Promise<ReturnType<typeof PollDetail.parse> | null> {
  const api = apiBaseUrl();
  if (!api) {
    if (options.strict) throw new Error("public_poll_api_not_configured");
    return null;
  }

  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(routeId);
  const publicId = routeId.match(/-([A-Za-z0-9]{8})$/)?.[1];
  if (!uuid && !publicId) return null;

  const url = uuid
    ? `${api}/polls/${encodeURIComponent(routeId)}`
    : `${api}/polls/lookup?publicId=${encodeURIComponent(publicId!)}`;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) throw new Error("public_poll_api_unavailable");
    const parsed = dataOf(PollDetail).safeParse(await response.json());
    if (!parsed.success) throw new Error("public_poll_invalid_projection");
    return parsed.data.data;
  } catch (error) {
    // A deleted/hidden poll is a true 404, but transient API failures must
    // not become fake 404s that Google interprets as permanent removal.
    if (options.strict) throw error;
    return null;
  }
}

export async function loadSitemapPolls(): Promise<ReturnType<typeof PollCard.parse>[]> {
  const api = apiBaseUrl();
  if (!api) return [];

  const items: ReturnType<typeof PollCard.parse>[] = [];
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
    const query = new URLSearchParams({ tab: "new", limit: "50" });
    if (cursor) query.set("cursor", cursor);
    try {
      const response = await fetch(`${api}/feed?${query}`, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) break;
      const parsed = pageOf(PollCard).safeParse(await response.json());
      if (!parsed.success) break;
      items.push(...parsed.data.data);
      cursor = parsed.data.page.nextCursor ?? undefined;
      if (!cursor) break;
    } catch {
      break;
    }
  }
  return items;
}

import { HttpClient } from "./http-client.ts";

export type ShareChannel = "x" | "whatsapp" | "copy" | "other";
export type ShareLink = { shareId: string; url: string };

export async function createShareLink(pollId: string, channel: ShareChannel): Promise<ShareLink> {
  const http = new HttpClient(process.env.NEXT_PUBLIC_API_URL ?? "");
  const response = (await http.request("shares.create", {
    params: { id: pollId },
    body: { channel },
  })) as { data: ShareLink };
  return response.data;
}

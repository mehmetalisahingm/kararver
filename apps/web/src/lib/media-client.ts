import { MediaView, dataOf } from "@kararver/contracts";
import type { HttpClient } from "./http-client.ts";
import { UiError } from "./model.ts";

export type Media = ReturnType<typeof MediaView.parse>;
export type Upload = { mediaId: string; upload: { method: "PUT"; url: string; headers: Record<string,string>; expiresAt: string } };
export class MediaClient {
  private http: HttpClient;
  private uploadFetch: typeof fetch;
  constructor(http: HttpClient, uploadFetch: typeof fetch = fetch) {
    this.http = http;
    this.uploadFetch = (input, init) => uploadFetch(input, init);
  }
  async begin(file: File, key: string, signal?: AbortSignal): Promise<Upload> {
    if (!["image/jpeg","image/png","image/webp"].includes(file.type)) throw new UiError("MEDIA_TYPE_NOT_ALLOWED","JPEG, PNG veya WebP seçmelisin.");
    if (!file.size || file.size > 8 * 1024 * 1024) throw new UiError("MEDIA_TOO_LARGE","Görsel boş olmamalı ve 8 MB sınırını aşmamalı.");
    return (await this.http.request("media.uploads.create", {body:{purpose:"POLL",mimeType:file.type,sizeBytes:file.size},key,signal}) as {data:Upload}).data;
  }
  async put(ticket: Upload, file: File, signal?: AbortSignal) {
    try {
      // Presigned storage is a different origin: never send API cookies or authorization.
      const response = await this.uploadFetch(ticket.upload.url,{method:"PUT",headers:ticket.upload.headers,body:file,credentials:"omit",signal});
      if (!response.ok) throw new Error("upload failed");
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new UiError("UPLOAD_FAILED","Dosya yüklenemedi. Seçimin korundu; tekrar deneyebilirsin.");
    }
  }
  async complete(id: string, signal?: AbortSignal) { return dataOf(MediaView).parse(await this.http.request("media.complete",{params:{id},signal})).data; }
  async get(id: string, signal?: AbortSignal) { return dataOf(MediaView).parse(await this.http.request("media.get",{params:{id},signal})).data; }
}

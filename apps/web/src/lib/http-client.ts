import { ErrorBody, getEndpoint } from "@kararver/contracts";
import { UiError } from "./model.ts";

type Options = { params?: Record<string, string>; query?: Record<string, string | undefined>; body?: unknown; key?: string; signal?: AbortSignal };
export class HttpClient {
  readonly baseUrl: string;
  private fetcher: typeof fetch;
  onUnauthorized: () => void = () => {};
  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
    this.baseUrl = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1$/, "") + "/v1" : "";
    // Do not call the browser's native fetch with this HttpClient as its receiver.
    this.fetcher = (input, init) => fetcher(input, init);
  }
  async request(id: string, options: Options = {}): Promise<unknown> {
    if (!this.baseUrl) throw new UiError("API_UNCONFIGURED", "API adresi yapılandırılmamış.");
    const endpoint = getEndpoint(id);
    let path = endpoint.path;
    for (const [key, value] of Object.entries(options.params ?? {})) path = path.replace(`:${key}`, encodeURIComponent(value));
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined && value !== "") query.set(key, value);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.key) headers["Idempotency-Key"] = options.key;
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}${query.size ? `?${query}` : ""}`, {
        method: endpoint.method, credentials: "include", cache: "no-store", headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new UiError("NETWORK_ERROR", "Sunucuya ulaşılamadı. İşlemin durumunu kontrol edip tekrar deneyebilirsin.");
    }
    if (response.status === 401 && id !== "auth.login") this.onUnauthorized();
    const text = await response.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* Rejected below, never render proxy HTML. */ }
    if (!response.ok) {
      const parsed = ErrorBody.safeParse(body);
      if (parsed.success) {
        const fields: Record<string, string> = {};
        const aliases: Record<string, string> = { categoryId: "category", durationHours: "hours", resultsVisibility: "visibility", displayName: "name" };
        for (const detail of parsed.data.error.details) {
          if (typeof detail === "object" && detail !== null && "field" in detail && typeof detail.field === "string") {
            const key = detail.field.replace(/^body\./, "");
            const option = /^options\.(\d+)\.label$/.exec(key);
            fields[option ? `option-${option[1]}` : (aliases[key] ?? key)] = "message" in detail && typeof detail.message === "string" ? detail.message : parsed.data.error.message;
          }
        }
        throw new UiError(parsed.data.error.code, parsed.data.error.message, fields);
      }
      throw new UiError(response.status === 404 ? "ENDPOINT_UNAVAILABLE" : "HTTP_ERROR", response.status === 404 ? "Bu hizmet henüz kullanıma açılmamış." : `İstek tamamlanamadı (${response.status}).`);
    }
    const schema = endpoint.responses[response.status];
    const parsed = schema?.safeParse(body);
    if (!parsed?.success) throw new UiError("INVALID_RESPONSE", "Sunucudan beklenmeyen bir yanıt alındı. Lütfen tekrar dene.");
    return parsed.data;
  }
}

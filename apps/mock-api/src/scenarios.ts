// Senaryo seçimi (KV-06): X-Mock-Scenario başlığı @kararver/contracts/fixtures örneğinin adına
// eşlenir; başlık yoksa ilk başarılı örnek döner. `error:<KOD>` sözleşmedeki hata listesinden
// (allErrors) cevap üretir. Hata gövdeleri her zaman contracts'taki errorResponse ile kurulur.
import {
  allErrors,
  errorResponse,
  errorStatuses,
  isErrorCode,
  permissionForEndpoint,
  retryAfterCodes,
  type EndpointContract,
  type ErrorCode,
} from "@kararver/contracts";
import { examples, type Example } from "@kararver/contracts/fixtures";

export const SCENARIO_HEADER = "X-Mock-Scenario";
const ERROR_PREFIX = "error:";
/** Mock'ta 429/503 için sabit bekleme; gerçek değer sağlayıcının limitinden gelir. */
export const RETRY_AFTER_SECONDS = "60";

export type Scenario = { kind: "example"; example: Example } | { kind: "error"; code: ErrorCode };
export type ScenarioResult = { ok: true; scenario: Scenario } | { ok: false; code: string; message: string };
export type MockResponse = { status: number; body: unknown; headers: Record<string, string> };

const byEndpoint = new Map<string, Example[]>();
for (const example of examples) byEndpoint.set(example.endpoint, [...(byEndpoint.get(example.endpoint) ?? []), example]);

export function examplesFor(endpointId: string): Example[] {
  return byEndpoint.get(endpointId) ?? [];
}

export function defaultExample(endpointId: string): Example | undefined {
  return examplesFor(endpointId).find((x) => x.status < 300);
}

export function resolveScenario(endpoint: EndpointContract, header: string | undefined): ScenarioResult {
  if (header === undefined || header === "") {
    const example = defaultExample(endpoint.id);
    if (!example) return { ok: false, code: "no_default", message: `${endpoint.id} için başarılı örnek yok` };
    return { ok: true, scenario: { kind: "example", example } };
  }
  if (header.startsWith(ERROR_PREFIX)) {
    const code = header.slice(ERROR_PREFIX.length);
    const allowed = allErrors(endpoint);
    if (!isErrorCode(code) || !allowed.includes(code)) {
      return { ok: false, code: "error_not_in_contract", message: `Bu endpoint'in hata listesi: ${allowed.join(", ")}` };
    }
    return { ok: true, scenario: { kind: "error", code } };
  }
  const example = examplesFor(endpoint.id).find((x) => x.name === header);
  if (!example) {
    const names = examplesFor(endpoint.id).map((x) => x.name);
    return { ok: false, code: "unknown_scenario", message: `Geçerli senaryolar: ${names.join(", ")} veya error:<KOD>` };
  }
  return { ok: true, scenario: { kind: "example", example } };
}

const statusMessages: Record<number, string> = {
  400: "İstek geçersiz.",
  401: "Giriş yapmanız gerekiyor.",
  403: "Bu işlem için yetkiniz yok.",
  404: "İçerik bulunamadı.",
  409: "İşlem mevcut durumla çakışıyor.",
  413: "Dosya çok büyük.",
  415: "Dosya türü desteklenmiyor.",
  429: "Çok fazla istek; biraz sonra tekrar deneyin.",
  500: "Beklenmeyen bir hata oluştu.",
  503: "Hizmet geçici olarak kullanılamıyor.",
};

/** Sözleşme hata cevabı: status errorStatuses'tan, gövde errorResponse'tan; Retry-After gereken kodlarda başlık eklenir. */
export function errorReply(code: ErrorCode, message: string, requestId: string, details: unknown[] = []): MockResponse {
  const headers: Record<string, string> = retryAfterCodes.includes(code) ? { "Retry-After": RETRY_AFTER_SECONDS } : {};
  return { status: errorStatuses[code], body: errorResponse(code, message, requestId, details), headers };
}

export function renderScenario(endpoint: EndpointContract, scenario: Scenario, requestId: string): MockResponse {
  if (scenario.kind === "error") {
    const { code } = scenario;
    // API_CONTRACTS §4.6: ACCOUNT_RESTRICTED'da details[0].code kısıtlanan işlemdir (KV-04 işlem kimliği).
    const details = code === "ACCOUNT_RESTRICTED" ? [{ code: permissionForEndpoint(endpoint.id) }] : [];
    return errorReply(code, statusMessages[errorStatuses[code]] ?? statusMessages[500]!, requestId, details);
  }
  const { example } = scenario;
  if (example.status < 300) return { status: example.status, body: example.body, headers: {} };
  const { error } = example.body as { error: { code: ErrorCode; message: string; details: unknown[] } };
  return errorReply(error.code, error.message, requestId, error.details);
}

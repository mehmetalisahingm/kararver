// Opak cursor (API_CONTRACTS.md §4.3): base64url(JSON). İçinde sürüm, filtre anahtarı, sıralama
// değerleri ve eşitlik kırıcı id bulunur. İstemci içeriği yorumlamaz; filtre/sıralama değişip eski
// cursor gelirse 400 INVALID_CURSOR döner ve istemci listeyi baştan yükler.
import { ApiError } from "./errors.ts";

type Payload = { v: 1; f: string; k: (string | number)[]; id: string };

export function encodeCursor(filter: string, keys: (string | number)[], id: string): string {
  const payload: Payload = { v: 1, f: filter, k: keys, id };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function invalid(): ApiError {
  return new ApiError("INVALID_CURSOR", "Sayfa bilgisi geçersiz; listeyi baştan yükleyin.", [{ field: "cursor", code: "invalid" }]);
}

/** Cursor yoksa null. Bozuk, başka sürümden veya başka filtreden gelen cursor → 400 INVALID_CURSOR. */
export function decodeCursor(cursor: string | undefined, filter: string): { keys: (string | number)[]; id: string } | null {
  if (cursor === undefined) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  const p = payload as Partial<Payload>;
  if (
    !p ||
    p.v !== 1 ||
    p.f !== filter ||
    typeof p.id !== "string" ||
    !Array.isArray(p.k) ||
    !p.k.every((x) => typeof x === "string" || typeof x === "number")
  ) {
    throw invalid();
  }
  return { keys: p.k, id: p.id };
}

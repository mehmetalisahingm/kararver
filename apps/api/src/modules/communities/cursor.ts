// Opak cursor (API_CONTRACTS.md §4.3): sürüm + liste adı + sıralama anahtarı + id.
// İstemci içeriği yorumlamaz; bozuk, başka listeye ait veya eski sürüm cursor 400 INVALID_CURSOR.
import { ApiError } from "../../http/errors.ts";

const VERSION = 1;

export function encodeCursor(list: string, key: (string | number)[]): string {
  return Buffer.from(JSON.stringify({ v: VERSION, l: list, k: key })).toString("base64url");
}

export function decodeCursor(list: string, cursor: string | undefined, shape: ("string" | "number")[]): (string | number)[] | null {
  if (cursor === undefined) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: unknown; l?: unknown; k?: unknown };
    const key = parsed.k;
    if (
      parsed.v === VERSION &&
      parsed.l === list &&
      Array.isArray(key) &&
      key.length === shape.length &&
      key.every((value, i) => typeof value === shape[i])
    ) {
      return key as (string | number)[];
    }
  } catch {
    // aşağıda
  }
  throw new ApiError("INVALID_CURSOR", "Liste değişti; baştan yükleyin.", [{ field: "cursor", code: "invalid" }]);
}

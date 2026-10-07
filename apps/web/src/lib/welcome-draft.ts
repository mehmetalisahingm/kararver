import { safeReturnTo } from "./model.ts";

export const WELCOME_SEEN = "kv-welcome-v1";
export const WELCOME_DRAFT = "kv-welcome-draft-v1";

export type WelcomeDemoChoice = "write" | "wait";
export type WelcomeDraft = {
  version: 1;
  categoryIds: string[];
  demoChoice: WelcomeDemoChoice | null;
  returnTo: string;
};

const uniqueIds = (ids: string[]) => [...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 20);

export function makeWelcomeDraft(input: {
  categoryIds: string[];
  demoChoice: WelcomeDemoChoice | null;
  returnTo?: string | null;
}): WelcomeDraft {
  return {
    version: 1,
    categoryIds: uniqueIds(input.categoryIds),
    demoChoice: input.demoChoice === "write" || input.demoChoice === "wait" ? input.demoChoice : null,
    returnTo: safeReturnTo(input.returnTo ?? "/"),
  };
}

export function hasWelcomeSeen(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(WELCOME_SEEN) === "1";
  } catch {
    return false;
  }
}

export function markWelcomeSeen(): void {
  try {
    window.localStorage.setItem(WELCOME_SEEN, "1");
  } catch {
    // Storage erişimi ürün akışının çalışması için zorunlu değildir.
  }
}

export function readWelcomeDraft(): WelcomeDraft | null {
  try {
    const raw = window.localStorage.getItem(WELCOME_DRAFT);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<WelcomeDraft>;
    if (value.version !== 1 || !Array.isArray(value.categoryIds)) return null;
    return makeWelcomeDraft({
      categoryIds: value.categoryIds.filter((id): id is string => typeof id === "string"),
      demoChoice: value.demoChoice === "write" || value.demoChoice === "wait" ? value.demoChoice : null,
      returnTo: typeof value.returnTo === "string" ? value.returnTo : "/",
    });
  } catch {
    return null;
  }
}

export function writeWelcomeDraft(draft: WelcomeDraft): void {
  try {
    window.localStorage.setItem(WELCOME_DRAFT, JSON.stringify(makeWelcomeDraft(draft)));
  } catch {
    // Bellek/depolama kapalı olsa da auth akışı devam eder.
  }
}

export function clearWelcomeDraft(): void {
  try {
    window.localStorage.removeItem(WELCOME_DRAFT);
  } catch {
    // Sessiz: auth yetkisi veya oturum durumu storage'a bağlı değildir.
  }
}

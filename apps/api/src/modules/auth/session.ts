// Cookie'deki opak oturum token'ını kullanıcıya çözer (TECH_DECISIONS.md §3.4).
import type { FastifyReply, FastifyRequest } from "fastify";
import { readCookie, serializeCookie } from "../../http/cookies.ts";
import type { Authenticator } from "../../http/route.ts";
import { hashToken } from "./crypto.ts";
import type { AuthStore, UserRecord, UserStatus } from "./store.ts";

export type SessionUser = { id: string; sessionId: string; status: UserStatus; emailVerified: boolean; user: UserRecord };

export type SessionSettings = { cookieName: string; cookieDomain: string | null; secure: boolean; ttlMs: number; pepper: string };

/** lastSeenAt her istekte değil, en fazla bu aralıkla güncellenir. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export function createSessionCookies(settings: SessionSettings) {
  const cookie = { domain: settings.cookieDomain, secure: settings.secure };
  return {
    set(reply: FastifyReply, token: string): void {
      reply.header("Set-Cookie", serializeCookie(settings.cookieName, token, { ...cookie, maxAgeSeconds: Math.floor(settings.ttlMs / 1000) }));
    },
    clear(reply: FastifyReply): void {
      reply.header("Set-Cookie", serializeCookie(settings.cookieName, "", { ...cookie, maxAgeSeconds: 0 }));
    },
    read(request: FastifyRequest): string | null {
      return readCookie(request.headers.cookie, settings.cookieName);
    },
  };
}

export function createAuthenticator(store: AuthStore, settings: SessionSettings, now: () => Date): Authenticator {
  const cookies = createSessionCookies(settings);

  return {
    async resolve(request, reply) {
      const token = cookies.read(request);
      if (!token) return null;
      const session = await store.findSession(hashToken(token, settings.pepper));
      const at = now();
      const user = session && !session.revokedAt && session.expiresAt > at ? await store.findUserById(session.userId) : null;
      if (!session || !user || user.deletedAt) {
        cookies.clear(reply);
        return null;
      }
      if (!session.lastSeenAt || at.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
        await store.touchSession(session.id, at);
      }
      return { id: user.id, sessionId: session.id, status: user.status, emailVerified: user.emailVerifiedAt !== null, user };
    },
  };
}

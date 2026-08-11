import { timingSafeEqual } from "node:crypto";
import type { AppConfig } from "@chorus/shared";
import type { FastifyRequest, onRequestHookHandler } from "fastify";
import type { ClientToken } from "../auth/token-store.js";
import type { TokenStore } from "../auth/token-store.js";

type AuthConfig = AppConfig["auth"];

export function authMiddleware(auth: AuthConfig, tokenStore?: TokenStore): onRequestHookHandler {
  return async (request, reply) => {
    const pathname = request.url.split("?", 1)[0];
    if (!pathname?.startsWith("/api/") || !auth.enabled || isLoopbackRequest(request)) return;

    const token = bearerToken(request.headers.authorization);
    if (!token || !verifyAuthToken(token, auth, tokenStore)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  };
}

export function verifyAuthToken(
  plaintext: string,
  auth: AuthConfig,
  tokenStore?: TokenStore,
): ClientToken | "configured" | null {
  const stored = tokenStore?.verify(plaintext);
  if (stored) return stored;
  return isValidAuthToken(plaintext, auth.tokens) ? "configured" : null;
}

export function isValidAuthToken(token: string, tokens: Record<string, string>): boolean {
  const candidate = Buffer.from(token);
  return Object.values(tokens).some((configuredToken) => {
    const expected = Buffer.from(configuredToken);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

export function isLoopbackRequest(request: Pick<FastifyRequest, "ip">): boolean {
  return isLoopbackAddress(request.ip);
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  let normalized = address.trim().toLowerCase();
  if (normalized === "localhost") return true;
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  normalized = normalized.split("%", 1)[0] ?? normalized;
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized.startsWith("::ffff:")) {
    normalized = normalized.slice("::ffff:".length);
  }
  const octets = normalized.split(".");
  return octets.length === 4
    && octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255)
    && Number(octets[0]) === 127;
}

export function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(.+)$/iu);
  return match?.[1]?.trim() || undefined;
}

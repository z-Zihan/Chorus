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
    const verified = token ? verifyAuthToken(token, auth, tokenStore) : null;
    if (!verified) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const requiredScope = requiredApiScope(request.method, pathname);
    if (
      verified !== "configured" &&
      requiredScope &&
      !tokenHasRequiredScope(verified, requiredScope)
    ) {
      return reply.code(403).send({ error: `Missing scope: ${requiredScope}` });
    }
  };
}

function tokenHasRequiredScope(token: ClientToken, scope: string): boolean {
  if (token.scopes.includes("*") || token.scopes.includes(scope)) return true;
  const [resource, action] = scope.split(":");
  return Boolean(resource && action && token.scopes.includes(`${resource}:*`));
}

export function requiredApiScope(method: string, pathname: string): string | null {
  if (pathname === "/api/health" || pathname === "/api/tokens/ticket") return null;
  const read = method === "GET" || method === "HEAD";
  if (pathname.startsWith("/api/agents") || pathname.startsWith("/api/users")) {
    return read ? "agents:read" : "agents:write";
  }
  if (pathname.startsWith("/api/conversations") || pathname.startsWith("/api/a2a")) {
    if (/\/messages(?:\/|$)/u.test(pathname)) return read ? "messages:read" : "messages:write";
    return read ? "conversations:read" : "conversations:write";
  }
  if (pathname.startsWith("/api/hub") || pathname.startsWith("/api/trust")) {
    return read ? "hub:read" : "hub:write";
  }
  if (pathname.startsWith("/api/search") || pathname.startsWith("/api/export")) {
    return "conversations:read";
  }
  if (pathname.startsWith("/api/tokens")) return "tokens:manage";
  return read ? "api:read" : "api:write";
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
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127
  );
}

export function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(.+)$/iu);
  return match?.[1]?.trim() || undefined;
}

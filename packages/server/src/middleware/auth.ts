import { timingSafeEqual } from "node:crypto";
import type { AppConfig } from "@agentlink/shared";
import type { onRequestHookHandler } from "fastify";

type AuthConfig = AppConfig["auth"];

export function authMiddleware(auth: AuthConfig): onRequestHookHandler {
  return async (request, reply) => {
    const pathname = request.url.split("?", 1)[0];
    if (!pathname?.startsWith("/api/") || pathname === "/api/health") return;
    const token = bearerToken(request.headers.authorization);
    if (!token || !isValidAuthToken(token, auth.tokens)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  };
}

export function isValidAuthToken(token: string, tokens: Record<string, string>): boolean {
  const candidate = Buffer.from(token);
  return Object.values(tokens).some((configuredToken) => {
    const expected = Buffer.from(configuredToken);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(.+)$/iu);
  return match?.[1]?.trim() || undefined;
}

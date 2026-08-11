import type { AppConfig } from "@chorus/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { TokenStore, tokenHasScope } from "../auth/token-store.js";
import {
  bearerToken,
  isLoopbackRequest,
  verifyAuthToken,
} from "../middleware/auth.js";

const DEFAULT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const WS_TICKET_TTL_MS = 5 * 60 * 1_000;

const createTokenSchema = z.object({
  clientId: z.string().trim().min(1),
  scopes: z.array(z.string().trim().min(1)).default([]),
  ttlMs: z.number().int().positive().optional(),
  userId: z.string().trim().min(1).optional(),
});

export function registerTokenRoutes(
  app: FastifyInstance,
  tokenStore: TokenStore,
  auth: AppConfig["auth"],
): void {
  app.post("/api/tokens", { preHandler: requireLoopback }, async (request, reply) => {
    const parsed = createTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid token request", issues: parsed.error.issues });
    }
    const { clientId, scopes, ttlMs = DEFAULT_TOKEN_TTL_MS, userId } = parsed.data;
    const created = tokenStore.create(clientId, scopes, ttlMs, userId);
    return reply.code(201).send(created);
  });

  app.get("/api/tokens", { preHandler: requireLoopback }, async () => {
    return tokenStore.list().map(({ hash: _hash, ...token }) => token);
  });

  app.delete<{ Params: { id: string } }>(
    "/api/tokens/:id",
    { preHandler: requireLoopback },
    async (request, reply) => {
      if (!tokenStore.revoke(request.params.id)) {
        return reply.code(404).send({ error: "Token not found" });
      }
      return { success: true };
    },
  );

  app.post("/api/tokens/ticket", async (request, reply) => {
    if (!auth.enabled || isLoopbackRequest(request)) {
      const ticket = tokenStore.create("local-ws-ticket", ["ws:connect"], WS_TICKET_TTL_MS);
      return reply.code(201).send({ ...ticket, expiresInMs: WS_TICKET_TTL_MS });
    }

    const plaintext = bearerToken(request.headers.authorization);
    const source = plaintext ? verifyAuthToken(plaintext, auth, tokenStore) : null;
    if (!source) return reply.code(401).send({ error: "Unauthorized" });
    if (source !== "configured" && !tokenHasScope(source, "ws:connect")) {
      return reply.code(403).send({ error: "Missing scope: ws:connect" });
    }
    const ticket = tokenStore.create(
      source === "configured" ? "configured-token" : source.clientId,
      ["ws:connect"],
      WS_TICKET_TTL_MS,
      source === "configured" ? undefined : source.userId,
    );
    return reply.code(201).send({ ...ticket, expiresInMs: WS_TICKET_TTL_MS });
  });
}

async function requireLoopback(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isLoopbackRequest(request)) {
    await reply.code(403).send({ error: "Token management is only available from loopback" });
  }
}

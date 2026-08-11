import type { FastifyInstance, FastifyReply } from "fastify";
import type { TrustStore } from "../hub/trust-store.js";
import type { PairingService } from "../hub/pairing-service.js";

export function registerTrustRoutes(
  app: FastifyInstance,
  trustStore: TrustStore,
  pairingService?: PairingService,
): void {
  app.get("/api/trust", async () => trustStore.listTrusted());

  app.post("/api/trust/pair", async (request, reply) => {
    if (!pairingService) return reply.code(503).send({ error: "Pairing service is unavailable" });
    const hubId = readRequiredString(request.body, "hubId", reply);
    if (!hubId) return;
    return pairingService.createInvitation(hubId);
  });

  app.post("/api/trust/pairing-sessions/accept", async (request, reply) => {
    if (!pairingService) return reply.code(503).send({ error: "Pairing service is unavailable" });
    const pairingPackage = readRequiredString(request.body, "pairingPackage", reply);
    if (!pairingPackage) return;
    return pairingService.acceptInvitation(pairingPackage);
  });

  app.get<{ Params: { id: string } }>("/api/trust/pairing-sessions/:id", async (request, reply) => {
    const session = pairingService?.get(request.params.id);
    if (!session) return reply.code(404).send({ error: "Pairing session not found" });
    return session;
  });

  app.post<{ Params: { id: string } }>(
    "/api/trust/pairing-sessions/:id/approve",
    async (request, reply) => {
      if (!pairingService) return reply.code(503).send({ error: "Pairing service is unavailable" });
      return pairingService.approve(request.params.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/trust/pairing-sessions/:id/cancel",
    async (request, reply) => {
      if (!pairingService) return reply.code(503).send({ error: "Pairing service is unavailable" });
      return pairingService.cancel(request.params.id);
    },
  );

  app.post("/api/trust/block", async (request, reply) => {
    const hubId = readRequiredString(request.body, "hubId", reply);
    if (!hubId) return;
    trustStore.block(hubId);
    return { success: true, hub: trustStore.get(hubId) };
  });

  app.delete<{ Params: { hubId: string } }>("/api/trust/:hubId", async (request, reply) => {
    if (!trustStore.get(request.params.hubId)) {
      return reply.code(404).send({ error: "Trusted Hub not found" });
    }
    trustStore.remove(request.params.hubId);
    return { success: true };
  });

  app.get<{ Params: { hubId: string } }>("/api/trust/:hubId", async (request, reply) => {
    const hub = trustStore.get(request.params.hubId);
    if (!hub) return reply.code(404).send({ error: "Trusted Hub not found" });
    return hub;
  });
}

function readRequiredString(body: unknown, field: string, reply: FastifyReply): string | undefined {
  const value =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)[field]
      : undefined;
  if (typeof value !== "string" || !value.trim()) {
    void reply.code(400).send({ error: `${field} must be a non-empty string` });
    return undefined;
  }
  return value.trim();
}

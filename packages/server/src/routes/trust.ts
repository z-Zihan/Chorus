import type { FastifyInstance, FastifyReply } from "fastify";
import type { TrustStore } from "../hub/trust-store.js";

export function registerTrustRoutes(app: FastifyInstance, trustStore: TrustStore): void {
  app.get("/api/trust", async () => trustStore.listTrusted());

  app.post("/api/trust/pair", async (request, reply) => {
    const hubId = readRequiredString(request.body, "hubId", reply);
    if (!hubId) return;
    const challenge = trustStore.generatePairingCode(hubId);
    return {
      ...challenge,
      sas: trustStore.getPairingSAS(hubId, challenge.nonce),
    };
  });

  app.post("/api/trust/confirm", async (request, reply) => {
    const hubId = readRequiredString(request.body, "hubId", reply);
    if (!hubId) return;
    const code = readRequiredString(request.body, "code", reply);
    if (!code) return;
    const nonce = readRequiredString(request.body, "nonce", reply);
    if (!nonce) return;
    const ephemeralPublicKey = readRequiredString(request.body, "ephemeralPublicKey", reply);
    if (!ephemeralPublicKey) return;
    if (!trustStore.confirmPairing(hubId, code, nonce, ephemeralPublicKey)) {
      return reply.code(400).send({
        success: false,
        error: "Invalid or expired pairing confirmation",
      });
    }
    return { success: true, hub: trustStore.get(hubId) };
  });

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
  const value = typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)[field]
    : undefined;
  if (typeof value !== "string" || !value.trim()) {
    void reply.code(400).send({ error: `${field} must be a non-empty string` });
    return undefined;
  }
  return value.trim();
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalize } from "@chorus/shared";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHubToken, RegistrationChallengeStore } from "../auth.js";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { HubRegistry } from "../hub-registry.js";
import { MessageRouter } from "../message-router.js";
import { OfflineStore } from "../offline-store.js";
import { RoomManager } from "../room-manager.js";
import { registerRoutes } from "./index.js";

const JWT_SECRET = "relay-route-test-secret";

describe("Relay HTTP authorization and Room invitations", () => {
  let directory: string;
  let database: DatabaseContext;
  let registry: HubRegistry;
  let roomManager: RoomManager;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "chorus-relay-routes-"));
    database = createDatabase(join(directory, "relay.db"));
    registry = new HubRegistry(database);
    roomManager = new RoomManager(database);
    for (const hubId of ["hub-a", "hub-b", "hub-c"]) {
      registry.register(hubId, `public-key-${hubId}`, hubId.toUpperCase());
    }
    app = Fastify({ logger: false });
    registerRoutes(app, {
      registry,
      roomManager,
      jwtSecret: JWT_SECRET,
      maxHubs: 10,
      registrationChallenges: new RegistrationChallengeStore(),
      tokenTtlSeconds: 86_400,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const authorization = (hubId: string) => ({
    authorization: `Bearer ${createHubToken(hubId, JWT_SECRET)}`,
  });

  function registrationIdentity() {
    const keyPair = generateKeyPairSync("ed25519");
    const jwk = keyPair.publicKey.export({ format: "jwk" });
    if (!jwk.x) throw new Error("Missing test Ed25519 public key");
    return {
      hubId: Buffer.from(jwk.x, "base64url").toString("hex"),
      sign: (value: unknown) =>
        sign(null, Buffer.from(canonicalize(value), "utf8"), keyPair.privateKey).toString("base64"),
    };
  }

  async function createRoom() {
    return app.inject({
      method: "POST",
      url: "/api/rooms",
      headers: authorization("hub-a"),
      payload: { name: "Design Room", createdBy: "hub-b" },
    });
  }

  it("issues a token only after proof of Hub private-key possession", async () => {
    const identity = registrationIdentity();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/hubs/register",
          payload: { hubId: identity.hubId, publicKey: identity.hubId, displayName: "Secure Hub" },
        })
      ).statusCode,
    ).toBe(400);

    const challengeResponse = await app.inject({
      method: "POST",
      url: "/api/hubs/challenge",
      payload: { hubId: identity.hubId, publicKey: identity.hubId, displayName: "Secure Hub" },
    });
    expect(challengeResponse.statusCode).toBe(200);
    const challenge = challengeResponse.json() as Record<string, unknown>;

    const attacker = registrationIdentity();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/hubs/register",
          payload: { challengeId: challenge.challengeId, signature: attacker.sign(challenge) },
        })
      ).statusCode,
    ).toBe(401);

    const registered = await app.inject({
      method: "POST",
      url: "/api/hubs/register",
      payload: { challengeId: challenge.challengeId, signature: identity.sign(challenge) },
    });
    expect(registered.statusCode).toBe(201);
    expect(registered.json()).toMatchObject({
      relayHubId: identity.hubId,
      expiresInSeconds: 86_400,
    });
    expect(typeof registered.json().token).toBe("string");
    expect(registry.get(identity.hubId)?.displayName).toBe("Secure Hub");

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/hubs/register",
          payload: { challengeId: challenge.challengeId, signature: identity.sign(challenge) },
        })
      ).statusCode,
    ).toBe(401);

    const renewalChallengeResponse = await app.inject({
      method: "POST",
      url: "/api/hubs/challenge",
      payload: { hubId: identity.hubId, publicKey: identity.hubId, displayName: "Secure Hub" },
    });
    const renewalChallenge = renewalChallengeResponse.json() as Record<string, unknown>;
    const renewed = await app.inject({
      method: "POST",
      url: "/api/hubs/register",
      payload: {
        challengeId: renewalChallenge.challengeId,
        signature: identity.sign(renewalChallenge),
      },
    });
    expect(renewed.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/hubs/${identity.hubId}`,
          headers: { authorization: `Bearer ${registered.json().token as string}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/hubs/${identity.hubId}`,
          headers: { authorization: `Bearer ${renewed.json().token as string}` },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("rejects a registration identity that is not its Ed25519 public key", async () => {
    const identity = registrationIdentity();
    const response = await app.inject({
      method: "POST",
      url: "/api/hubs/challenge",
      payload: { hubId: "spoofed-hub", publicKey: identity.hubId, displayName: "Spoofed" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rate limits registration challenges by source and Hub", async () => {
    const identity = registrationIdentity();
    let response;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      response = await app.inject({
        method: "POST",
        url: "/api/hubs/challenge",
        payload: { hubId: identity.hubId, publicKey: identity.hubId, displayName: "Rate Limited" },
      });
    }
    expect(response?.statusCode).toBe(429);
    expect(response?.headers["retry-after"]).toBe("60");
  });

  it("requires a valid Hub token and derives the creator from it", async () => {
    expect(
      (await app.inject({ method: "POST", url: "/api/rooms", payload: { name: "Room" } }))
        .statusCode,
    ).toBe(401);

    const response = await createRoom();
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: "Design Room", createdBy: "hub-a" });
  });

  it("keeps an invited Hub out of the Room until it accepts", async () => {
    const room = (await createRoom()).json() as { id: string };
    const invite = await app.inject({
      method: "POST",
      url: `/api/rooms/${room.id}/invite`,
      headers: authorization("hub-a"),
      payload: { hubId: "hub-b" },
    });
    expect(invite.statusCode).toBe(201);
    expect(invite.json()).toMatchObject({
      invitation: { roomId: room.id, inviteeHubId: "hub-b", status: "pending" },
    });
    expect(roomManager.isMember(room.id, "hub-b")).toBe(false);

    const beforeAccept = await app.inject({
      method: "GET",
      url: `/api/rooms/${room.id}`,
      headers: authorization("hub-b"),
    });
    expect(beforeAccept.statusCode).toBe(403);

    const invitations = await app.inject({
      method: "GET",
      url: "/api/room-invitations",
      headers: authorization("hub-b"),
    });
    expect(invitations.json()).toMatchObject({
      invitations: [{ roomId: room.id, status: "pending", roomName: "Design Room" }],
    });

    const accepted = await app.inject({
      method: "POST",
      url: `/api/rooms/${room.id}/join`,
      headers: authorization("hub-b"),
      payload: { hubId: "hub-c" },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ invitation: { status: "accepted" } });
    expect(roomManager.isMember(room.id, "hub-b")).toBe(true);
    expect(roomManager.isMember(room.id, "hub-c")).toBe(false);

    const retried = await app.inject({
      method: "POST",
      url: `/api/rooms/${room.id}/join`,
      headers: authorization("hub-b"),
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({
      invitation: { status: "accepted" },
      room: { id: room.id },
    });

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/rooms/${room.id}/decline`,
          headers: authorization("hub-b"),
        })
      ).statusCode,
    ).toBe(400);
  });

  it("supports decline without granting membership", async () => {
    const room = (await createRoom()).json() as { id: string };
    await app.inject({
      method: "POST",
      url: `/api/rooms/${room.id}/invite`,
      headers: authorization("hub-a"),
      payload: { hubId: "hub-b" },
    });
    const declined = await app.inject({
      method: "POST",
      url: `/api/rooms/${room.id}/decline`,
      headers: authorization("hub-b"),
    });
    expect(declined.statusCode).toBe(200);
    expect(declined.json()).toMatchObject({ invitation: { status: "declined" } });
    expect(roomManager.isMember(room.id, "hub-b")).toBe(false);

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/rooms/${room.id}/join`,
          headers: authorization("hub-b"),
        })
      ).statusCode,
    ).toBe(400);
  });

  it("rejects Room reads and invitations from non-members", async () => {
    const room = (await createRoom()).json() as { id: string };
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/rooms/${room.id}`,
          headers: authorization("hub-b"),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/rooms/${room.id}/invite`,
          headers: authorization("hub-b"),
          payload: { hubId: "hub-c" },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("rejects Room messages from a Hub that has not accepted its invitation", async () => {
    const room = (await createRoom()).json() as { id: string };
    await app.inject({
      method: "POST",
      url: `/api/rooms/${room.id}/invite`,
      headers: authorization("hub-a"),
      payload: { hubId: "hub-b" },
    });
    const router = new MessageRouter(roomManager);
    const offlineStore = new OfflineStore(database);
    expect(() =>
      router.routeMessage(
        {
          id: "message-from-pending-hub",
          from: "hub-b",
          to: `room:${room.id}`,
          type: "group",
          timestamp: Date.now(),
          nonce: "nonce",
          ciphertext: "ciphertext",
          signature: "signature",
        },
        registry,
        offlineStore,
      ),
    ).toThrow("Room membership required");
    expect(offlineStore.getForHub("hub-a")).toEqual([]);
  });

  it("expires and revokes invitations without granting membership", async () => {
    const firstRoom = (await createRoom()).json() as { id: string };
    roomManager.inviteToRoom(firstRoom.id, "hub-b", "hub-a", -1);
    expect(roomManager.listInvitations("hub-b")[0]?.status).toBe("expired");
    expect(() => roomManager.respondToInvitation(firstRoom.id, "hub-b", "accepted")).toThrow(
      "Pending Room invitation not found",
    );

    const secondRoom = (
      await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers: authorization("hub-a"),
        payload: { name: "Revocable Room" },
      })
    ).json() as { id: string };
    await app.inject({
      method: "POST",
      url: `/api/rooms/${secondRoom.id}/invite`,
      headers: authorization("hub-a"),
      payload: { hubId: "hub-b" },
    });
    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/rooms/${secondRoom.id}/invitations/hub-b`,
      headers: authorization("hub-a"),
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ invitation: { status: "revoked" } });
    expect(roomManager.isMember(secondRoom.id, "hub-b")).toBe(false);
  });
});

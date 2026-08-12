import type { HubPayload } from "@chorus/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { Repository } from "../db/repository.js";
import type { AgentRegistry } from "../agent/registry.js";
import { AuthorizationService } from "./authorization.js";
import { TrustStore } from "./trust-store.js";

const databases: DatabaseContext[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close();
});

describe("Hub authorization", () => {
  it("rejects directory requests while pairing is still pending", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const trustStore = new TrustStore(repository);
    trustStore.addPending("hub-pending");
    const service = new AuthorizationService(trustStore, repository);
    const payload: HubPayload = {
      protocolVersion: 2,
      messageType: "directory_request",
      messageId: "directory-request-1",
      fromUserId: "usr_remote",
      fromUserName: "Remote User",
    };

    expect(service.authorize("hub-pending", payload)).toEqual({
      allowed: false,
      reason: "Hub pairing is incomplete",
    });
  });

  it("requires a cross-Hub Room and current sender membership for chat", async () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    await repository.getOrCreateLocalUser("Local User");
    const trustStore = new TrustStore(repository);
    trustStore.completePairing("hub-remote", {
      userId: "usr_remote",
      userName: "Remote User",
      userPublicKey: "remote-user-key",
    });
    const payload: HubPayload = {
      protocolVersion: 2,
      messageType: "chat",
      conversationId: "room-wire-id",
      messageId: "chat-1",
      fromUserId: "usr_remote",
      fromUserName: "Remote User",
      content: "Hello",
    };
    const absentRegistry = {
      isHubInRoom: () => false,
    } as unknown as AgentRegistry;
    const absent = new AuthorizationService(trustStore, repository, absentRegistry);

    expect(absent.authorize("hub-remote", payload)).toEqual({
      allowed: false,
      reason: "Cross-Hub Room membership is required",
    });

    repository.createConversation("Shared Room", "cross_hub", [], "room-wire-id");
    expect(absent.authorize("hub-remote", payload)).toEqual({
      allowed: false,
      reason: "Sender Hub is not a current Room member",
    });

    const memberRegistry = {
      isHubInRoom: (roomId: string, hubId: string) =>
        roomId === "room-wire-id" && hubId === "hub-remote",
    } as unknown as AgentRegistry;
    const member = new AuthorizationService(trustStore, repository, memberRegistry);
    expect(member.authorize("hub-remote", payload)).toEqual({ allowed: true });
  });
});

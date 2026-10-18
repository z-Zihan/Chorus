import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../credential-store.js", () => ({
  getUserKey: vi.fn(),
  setUserKey: vi.fn(),
}));

import { getUserKey, setUserKey } from "../credential-store.js";
import { generateUserKeyPair } from "../identity/user-keys.js";
import { createDatabase, type DatabaseContext } from "./index.js";
import { Repository } from "./repository.js";
import { agents, conversationAgents, conversations, users } from "./schema.js";

const mockedGetUserKey = vi.mocked(getUserKey);
const mockedSetUserKey = vi.mocked(setUserKey);

/**
 * P3-23: db/repository.ts previously had no direct unit tests. These three
 * groups cover the properties the audit flagged as untested: transactional
 * cleanup atomicity, idempotent writes, and the FK constraints that govern
 * what repository methods must clean up before deleting a row.
 */
const SHARED_OWNER_ID = "usr_shared_owner";

function makeAgentInput(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    name: `Agent ${id}`,
    type: "mock" as const,
    config: {},
    ownerId: SHARED_OWNER_ID,
    ...overrides,
  };
}

describe("Repository", () => {
  let directory: string;
  let database: DatabaseContext;
  let repository: Repository;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "chorus-repository-test-"));
    database = createDatabase(join(directory, "chorus.db"));
    repository = new Repository(database);
    // A generic owner so plain agent fixtures satisfy agents.owner_id's FK
    // without colliding with the usr_local-specific idempotency test below.
    database.db
      .insert(users)
      .values({ id: SHARED_OWNER_ID, name: "Shared Owner", createdAt: 1, updatedAt: 1 })
      .run();
  });

  afterAll(() => {
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockedGetUserKey.mockReset();
    mockedSetUserKey.mockReset();
  });

  describe("deleteAgent transaction", () => {
    it("atomically removes every dependent row and snapshots authored messages", () => {
      const ownerId = "usr_tx_owner";
      const agentId = "agent_tx_a";
      const friendId = "agent_tx_b";
      database.db
        .insert(users)
        .values({ id: ownerId, name: "Owner", createdAt: 1, updatedAt: 1 })
        .run();
      repository.upsertAgent(makeAgentInput(agentId, { ownerId }));
      repository.upsertAgent(makeAgentInput(friendId, { ownerId }));
      repository.addAgentFriend(agentId, friendId);
      const conversation = repository.createConversation("Tx room", "group", [agentId, friendId]);
      repository.saveScheduledTask({
        id: "task_tx_1",
        agentId,
        conversationId: conversation.id,
        cronExpression: "0 * * * *",
        prompt: "ping",
        createdAt: Date.now(),
      });
      repository.saveMessage({
        id: "msg_tx_1",
        conversationId: conversation.id,
        fromType: "agent",
        fromId: agentId,
        content: "hello",
        status: "done",
        timestamp: Date.now(),
      });

      expect(repository.deleteAgent(agentId)).toBe(true);

      expect(repository.getAgentRow(agentId)).toBeUndefined();
      expect(
        repository
          .listAgentFriends()
          .some((row) => row.agentId === agentId || row.friendId === agentId),
      ).toBe(false);
      expect(repository.getScheduledTask("task_tx_1")).toBeUndefined();
      expect(repository.getConversationMembers(conversation.id).map((member) => member.id)).toEqual(
        [friendId],
      );
      const [snapshotted] = repository.listAllMessages(conversation.id);
      expect(snapshotted?.metadata).toMatchObject({
        agentSnapshot: { id: agentId, name: `Agent ${agentId}`, type: "mock" },
      });
    });

    it("rolls back every write, including the message metadata snapshot, when a later delete throws", () => {
      // drizzle's query builder returns a fresh chain per call, so a plain mock
      // can't intercept .where()/.run() without reimplementing the chain. We
      // instead spy on db.delete() itself and only fake-fail the specific
      // table (conversationAgents) that deleteAgent touches after it has
      // already written the message snapshot update — this exercises real
      // sqlite rollback behavior rather than mocking it away.
      const ownerId = "usr_tx_owner_2";
      const agentId = "agent_tx_rollback";
      const friendId = "agent_tx_rollback_friend";
      database.db
        .insert(users)
        .values({ id: ownerId, name: "Owner 2", createdAt: 1, updatedAt: 1 })
        .run();
      repository.upsertAgent(makeAgentInput(agentId, { ownerId }));
      repository.upsertAgent(makeAgentInput(friendId, { ownerId }));
      repository.addAgentFriend(agentId, friendId);
      const conversation = repository.createConversation("Tx rollback room", "group", [
        agentId,
        friendId,
      ]);
      repository.saveScheduledTask({
        id: "task_tx_rollback",
        agentId,
        conversationId: conversation.id,
        cronExpression: "0 * * * *",
        prompt: "ping",
        createdAt: Date.now(),
      });
      repository.saveMessage({
        id: "msg_tx_rollback",
        conversationId: conversation.id,
        fromType: "agent",
        fromId: agentId,
        content: "hello",
        status: "done",
        timestamp: Date.now(),
      });

      const originalDelete = database.db.delete.bind(database.db);
      const deleteSpy = vi.spyOn(database.db, "delete").mockImplementation((table: unknown) => {
        if (table === conversationAgents) {
          throw new Error("boom-mid-transaction");
        }
        return originalDelete(table as never);
      });

      expect(() => repository.deleteAgent(agentId)).toThrow("boom-mid-transaction");
      deleteSpy.mockRestore();

      expect(repository.getAgentRow(agentId)).toBeDefined();
      expect(
        repository
          .listAgentFriends()
          .some((row) => row.agentId === agentId || row.friendId === agentId),
      ).toBe(true);
      expect(repository.getScheduledTask("task_tx_rollback")).toBeDefined();
      expect(
        repository
          .getConversationMembers(conversation.id)
          .map((member) => member.id)
          .sort(),
      ).toEqual([agentId, friendId].sort());
      const [notSnapshotted] = repository.listAllMessages(conversation.id);
      expect(notSnapshotted?.metadata).toBeUndefined();
    });
  });

  describe("idempotent writes", () => {
    it("addAgentFriend leaves exactly one bidirectional pair after repeated calls", () => {
      const agentId = "agent_idem_a";
      const friendId = "agent_idem_b";
      repository.upsertAgent(makeAgentInput(agentId));
      repository.upsertAgent(makeAgentInput(friendId));

      repository.addAgentFriend(agentId, friendId);
      repository.addAgentFriend(agentId, friendId);
      repository.addAgentFriend(agentId, friendId);

      const rows = repository
        .listAgentFriends()
        .filter((row) => row.agentId === agentId || row.friendId === agentId);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => `${row.agentId}:${row.friendId}`).sort()).toEqual(
        [`${agentId}:${friendId}`, `${friendId}:${agentId}`].sort(),
      );
    });

    it("getOrCreateLocalUser creates one usr_local row and updates it on subsequent calls", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      mockedGetUserKey.mockResolvedValueOnce(null);
      mockedSetUserKey.mockResolvedValueOnce(undefined);

      const created = await repository.getOrCreateLocalUser("Local User");
      expect(created.id).toBe("usr_local");
      expect(mockedSetUserKey).toHaveBeenCalledTimes(1);
      // getOrCreateLocalUser generates a fresh keypair internally when none is
      // stored, so assert against what it actually persisted rather than a
      // separately generated (and necessarily different) keypair.
      const generatedKeyPair = mockedSetUserKey.mock.calls[0]?.[0];
      expect(created.publicKey).toBe(generatedKeyPair?.publicKey);
      expect(created.lastSeenAt).toBe(new Date("2026-01-01T00:00:00Z").getTime());

      vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
      const secondKeyPair = generateUserKeyPair();
      mockedGetUserKey.mockResolvedValueOnce(secondKeyPair);

      const updated = await repository.getOrCreateLocalUser("Local User");
      expect(updated.id).toBe("usr_local");
      expect(updated.publicKey).toBe(secondKeyPair.publicKey);
      expect(updated.publicKey).not.toBe(generatedKeyPair?.publicKey);
      expect(updated.lastSeenAt).toBe(new Date("2026-01-02T00:00:00Z").getTime());

      const localUserRows = database.db.select().from(users).where(eq(users.id, "usr_local")).all();
      expect(localUserRows).toHaveLength(1);
      vi.useRealTimers();
    });

    it("createConversation dedupes repeated agentIds into one membership row per agent", () => {
      const agentA = "agent_idem_conv_a";
      const agentB = "agent_idem_conv_b";
      repository.upsertAgent(makeAgentInput(agentA));
      repository.upsertAgent(makeAgentInput(agentB));

      const conversation = repository.createConversation("Dup room", "group", [
        agentA,
        agentA,
        agentB,
      ]);

      const links = database.db
        .select()
        .from(conversationAgents)
        .where(eq(conversationAgents.conversationId, conversation.id))
        .all();
      expect(links).toHaveLength(2);
      expect(conversation.agentIds.sort()).toEqual([agentA, agentB].sort());
    });

    it("round-trips saveScheduledTask / setScheduledTaskEnabled / recordScheduledTaskRun", () => {
      const agentId = "agent_idem_task";
      repository.upsertAgent(makeAgentInput(agentId));
      const conversation = repository.createConversation("Task room", "dm", [agentId]);
      const taskId = "task_idem_1";

      repository.saveScheduledTask({
        id: taskId,
        agentId,
        conversationId: conversation.id,
        cronExpression: "*/5 * * * *",
        prompt: "check in",
        createdAt: Date.now(),
      });
      expect(repository.getScheduledTask(taskId)).toMatchObject({ enabled: true });

      expect(repository.setScheduledTaskEnabled(taskId, false)).toBe(true);
      expect(repository.getScheduledTask(taskId)).toMatchObject({ enabled: false });

      expect(
        repository.recordScheduledTaskRun(taskId, {
          lastRunAt: 1000,
          lastResult: "ok",
          nextRunAt: 2000,
        }),
      ).toBe(true);
      expect(repository.getScheduledTask(taskId)).toMatchObject({
        lastRunAt: 1000,
        lastResult: "ok",
        nextRunAt: 2000,
      });
    });
  });

  describe("foreign key enforcement (NO ACTION, foreign_keys=ON)", () => {
    // schema.ts defines these .references() without onDelete, so sqlite
    // defaults to NO ACTION. Repository.deleteAgent/deleteConversation are the
    // sanctioned cleanup paths that delete dependents first; a raw delete that
    // skips that cleanup is expected to fail loudly rather than orphan rows.
    // This is documenting current design, not reporting a bug.
    it("rejects deleting a user that still owns an agent", () => {
      const userId = "usr_fk_owner";
      const agentId = "agent_fk_owned";
      database.db
        .insert(users)
        .values({ id: userId, name: "FK Owner", createdAt: 1, updatedAt: 1 })
        .run();
      repository.upsertAgent(makeAgentInput(agentId, { ownerId: userId }));

      expect(() => database.db.delete(users).where(eq(users.id, userId)).run()).toThrow(
        /FOREIGN KEY constraint failed/u,
      );
    });

    it("rejects deleting a conversation that still has a conversationAgents membership row", () => {
      const agentId = "agent_fk_conv_member";
      repository.upsertAgent(makeAgentInput(agentId));
      const conversation = repository.createConversation("FK room", "dm", [agentId]);

      expect(() =>
        database.db.delete(conversations).where(eq(conversations.id, conversation.id)).run(),
      ).toThrow(/FOREIGN KEY constraint failed/u);
    });

    it("rejects deleting an agent that still has a conversationAgents membership row", () => {
      const agentId = "agent_fk_agent_member";
      repository.upsertAgent(makeAgentInput(agentId));
      repository.createConversation("FK room 2", "dm", [agentId]);

      expect(() => database.db.delete(agents).where(eq(agents.id, agentId)).run()).toThrow(
        /FOREIGN KEY constraint failed/u,
      );
    });
  });
});

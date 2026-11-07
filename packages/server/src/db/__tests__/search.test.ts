import type { Conversation, Message } from "@chorus/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseContext } from "../index.js";
import { Repository } from "../repository.js";
import { users } from "../schema.js";
import { searchMessages, type MessageSearchFilters, type MessageSearchResult } from "../search.js";

/**
 * Data-layer coverage for searchMessages. The HTTP-layer tests
 * (routes/__tests__/search.test.ts) only drive three end-to-end queries;
 * these call the function directly against a real :memory: database to pin
 * down LIKE-vs-FTS routing, LIKE wildcard escaping, every filter branch,
 * neighbour resolution (before/after) and the dropped-conversation path.
 *
 * Timestamps are explicit fixed values (never Date.now()) so created_at
 * ordering and the before/after window stay deterministic.
 */
const OWNER_ID = "usr_search_owner";
const AGENT_ID = "agent_search_bot";
const BASE_TIMESTAMP = 1_000_000;

interface SearchHarness {
  database: DatabaseContext;
  newConversation: (title: string) => Conversation;
  save: (conversationId: string, overrides?: Partial<Message>) => Message;
  search: (query: string, filters?: MessageSearchFilters) => MessageSearchResult[];
}

const openDatabases: DatabaseContext[] = [];

function setupSearch(): SearchHarness {
  const database = createDatabase(":memory:");
  openDatabases.push(database);
  database.db
    .insert(users)
    .values({ id: OWNER_ID, name: "Search Owner", createdAt: 1, updatedAt: 1 })
    .run();
  const repository = new Repository(database);
  repository.upsertAgent({
    id: AGENT_ID,
    name: "Search Bot",
    type: "mock",
    config: {},
    ownerId: OWNER_ID,
  });
  let sequence = 0;
  return {
    database,
    newConversation: (title) => repository.createConversation(title, "group", [AGENT_ID]),
    save: (conversationId, overrides = {}) => {
      sequence += 1;
      const message: Message = {
        id: `msg-${sequence}`,
        conversationId,
        fromType: "user",
        fromId: OWNER_ID,
        content: "",
        status: "done",
        timestamp: BASE_TIMESTAMP + sequence,
        ...overrides,
      };
      expect(repository.saveMessage(message)).toBe(true);
      return message;
    },
    search: (query, filters) => searchMessages(database, repository, query, filters),
  };
}

describe("searchMessages", () => {
  afterEach(() => {
    for (const database of openDatabases.splice(0)) database.sqlite.close();
  });

  describe("CJK LIKE path", () => {
    it("matches CJK substrings and returns fully mapped message and conversation objects", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("故障手册");
      const saved = save(conversation.id, {
        id: "msg-manual",
        fromType: "agent",
        fromId: AGENT_ID,
        toType: "user",
        toId: OWNER_ID,
        content: "部署故障排查手册 v2",
        threadId: "thread-manual",
        parentId: "msg-manual-parent",
        metadata: { model: "glm-5.3-highspeed" },
        timestamp: 1_234,
      });

      const [hit] = search("故障排查");

      expect(hit?.message).toEqual(saved);
      expect(hit?.before).toBeNull();
      expect(hit?.after).toBeNull();
      expect(hit?.conversation.id).toBe(conversation.id);
      expect(hit?.conversation.title).toBe("故障手册");
      expect(hit?.conversation.type).toBe("group");
      expect(hit?.conversation.agentIds).toEqual([AGENT_ID]);
      expect(hit?.conversation.pinned).toBe(false);
      expect(hit?.conversation.archived).toBe(false);
      expect(hit?.conversation.lastMessage).toBe("部署故障排查手册 v2");
    });

    it("escapes % so it only matches a literal percent sign", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("percent");
      const percent = save(conversation.id, { content: "进度50%完成了" });
      save(conversation.id, { content: "进度50x完成了" });

      // Unescaped, the pattern "50-anything-完" would also match 进度50x完成了.
      expect(search("50%完").map((result) => result.message.id)).toEqual([percent.id]);
    });

    it("escapes _ so it is matched literally instead of as a single-char wildcard", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("underscore");
      const underscore = save(conversation.id, { content: "a_b 文件名" });
      const free = save(conversation.id, { content: "axb 文件名" });

      expect(search("a_b 文件").map((result) => result.message.id)).toEqual([underscore.id]);
      expect(search("axb 文件").map((result) => result.message.id)).toEqual([free.id]);
    });

    it("escapes the escape character itself when the query contains a backslash", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("backslash");
      const windows = save(conversation.id, { content: "备份C:\\路径完成" });
      save(conversation.id, { content: "备份C:x路径完成" });

      expect(search("C:\\路").map((result) => result.message.id)).toEqual([windows.id]);
    });

    it("keeps wildcard escaping when CJK queries contain underscore placeholders", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("mixed");
      const literal = save(conversation.id, { content: "端口_检查通过" });
      const replaced = save(conversation.id, { content: "端口x检查失败" });

      expect(search("端口_检").map((result) => result.message.id)).toEqual([literal.id]);
      expect(search("端口x检").map((result) => result.message.id)).toEqual([replaced.id]);
    });

    it("orders LIKE hits newest first", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("order");
      const first = save(conversation.id, { content: "排序样本一", timestamp: 1_000 });
      const second = save(conversation.id, { content: "排序样本二", timestamp: 2_000 });
      const third = save(conversation.id, { content: "排序样本三", timestamp: 3_000 });

      expect(search("排序样本").map((result) => result.message.id)).toEqual([
        third.id,
        second.id,
        first.id,
      ]);
    });
  });

  describe("FTS path", () => {
    it("prefix-matches ASCII terms", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("fts-prefix");
      const postgres = save(conversation.id, { content: "PostgreSQL port 5432" });
      save(conversation.id, { content: "MySQL port 3306" });

      expect(search("Postgre").map((result) => result.message.id)).toEqual([postgres.id]);
    });

    it("ANDs multiple ASCII terms and rejects non-matching combinations", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("fts-and");
      const postgres = save(conversation.id, { content: "PostgreSQL port 5432" });
      const redis = save(conversation.id, { content: "Redis port 6379" });

      expect(search("postgresql 5432").map((result) => result.message.id)).toEqual([postgres.id]);
      expect(search("redis 6379").map((result) => result.message.id)).toEqual([redis.id]);
      expect(search("postgresql 9999")).toEqual([]);
    });

    it("survives double quotes in the query and still matches quoted content", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("fts-quote");
      const quoted = save(conversation.id, { content: 'he said "quote pending review' });
      save(conversation.id, { content: "plain text without markers" });

      expect(search('"quote').map((result) => result.message.id)).toEqual([quoted.id]);
    });

    it("orders FTS hits deterministically with created_at DESC as the tiebreak", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("fts-order");
      // Identical content ⇒ identical bm25 scores ⇒ the created_at DESC
      // tiebreak decides, mirroring the LIKE path's ordering.
      const first = save(conversation.id, { content: "deploy checklist", timestamp: 1_000 });
      const second = save(conversation.id, { content: "deploy checklist", timestamp: 2_000 });
      const third = save(conversation.id, { content: "deploy checklist", timestamp: 3_000 });

      expect(search("deploy").map((result) => result.message.id)).toEqual([
        third.id,
        second.id,
        first.id,
      ]);
    });
  });

  describe("filters", () => {
    it("restricts results to the filtered conversation", () => {
      const { newConversation, save, search } = setupSearch();
      const alpha = newConversation("alpha");
      const beta = newConversation("beta");
      save(alpha.id, { content: "会话过滤样本" });
      const betaHit = save(beta.id, { content: "会话过滤样本" });

      expect(search("会话过滤样本")).toHaveLength(2);

      const results = search("会话过滤样本", { conversationId: beta.id });

      expect(results.map((result) => result.message.id)).toEqual([betaHit.id]);
      expect(results[0]?.conversation.id).toBe(beta.id);
    });

    it("restricts results to agent-authored messages for the filtered agent", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("agent-filter");
      save(conversation.id, { content: "协同过滤样本 用户" });
      const agentHit = save(conversation.id, {
        fromType: "agent",
        fromId: AGENT_ID,
        content: "协同过滤样本 智能体",
      });

      expect(search("协同过滤样本")).toHaveLength(2);

      const results = search("协同过滤样本", { agentId: AGENT_ID });

      expect(results.map((result) => result.message.id)).toEqual([agentHit.id]);
      expect(results[0]?.message.fromType).toBe("agent");
      expect(results[0]?.message.fromId).toBe(AGENT_ID);
      expect(search("协同过滤样本", { agentId: "agent_missing" })).toEqual([]);
    });

    it("applies inclusive startDate/endDate boundaries", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("dates");
      const t1 = save(conversation.id, { content: "时间过滤样本", timestamp: 2_000 });
      const t2 = save(conversation.id, { content: "时间过滤样本", timestamp: 3_000 });
      const t3 = save(conversation.id, { content: "时间过滤样本", timestamp: 4_000 });

      const fromStart = search("时间过滤样本", { startDate: 3_000 });
      expect(fromStart.map((result) => result.message.id)).toEqual([t3.id, t2.id]);

      const toEnd = search("时间过滤样本", { endDate: 3_000 });
      expect(toEnd.map((result) => result.message.id)).toEqual([t2.id, t1.id]);

      const bracketed = search("时间过滤样本", { startDate: 3_000, endDate: 3_000 });
      expect(bracketed.map((result) => result.message.id)).toEqual([t2.id]);
    });

    it("clamps limit into [1, 200] while defaulting to 50", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("limit");
      save(conversation.id, { content: "限量样本" });
      const second = save(conversation.id, { content: "限量样本" });
      const third = save(conversation.id, { content: "限量样本" });

      expect(search("限量样本")).toHaveLength(3);
      expect(search("限量样本", { limit: 2 }).map((result) => result.message.id)).toEqual([
        third.id,
        second.id,
      ]);
      expect(search("限量样本", { limit: 1 }).map((result) => result.message.id)).toEqual([
        third.id,
      ]);
      // 999 is clamped down to 200 and bounded by the data, not truncated to 0.
      expect(search("限量样本", { limit: 999 })).toHaveLength(3);
      // 0 is clamped up to 1, so the newest hit still comes back.
      expect(search("限量样本", { limit: 0 }).map((result) => result.message.id)).toEqual([
        third.id,
      ]);
    });
  });

  describe("neighbour context", () => {
    it("resolves the previous and next message within the same conversation", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("context");
      const m1 = save(conversation.id, { content: "上下文甲", timestamp: 1_000 });
      const m2 = save(conversation.id, { content: "上下文乙", timestamp: 2_000 });
      const m3 = save(conversation.id, { content: "上下文丙", timestamp: 3_000 });

      const [head] = search("上下文甲");
      expect(head?.before).toBeNull();
      expect(head?.after?.id).toBe(m2.id);

      const [middle] = search("上下文乙");
      expect(middle?.before?.id).toBe(m1.id);
      expect(middle?.after?.id).toBe(m3.id);

      const [tail] = search("上下文丙");
      expect(tail?.before?.id).toBe(m2.id);
      expect(tail?.after).toBeNull();
    });

    it("breaks created_at ties by rowid when resolving neighbours", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("tie");
      const m1 = save(conversation.id, { content: "并列样本一", timestamp: 1_000 });
      const m2 = save(conversation.id, { content: "并列样本二", timestamp: 2_000 });
      const m3 = save(conversation.id, { content: "并列样本三", timestamp: 3_000 });
      // Inserted after m3, so a higher rowid despite sharing m2's timestamp.
      const m4 = save(conversation.id, { content: "并列样本四", timestamp: 2_000 });

      const [tie] = search("并列样本二");
      expect(tie?.before?.id).toBe(m1.id);
      expect(tie?.after?.id).toBe(m4.id);

      const [lateTie] = search("并列样本四");
      expect(lateTie?.before?.id).toBe(m2.id);
      expect(lateTie?.after?.id).toBe(m3.id);
    });

    it("never leaks messages from other conversations into before/after", () => {
      const { newConversation, save, search } = setupSearch();
      const alpha = newConversation("alpha-window");
      const beta = newConversation("beta-window");
      const a1 = save(alpha.id, { content: "跨会话甲一", timestamp: 1_000 });
      save(beta.id, { content: "跨会话乙二", timestamp: 2_000 });
      const a3 = save(alpha.id, { content: "跨会话甲三", timestamp: 3_000 });

      const [head] = search("跨会话甲一");
      expect(head?.before).toBeNull();
      expect(head?.after?.id).toBe(a3.id);
      expect(head?.after?.conversationId).toBe(alpha.id);

      const [tail] = search("跨会话甲三");
      expect(tail?.before?.id).toBe(a1.id);
      expect(tail?.after).toBeNull();

      const [isolated] = search("跨会话乙二");
      expect(isolated?.before).toBeNull();
      expect(isolated?.after).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("drops hits whose conversation row no longer exists", () => {
      const { database, newConversation, save, search } = setupSearch();
      const live = newConversation("live");
      save(live.id, { content: "孤儿会话 orphan survivor" });
      const doomed = newConversation("doomed");
      save(doomed.id, { content: "孤儿会话 orphan victim" });

      // messages.conversation_id has no ON DELETE cascade and
      // Repository.deleteConversation removes the messages together with the
      // conversation, so the orphan cannot be built through the repository.
      // Delete only the conversations row with FK enforcement disabled; the
      // message row and its trigger-maintained FTS entry survive.
      database.sqlite.pragma("foreign_keys = OFF");
      database.sqlite.prepare("DELETE FROM conversations WHERE id = ?").run(doomed.id);
      database.sqlite.pragma("foreign_keys = ON");
      const orphans = database.sqlite
        .prepare("SELECT id FROM messages WHERE conversation_id = ?")
        .all(doomed.id) as Array<{ id: string }>;
      expect(orphans).toHaveLength(1); // the hit still exists — search must drop it

      expect(search("孤儿会话").map((result) => result.message.conversationId)).toEqual([live.id]);
      expect(search("orphan").map((result) => result.message.conversationId)).toEqual([live.id]);
    });

    it("round-trips message metadata and keeps it undefined when absent", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("metadata");
      save(conversation.id, { content: "元数据往返 无", timestamp: 1_000 });
      save(conversation.id, {
        content: "元数据往返 有",
        timestamp: 2_000,
        metadata: { model: "glm-5.3-highspeed", tokensUsed: 42 },
      });

      const results = search("元数据往返");

      expect(results).toHaveLength(2);
      expect(results[0]?.message.metadata).toEqual({ model: "glm-5.3-highspeed", tokensUsed: 42 });
      expect(results[1]?.message.metadata).toBeUndefined();
    });

    it("returns an empty array for queries that match nothing", () => {
      const { newConversation, save, search } = setupSearch();
      const conversation = newConversation("empty");
      save(conversation.id, { content: "现存内容 present" });

      expect(search("完全不存在的词")).toEqual([]);
      expect(search("absentterm")).toEqual([]);
    });
  });
});

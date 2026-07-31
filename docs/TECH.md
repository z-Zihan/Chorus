# AgentLink — 技术设计文档

> 版本: v1.0 | 日期: 2026-07-31

## 1. 系统架构

```
┌──────────────────────────────────────────────────────────┐
│                      Browser (Frontend)                   │
│  React + Tailwind + Zustand + WebSocket Client           │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Agent 列表  │  │  消息流       │  │ A2A 详情面板  │     │
│  └────────────┘  └──────────────┘  └──────────────┘     │
└────────────────────────┬─────────────────────────────────┘
                         │ WebSocket (ws://localhost:3210)
┌────────────────────────▼─────────────────────────────────┐
│                   Server (Node.js)                        │
│  ┌──────────────────────────────────────────────────┐    │
│  │                    API Layer                      │    │
│  │  REST: /api/agents /api/conversations /api/messages  │
│  │  WS:   /ws (实时消息推送)                          │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │               Agent Runtime                       │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │    │
│  │  │ Adapter  │  │ A2A Bus  │  │ Scheduler│       │    │
│  │  │ Registry │  │ (消息路由)│  │ (任务队列)│       │    │
│  │  └──────────┘  └──────────┘  └──────────┘       │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │               Storage Layer                       │    │
│  │  SQLite (better-sqlite3) + 文件存储               │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

## 2. 技术栈

| 层 | 选型 | 版本 | 理由 |
|---|---|---|---|
| 前端框架 | React | 19 | 生态成熟，你熟悉 |
| 样式 | Tailwind CSS | 4 | 快速出活 |
| 状态管理 | Zustand | 5 | 轻量，比 Redux 简单 |
| 实时通信 | WebSocket (ws) | 8 | Node 原生支持，无依赖 |
| 后端框架 | Fastify | 5 | 比 Express 快，内置 TS 支持 |
| 数据库 | better-sqlite3 | 11 | 同步 API，零配置，性能好 |
| ORM | Drizzle ORM | 0.36 | 类型安全，轻量，SQLite 原生 |
| 构建工具 | Vite | 6 | 前端构建快 |
| Monorepo | pnpm workspace | 9 | 前后端统一管理 |
| 语言 | TypeScript | 5.5 | 全栈类型安全 |
| 运行时 | Node.js | 22 LTS | 稳定，长期支持 |

## 3. 项目结构

```
agentlink/
├── docs/                    # 文档
│   ├── PRD.md              # 产品需求文档
│   └── TECH.md             # 技术设计文档
├── packages/
│   ├── shared/             # 前后端共享类型和工具
│   │   ├── src/
│   │   │   ├── types/      # 类型定义
│   │   │   │   ├── message.ts
│   │   │   │   ├── agent.ts
│   │   │   │   ├── conversation.ts
│   │   │   │   └── index.ts
│   │   │   └── utils/      # 工具函数
│   │   └── package.json
│   ├── server/             # 后端服务
│   │   ├── src/
│   │   │   ├── index.ts            # 入口
│   │   │   ├── server.ts           # Fastify + WS 启动
│   │   │   ├── routes/             # REST API 路由
│   │   │   │   ├── agents.ts
│   │   │   │   ├── conversations.ts
│   │   │   │   └── messages.ts
│   │   │   ├── ws/                 # WebSocket 处理
│   │   │   │   ├── handler.ts
│   │   │   │   └── events.ts       # 事件类型定义
│   │   │   ├── agent/              # Agent 运行时
│   │   │   │   ├── adapter.ts      # Agent 适配器接口
│   │   │   │   ├── registry.ts     # Agent 注册中心
│   │   │   │   ├── runtime.ts      # Agent 执行运行时
│   │   │   │   ├── a2a-bus.ts      # A2A 消息总线
│   │   │   │   └── adapters/       # 具体 Agent 适配器
│   │   │   │       ├── openai.ts   # OpenAI API 适配器
│   │   │   │       ├── openclaw.ts # OpenClaw 适配器
│   │   │   │       ├── dify.ts     # Dify 适配器
│   │   │   │       └── mock.ts     # 测试用 Mock 适配器
│   │   │   ├── db/                 # 数据库
│   │   │   │   ├── schema.ts       # Drizzle schema
│   │   │   │   ├── index.ts        # 数据库实例
│   │   │   │   └── migrations/     # 迁移文件
│   │   │   └── config.ts           # 配置
│   │   ├── drizzle.config.ts
│   │   └── package.json
│   └── web/               # 前端
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── layout/          # 布局组件
│       │   │   │   ├── Sidebar.tsx       # Agent 列表侧栏
│       │   │   │   ├── ChatArea.tsx       # 消息流区域
│       │   │   │   ├── A2APanel.tsx       # A2A 详情面板
│       │   │   │   └── InputBar.tsx       # 输入框
│       │   │   ├── message/         # 消息组件
│       │   │   │   ├── MessageBubble.tsx
│       │   │   │   ├── MessageList.tsx
│       │   │   │   ├── A2AThread.tsx      # A2A 对话线程
│       │   │   │   └── TypingIndicator.tsx
│       │   │   ├── agent/           # Agent 组件
│       │   │   │   ├── AgentCard.tsx
│       │   │   │   ├── AgentList.tsx
│       │   │   │   └── AgentAvatar.tsx
│       │   │   └── common/          # 通用组件
│       │   ├── hooks/               # React Hooks
│       │   │   ├── useWebSocket.ts
│       │   │   ├── useAgent.ts
│       │   │   └── useConversation.ts
│       │   ├── store/               # Zustand 状态
│       │   │   ├── chatStore.ts
│       │   │   ├── agentStore.ts
│       │   │   └── conversationStore.ts
│       │   ├── services/            # API 调用
│       │   │   ├── api.ts
│       │   │   └── ws.ts
│       │   ├── styles/
│       │   │   └── globals.css
│       │   └── types/
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── .gitignore
└── README.md
```

## 4. 核心协议设计

### 4.1 Agent 适配器接口

```typescript
// packages/shared/src/types/agent.ts

interface AgentAdapter {
  /** Agent 元信息 */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly avatar?: string;

  /** 初始化（连接 API、加载配置等） */
  init(config: Record<string, unknown>): Promise<void>;

  /** 处理收到的消息，返回流式回复 */
  handleMessage(
    message: string,
    context: ConversationContext
  ): AsyncGenerator<StreamChunk, void, unknown>;

  /** 可选：处理 A2A 消息（被其他 Agent 调用） */
  handleA2ACall?(
    from: string,
    message: string,
    context: ConversationContext
  ): AsyncGenerator<StreamChunk, void, unknown>;

  /** Agent 配置（只读引用） */
  readonly config: Record<string, unknown>;
  /** 状态检查 */
  getStatus(): AgentStatus;
  /** 销毁 */
  destroy?(): void;
}

interface StreamChunk {
  type: "text" | "thinking" | "tool_call" | "file" | "done" | "error";
  content: string;
  metadata?: Record<string, unknown>;
  threadId?: string;           // A2A 调用链 ID，前端据此分组展示
  sourceAgentId?: string;      // 标识该 chunk 来自哪个 Agent，前端可区分渲染
}

// ⚠️ StreamChunk.type 只包含数据语义类型。
// task_card / orchestration 等 UI 概念属于前端渲染层，
// 由前端根据 StreamChunk 数据自行组装，不在协议中定义。

interface ConversationContext {
  conversationId: string;
  history: Message[];          // 已做截断处理（见下方策略）
  mentionedAgents?: string[];  // 被 @ 的其他 Agent
  a2aBus?: A2ABus;             // A2A 消息总线
  callStack?: string[];        // A2A 调用栈，用于环检测
  difyConversationId?: string; // Dify 适配器私有状态
}

/**
 * 上下文窗口管理：history 截断策略
 *
 * 策略 A（按条数）: 保留最近 N 条消息（默认 N=20）
 * 策略 B（按 token）: 估算 history 总 token 数，超出阈值时从最早消息开始裁剪
 *
 * 最终实现采用两者取小：N 条消息且总 token ≤ maxTokens
 */
interface HistoryTruncationConfig {
  maxMessages: number;     // 默认 20
  maxTokens: number;       // 默认 8000
}

function truncateHistory(
  history: Message[],
  config: HistoryTruncationConfig
): Message[] {
  // 1. 先按条数截断
  let result = history.slice(-config.maxMessages);

  // 2. 再按 token 估算裁剪（粗略：1 token ≈ 4 chars）
  const maxChars = config.maxTokens * 4;
  let totalChars = result.reduce((sum, m) => sum + m.content.length, 0);
  while (totalChars > maxChars && result.length > 1) {
    totalChars -= result[0].content.length;
    result = result.slice(1);
  }

  return result;
}

type AgentStatus = "online" | "offline" | "busy" | "error";
```

### 4.2 A2A 消息总线

```typescript
// packages/server/src/agent/a2a-bus.ts

interface A2ABus {
  /**
   * Agent A 向 Agent B 发送消息
   * - 调用 B 的 handleA2ACall
   * - 流式返回 B 的回复
   * - 全程通过 WebSocket 推送给前端展示
   */
  call(
    fromAgentId: string,
    toAgentId: string,
    message: string,
    context: ConversationContext
  ): AsyncGenerator<StreamChunk>;

  /** 广播：一个消息发给所有 Agent */
  broadcast(
    fromAgentId: string,
    message: string,
    context: ConversationContext
  ): Promise<StreamChunk[][]>;
}

/**
 * Agent 好友关系
 * - 两个 Agent 加为好友后可持续私聊协作
 * - 加好友需人类确认（安全约束）
 * - 好友关系持久化，重启后保留
 */
interface AgentFriendship {
  agentA: string;
  agentB: string;
  createdAt: number;
  confirmedBy: string;  // 确认人的 userId
}

// 好友请求流程：
// 1. Agent A 发起好友请求 → 通知 Agent B 的主人
// 2. 人类确认后，建立好友关系
// 3. 好友间 A2A 调用无需再次审批
class FriendshipRegistry {
  private friendships = new Map<string, Set<string>>();

  isFriend(a: string, b: string): boolean {
    return this.friendships.get(a)?.has(b) ?? false;
  }

  addFriend(a: string, b: string, confirmedBy: string): void {
    if (!this.friendships.has(a)) this.friendships.set(a, new Set());
    if (!this.friendships.has(b)) this.friendships.set(b, new Set());
    this.friendships.get(a)!.add(b);
    this.friendships.get(b)!.add(a);
  }
}

/**
 * A2A Bus 防护机制
 */
interface A2ABusOptions {
  maxDepth: number;          // 最大调用深度，默认 5
  chainTimeoutMs: number;    // 链总超时，默认 60000 (60s)
  maxConcurrency: number;    // 单个 Agent 同时被调用的上限，默认 3
}

// 默认防护参数
const DEFAULT_A2A_OPTIONS: A2ABusOptions = {
  maxDepth: 5,
  chainTimeoutMs: 60_000,
  maxConcurrency: 3,
};

// 调用栈追踪（环检测）
interface CallFrame {
  agentId: string;
  callId: string;
  startedAt: number;
}

// 环检测：A→B→A 直接拒绝
function detectCycle(callStack: CallFrame[], targetAgentId: string): boolean {
  return callStack.some(frame => frame.agentId === targetAgentId);
}

// 并发计数
const concurrencyMap = new Map<string, number>();  // agentId → 当前并发数
function acquireSlot(agentId: string, max: number): boolean {
  const cur = concurrencyMap.get(agentId) ?? 0;
  if (cur >= max) return false;
  concurrencyMap.set(agentId, cur + 1);
  return true;
}
function releaseSlot(agentId: string): void {
  const cur = concurrencyMap.get(agentId) ?? 0;
  if (cur <= 1) concurrencyMap.delete(agentId);
  else concurrencyMap.set(agentId, cur - 1);
}

// 用户中止：cancel 事件传播
// 当收到 ClientEvent { type: "cancel", messageId } 时，
// 向调用链中所有正在执行的 Agent 发送 AbortSignal
function propagateCancel(threadId: string): void {
  const controllers = threadControllers.get(threadId);
  if (!controllers) return;
  for (const c of controllers) c.abort();
  threadControllers.delete(threadId);
}

// call() 方法内部消费防护逻辑示例：
// async *call(from, to, message, context) {
//   // 1. 环检测
//   if (detectCycle(context.callStack ?? [], to)) {
//     yield { type: "error", content: `检测到循环调用: ${from} → ${to}` };
//     return;
//   }
//   // 2. 深度检查
//   if ((context.callStack?.length ?? 0) >= options.maxDepth) {
//     yield { type: "error", content: `超过最大调用深度 ${options.maxDepth}` };
//     return;
//   }
//   // 3. 并发检查
//   if (!acquireSlot(to, options.maxConcurrency)) {
//     yield { type: "error", content: `Agent ${to} 并发数已达上限` };
//     return;
//   }
//   // 4. 超时 + 执行
//   const timeoutController = new AbortController();
//   const timer = setTimeout(() => timeoutController.abort(), options.chainTimeoutMs);
//   try {
//     const targetAdapter = registry.getAdapter(to);
//     yield* targetAdapter.handleA2ACall(from, message, context);
//   } finally {
//     clearTimeout(timer);
//     releaseSlot(to);
//   }
// }
```

### 4.3 WebSocket 事件

```typescript
// 客户端 → 服务端
type ClientEvent =
  | { type: "message"; conversationId: string; content: string; mentionedAgents?: string[] }
  | { type: "typing"; conversationId: string; isTyping: boolean }
  | { type: "subscribe"; conversationId: string }
  | { type: "cancel"; messageId: string }
  | { type: "ping" };

// 服务端 → 客户端
type ServerEvent =
  | { type: "message"; eventId: string; message: Message }
  | { type: "stream"; eventId: string; messageId: string; chunk: StreamChunk }
  | { type: "a2a_call"; from: string; to: string; message: string; threadId: string }
  | { type: "a2a_response"; threadId: string; chunk: StreamChunk }
  | { type: "agent_status"; agentId: string; status: AgentStatus }
  | { type: "typing"; agentId: string; conversationId: string; isTyping: boolean }
  | { type: "error"; eventId: string; message: string }
  | { type: "pong"; eventId: string };
```

## 5. 数据库设计

```sql
-- 启用 WAL 模式（并发读写，避免读写锁）
PRAGMA journal_mode=WAL;

-- 启用外键约束
PRAGMA foreign_keys=ON;

-- Agent 注册表
-- 注意: agents.status 不持久化到数据库，只存在于内存 Registry 中。
-- 数据库只存静态配置，运行时状态由 AgentRegistry 在内存中维护。
CREATE TABLE agents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  avatar      TEXT,
  type        TEXT NOT NULL,           -- 'openai' | 'openclaw' | 'dify' | 'custom'
  config      TEXT,                    -- JSON: API key, model, system prompt 等
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- 会话表
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  type        TEXT DEFAULT 'dm',       -- 'dm' | 'channel' | 'group'
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- 会话-Agent 关联表
CREATE TABLE conversation_agents (
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  agent_id        TEXT NOT NULL REFERENCES agents(id),
  PRIMARY KEY (conversation_id, agent_id)
);

-- 消息表
CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  from_type       TEXT NOT NULL,       -- 'user' | 'agent'
  from_id         TEXT NOT NULL,
  to_type         TEXT,                -- 'user' | 'agent' (null = broadcast)
  to_id           TEXT,
  content         TEXT NOT NULL,
  thread_id       TEXT,                -- A2A 线程 ID
  parent_id       TEXT REFERENCES messages(id),
  status          TEXT DEFAULT 'done', -- 'sending' | 'thinking' | 'streaming' | 'done' | 'partial' | 'error'
  metadata        TEXT,                -- JSON
  created_at      INTEGER NOT NULL
);

-- 索引
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_thread ON messages(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX idx_messages_parent ON messages(parent_id) WHERE parent_id IS NOT NULL;
```

## 6. API 设计

### 6.1 REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/agents` | 获取所有 Agent |
| POST | `/api/agents` | 注册新 Agent |
| GET | `/api/agents/:id` | 获取 Agent 详情 |
| PATCH | `/api/agents/:id` | 更新 Agent 配置 |
| DELETE | `/api/agents/:id` | 删除 Agent |
| GET | `/api/conversations` | 获取会话列表 |
| POST | `/api/conversations` | 创建会话 |
| DELETE | `/api/conversations/:id` | 删除会话 |
| GET | `/api/conversations/:id/messages` | 获取会话消息历史 |
| POST | `/api/conversations/:id/messages` | 发送消息（非流式） |
| GET | `/api/health` | 健康检查 |

### 6.2 WebSocket

连接：`ws://localhost:3210/ws`

事件格式见 [4.3 WebSocket 事件](#43-websocket-事件)

### 6.2.1 断线重连策略

```typescript
// packages/web/src/services/ws.ts

class ReconnectingWebSocket {
  private ws: WebSocket | null = null;
  private lastEventId: string | null = null;
  private reconnectDelay = 1000;   // 初始 1s
  private maxReconnectDelay = 30000; // 最大 30s
  private heartbeatInterval = 30000; // 30s 心跳

  connect(url: string) {
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000; // 重置退避
      this.startHeartbeat();
      // 重连后补发遗漏的消息
      if (this.lastEventId) {
        this.send({ type: "subscribe", conversationId: this.currentConvId, lastEventId: this.lastEventId });
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.scheduleReconnect(url);
    };

    this.ws.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.eventId) this.lastEventId = event.eventId;
      this.handleEvent(event);
    };
  }

  // 心跳：每 30s 发送 ping，若 10s 内无 pong 则认为断线
  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
        // 设置 pong 超时检查
        this.pongTimeout = setTimeout(() => {
          this.ws?.close(); // 触发重连
        }, 10000);
      }
    }, this.heartbeatInterval);
  }

  private scheduleReconnect(url: string) {
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect(url);
    }, this.reconnectDelay);
  }
}
```

**服务端支持 last_event_id 补发：**

```typescript
// packages/server/src/ws/handler.ts
// 维护每个会话的最近事件环形缓冲区 (默认 100 条)
// 客户端重连时携带 lastEventId，服务端补发该 ID 之后的所有事件
ws.on("message", (data) => {
  const event = JSON.parse(data);
  if (event.type === "subscribe" && event.lastEventId) {
    const missed = eventBuffer.getAfter(event.conversationId, event.lastEventId);
    for (const e of missed) ws.send(JSON.stringify(e));
  }
});
```

**心跳协议：**
- 客户端每 30s 发送 `{ type: "ping" }`
- 服务端收到后立即回复 `{ type: "pong" }`
- 客户端 10s 内未收到 pong 则主动断开触发重连

## 7. 安全设计

| 层面 | 方案 |
|------|------|
| 认证 | MVP 单用户：user id 固定为 "user"，不启用认证；多用户场景启用 Bearer Token |
| CORS | 仅允许 localhost |
| 输入校验 | Zod schema 验证所有输入 |
| API Key 存储 | 加密存数据库，不明文返回 |
| SQL 注入 | Drizzle ORM 参数化查询 |

### 7.1 认证策略

**MVP 单用户场景（默认）：**

```typescript
// 单用户模式：user id 固定为 "user"，无需认证
const DEFAULT_USER_ID = "user";

// 所有请求默认绑定到 "user"
app.addHook("onRequest", async (req) => {
  req.userId = DEFAULT_USER_ID;
});
```

**多用户场景（可选启用）：**

```typescript
// 启用 Bearer Token 认证
interface AuthConfig {
  enabled: boolean;
  tokens: Map<string, string>;  // token → userId
}

// 中间件校验
app.addHook("onRequest", async (req, reply) => {
  if (!authConfig.enabled) {
    req.userId = "user";  // 单用户回退
    return;
  }

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing token" });
    return;
  }

  const token = auth.slice(7);
  const userId = authConfig.tokens.get(token);
  if (!userId) {
    reply.code(403).send({ error: "Invalid token" });
    return;
  }

  req.userId = userId;
});

// WebSocket 连接同样校验
wsServer.on("connection", (ws, req) => {
  const token = new URL(req.url, "http://localhost").searchParams.get("token");
  const userId = authConfig.tokens.get(token ?? "");
  if (!userId && authConfig.enabled) {
    ws.close(4001, "Unauthorized");
    return;
  }
  ws.userId = userId ?? "user";
});
```

## 8. 配置

```typescript
// packages/server/src/config.ts

interface Config {
  port: number;              // 默认 3210
  dbPath: string;            // 默认 ./data/agentlink.db
  cors: {
    origin: string[];        // 默认 ["http://localhost:5173"]
  };
  auth: {
    enabled: boolean;        // 默认 false
    token?: string;
  };
  agents: AgentConfig[];     // 预配置 Agent 列表
}

interface AgentConfig {
  id: string;
  name: string;
  type: "openai" | "openclaw" | "dify" | "cli" | "mock" | "custom";
  config: {
    apiKey?: string;
    model?: string;
    systemPrompt?: string;
    endpoint?: string;
    // ...各类型特有配置
  };
}
```

配置文件：`agentlink.config.ts`（项目根目录，TS 格式，类型安全）

## 9. 部署

### 本地开发

```bash
pnpm install
pnpm dev          # 同时启动前端 (5173) 和后端 (3210)
```

### 生产部署

```bash
pnpm build        # 构建前端 + 编译后端
pnpm start        # 启动服务，前端由后端静态托管
```

### Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm build
EXPOSE 3210
CMD ["node", "packages/server/dist/index.js"]
```

## 10. 关键实现细节

### 10.1 流式输出

```typescript
// Agent 回复通过 AsyncGenerator 流式输出
async function* handleUserMessage(msg: string, agent: AgentAdapter) {
  yield { type: "thinking", content: "" };  // 告诉前端 Agent 在思考

  for await (const chunk of agent.handleMessage(msg, context)) {
    // 通过 WebSocket 推送给前端
    ws.send({ type: "stream", messageId, chunk });
  }

  yield { type: "done", content: "" };
}
```

### 10.2 A2A 调用链追踪

```typescript
// 每次 Agent 间调用生成唯一 threadId
// 前端可通过 threadId 获取完整的调用链
interface A2ACall {
  threadId: string;        // 整个调用链共享
  callId: string;          // 单次调用唯一
  from: string;
  to: string;
  message: string;
  response?: string;
  startedAt: number;
  finishedAt?: number;
  childCalls?: A2ACall[];  // 嵌套调用
}
```

### 10.3 @提及解析

```typescript
// 输入: "@code-reviewer 帮我看看这段代码"
// 解析: { text: "帮我看看这段代码", mentionedAgents: ["code-reviewer"] }
function parseMentions(content: string): {
  text: string;
  mentionedAgents: string[];
} {
  const regex = /@(\w[\w-]*)/g;
  const mentionedAgents: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    mentionedAgents.push(match[1]);
  }
  // 去掉 @mention 部分，返回纯文本
  const text = content.replace(/@\w[\w-]*/g, "").replace(/\s+/g, " ").trim();
  return { text, mentionedAgents };
}
```

---

## 11. Agent 接入详解

### 11.1 接入原理

```
用户消息 → AgentLink Server → Agent Adapter → 实际 Agent 后端
                              ↑
                     统一接口，不管后端是什么
```

每个 Adapter 只需实现一个方法：收消息、返回流式回复。不管后端是 OpenAI、Dify、OpenClaw 还是自建服务，包一层 Adapter 就能接入。

### 11.2 接入类型

#### 类型一：裸 LLM API（最简单）

直接调 OpenAI / Claude / GLM 等 API：

```typescript
class OpenAIAdapter implements AgentAdapter {
  async *handleMessage(message: string, context: ConversationContext) {
    const stream = await openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: this.systemPrompt },
        ...context.history.map(m => ({
          role: m.fromType === "user" ? "user" : "assistant",
          content: m.content
        })),
        { role: "user", content: message },
      ],
      stream: true,
    });
    for await (const chunk of stream) {
      yield { type: "text", content: chunk.choices[0]?.delta?.content ?? "" };
    }
    yield { type: "done", content: "" };
  }
}
```

#### 类型二：OpenClaw Agent

通过 OpenClaw 的 session API 转发：

```typescript
class OpenClawAdapter implements AgentAdapter {
  async *handleMessage(message: string, context: ConversationContext) {
    const res = await fetch(`${this.endpoint}/api/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        sessionKey: this.sessionKey,
      }),
    });
    // 读取 SSE 流，转发给 AgentLink
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6));
          if (data.content) yield { type: "text", content: data.content };
        }
      }
    }
    yield { type: "done", content: "" };
  }
}
```

#### 类型三：Dify Agent

调 Dify 的 Chat API：

```typescript
class DifyAdapter implements AgentAdapter {
  async *handleMessage(message: string, context: ConversationContext) {
    const res = await fetch(`${this.endpoint}/chat-messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: message,
        user: "agentlink",
        conversation_id: context.difyConversationId ?? "",
        response_mode: "streaming",
      }),
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";
      for (const block of lines) {
        if (!block.startsWith("data: ")) continue;
        const data = JSON.parse(block.slice(6));
        if (data.event === "message" && data.answer) {
          yield { type: "text", content: data.answer };
        }
      }
    }
    yield { type: "done", content: "" };
  }
}
```

#### 类型四：自定义 Agent（任意 HTTP 服务）

任何能收 HTTP 请求的服务都能接：

```typescript
class CustomAgentAdapter implements AgentAdapter {
  async *handleMessage(message: string, context: ConversationContext) {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: context.history.map(m => ({
          role: m.fromType,
          content: m.content,
        })),
      }),
    });
    const data = await res.json();
    yield { type: "text", content: data.reply };
    yield { type: "done", content: "" };
  }
}
```

#### 类型五：本地函数 / LangChain.js

直接在进程内跑，不走 HTTP：

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";

class LangChainAdapter implements AgentAdapter {
  private model: ChatOpenAI;
  private prompt: ChatPromptTemplate;

  async init(config: Record<string, unknown>) {
    this.model = new ChatOpenAI({
      model: config.model as string,
      apiKey: config.apiKey as string,
      streaming: true,
    });
    this.prompt = ChatPromptTemplate.fromMessages([
      ["system", config.systemPrompt as string],
      ["human", "{input}"],
    ]);
  }

  async *handleMessage(message: string, context: ConversationContext) {
    const chain = this.prompt.pipe(this.model).pipe(new StringOutputParser());
    const stream = await chain.stream({ input: message });
    for await (const chunk of stream) {
      yield { type: "text", content: chunk };
    }
    yield { type: "done", content: "" };
  }
}
```

#### 类型六：CLI Agent（本机命令行工具）

通过子进程调用本机 CLI 工具（Codex、Claude Code 等），包装为 Agent：

```typescript
import { spawn } from "node:child_process";

class CLIAgentAdapter implements AgentAdapter {
  private command: string;
  private args: string[];
  private cwd: string;

  async init(config: Record<string, unknown>) {
    this.command = config.command as string;
    this.args = (config.args as string[]) ?? [];
    this.cwd = (config.cwd as string) ?? process.cwd();
  }

  async *handleMessage(message: string, context: ConversationContext) {
    yield { type: "thinking", content: "" };

    const child = spawn(this.command, [...this.args, message], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";
    for await (const chunk of child.stdout) {
      buffer += chunk.toString();
      // 按行输出，模拟流式
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) yield { type: "text", content: line + "\n" };
      }
    }

    // 输出剩余内容
    if (buffer.trim()) yield { type: "text", content: buffer };
    yield { type: "done", content: "" };
  }
}
```

> CLI 适配器让任何本机 Agent 工具（Codex、Claude Code、Copilot CLI）都能接入 AgentLink。

### 11.3 配置方式

用户在 `agentlink.config.ts` 中声明要接入哪些 Agent：

```typescript
import type { AgentConfig } from "@agentlink/shared";

export interface AppConfig {
  port: number;
  agents: AgentConfig[];
}

export default {
  port: 3210,
  agents: [
    {
      id: "gpt4",
      name: "GPT-4o",
      type: "openai",
      config: { apiKey: "sk-xxx", model: "gpt-4o", systemPrompt: "你是通用助手" },
    },
    {
      id: "glm",
      name: "GLM-5.2",
      type: "openai",  // OpenAI 兼容接口
      config: {
        apiKey: "xxx",
        model: "glm-5.2",
        endpoint: "https://open.bigmodel.cn/api/paas/v4",
        systemPrompt: "你是智谱 AI 助手",
      },
    },
    {
      id: "openclaw",
      name: "OpenClaw",
      type: "openclaw",
      config: { endpoint: "http://localhost:18789", sessionKey: "agent:main" },
    },
    {
      id: "dify-bot",
      name: "Dify Bot",
      type: "dify",
      config: { apiKey: "app-xxx", endpoint: "https://api.dify.ai/v1" },
    },
    {
      id: "claude-cli",
      name: "Claude CLI",
      type: "cli",
      config: { command: "/Users/zzihan/.local/node/bin/claude", args: ["-p"], cwd: "/path/to/project" },
    },
    {
      id: "codex-cli",
      name: "Codex CLI",
      type: "cli",
      config: { command: "/Users/zzihan/.local/node/bin/codex", args: ["exec", "-s", "read-only"], cwd: "/path/to/project" },
    },
    {
      id: "my-agent",
      name: "Custom Agent",
      type: "custom",
      config: { endpoint: "http://localhost:8080/chat" },
    },
  ],
} satisfies AppConfig;
```

### 11.4 A2A 通信触发方式

#### 方式一：用户 @提及

```
用户输入: @code-reviewer 帮我看看这段代码
```

解析逻辑：

见 §10.3 的 parseMentions 实现。→ 只路由给被 @ 的 Agent；没 @ 任何 Agent 时，路由给当前会话的活跃 Agent。

#### 方式二：Agent 主动调用其他 Agent

Agent 在处理消息时，通过 A2A Bus 调用其他 Agent：

```typescript
class OrchestratorAdapter implements AgentAdapter {
  async *handleMessage(message: string, context: ConversationContext) {
    yield { type: "thinking", content: "正在分析任务..." };

    // 自己先做一部分
    yield { type: "text", content: "我来帮你处理，先让安全检查 Agent 看看。\n\n" };

    // 通过 A2A Bus 调用另一个 Agent
    if (context.a2aBus) {
      for await (const chunk of context.a2aBus.call(
        this.id,           // from
        "security-checker", // to
        message,            // 传递的消息
        context
      )) {
        yield chunk;  // B 的回复也会流式推给用户
      }
    }

    yield { type: "text", content: "\n\n以上是安全检查结果。" };
    yield { type: "done", content: "" };
  }
}
```

#### A2A 调用链可视化

```
用户: 帮我审查这个 PR
  │
  ├─ @orchestrator 收到请求
  │   ├─ "正在分析任务..."
  │   │
  │   ├─ A2A → @code-reviewer
  │   │   └─ "发现 3 个代码质量问题"
  │   │
  │   ├─ A2A → @security-checker
  │   │   └─ "发现 1 个高危漏洞"
  │   │
  │   └─ "汇总：共 4 个问题，1 个高危..."
  │
  └─ 用户看到完整结果
```

UI 上 Agent 间的调用以可折叠线程展示，用户可以展开查看每次 A2A 调用的详细内容。

### 11.5 Adapter 注册流程

```
1. 读取 agentlink.config.ts
2. 遍历 agents 数组
3. 对每个 agent:
   a. 根据 type 创建对应 Adapter 实例
   b. 调用 adapter.init(config) 初始化（连接 API、加载配置）
   c. 注册到 AgentRegistry（内存中）
   d. 写入 SQLite agents 表（持久化）
4. 前端通过 GET /api/agents 获取已注册 Agent 列表
```

### 11.6 错误处理

| 场景 | 处理方式 |
|------|----------|
| Agent API Key 无效 | init() 抛错，Agent 状态设为 error，前端显示红色 |
| Agent 请求超时 | 30s 超时，返回 error chunk，消息标记为 error |
| Agent 后端不可达 | 重试 1 次，仍失败则返回 error |
| A2A 调用目标不存在 | 返回 error chunk，不影响主流程 |
| 流式中断 | 保存已收到的内容，标记为 partial |

---

## 12. A2A 触发机制设计（v0.2 架构预留，MVP 不实现）

### 12.1 设计目标

Agent 不依赖用户 @提及，而是通过 LLM tool-calling 自主决定何时调用其他 Agent。

用户只需用自然语言描述需求，Agent 在推理过程中判断是否需要其他 Agent 协助，自动发起 A2A 调用。

### 12.2 Agent 目录注入 System Prompt

启动时，Agent Registry 将所有已注册 Agent 的信息组装为目录文本，注入到每个支持 tool-calling 的 Agent 的 system prompt 中：

```typescript
// packages/server/src/agent/registry.ts

function buildAgentDirectory(excludeId: string): string {
  const agents = registry.list()
    .filter(a => a.id !== excludeId && a.getStatus() !== "offline");

  if (agents.length === 0) return "";

  const lines = agents.map(a =>
    `- id: "${a.id}", name: "${a.name}", description: "${a.description}"`
  );

  return `\n## 可调用的 Agent 目录\n\n你可以通过 call_agent 工具调用以下 Agent 协助完成任务:\n\n${lines.join("\n")}\n`;
}

// 注入到 system prompt
function buildSystemPrompt(agent: AgentAdapter): string {
  const base = agent.config.systemPrompt ?? "";
  const directory = buildAgentDirectory(agent.id);
  return base + directory;
}
```

### 12.3 Tool-Calling Schema 定义

将 `a2aBus.call` 包装为 LLM 可识别的 tool：

```typescript
// packages/server/src/agent/a2a-tool.ts

interface CallAgentTool {
  type: "function";
  function: {
    name: "call_agent";
    description: "调用另一个 Agent 处理子任务。仅在你判断需要其他 Agent 协助时调用。";
    parameters: {
      type: "object";
      properties: {
        target_agent_id: {
          type: "string";
          description: "目标 Agent 的 ID，参见 Agent 目录";
        },
        message: {
          type: "string";
          description: "传递给目标 Agent 的指令/问题";
        },
      };
      required: ["target_agent_id", "message"];
    };
  };
}

// 工具返回值（简化为文本摘要供 LLM 消费）
interface CallAgentToolResult {
  output: string;       // 目标 Agent 回复的拼接文本
  threadId: string;     // 调用链 ID
  success: boolean;
  error?: string;
}
```

### 12.4 运行时调用流程

```typescript
// packages/server/src/agent/runtime.ts

async function* handleMessageWithTools(
  agent: AgentAdapter,
  message: string,
  context: ConversationContext
): AsyncGenerator<StreamChunk> {
  const systemPrompt = buildSystemPrompt(agent);
  const tools = [CALL_AGENT_TOOL];

  const stream = await llm.chat.completions.create({
    model: agent.config.model,
    messages: [
      { role: "system", content: systemPrompt },
      ...context.history.map(m => ({
        role: m.fromType === "user" ? "user" : "assistant",
        content: m.content,
      })),
      { role: "user", content: message },
    ],
    tools,
    stream: true,
  });

  let toolCallPending = false;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;

    // 普通文本输出
    if (delta?.content) {
      yield { type: "text", content: delta.content, sourceAgentId: agent.id };
    }

    // LLM 决定调用 tool
    if (delta?.tool_calls) {
      toolCallPending = true;
      // 收集 tool call 参数（流式分片需要拼接）
      const toolCall = collectToolCall(delta.tool_calls);

      if (toolCall.function.name === "call_agent") {
        const args = JSON.parse(toolCall.function.arguments);

        yield {
          type: "tool_call",
          content: `调用 Agent: ${args.target_agent_id}`,
          sourceAgentId: agent.id,
          metadata: { tool: "call_agent", args },
        };

        // 执行 A2A 调用
        if (context.a2aBus) {
          const threadId = crypto.randomUUID();
          let resultText = "";

          for await (const subChunk of context.a2aBus.call(
            agent.id,
            args.target_agent_id,
            args.message,
            { ...context, callStack: [...(context.callStack ?? []), agent.id] }
          )) {
            if (subChunk.type === "text" && subChunk.content) {
              resultText += subChunk.content;
            }
            yield { ...subChunk, threadId, sourceAgentId: args.target_agent_id };
          }

          // 将结果喂回 LLM 继续推理
          // (实际实现中需要将 resultText 作为 tool result 发回 LLM)
        }
      }
    }
  }

  yield { type: "done", content: "" };
}
```

### 12.5 触发示例

```
用户: "帮我写一个用户注册接口，要包含输入校验和安全检查"

Agent (gpt4) 推理过程:
  1. 分析任务: 需要写代码 + 安全审查
  2. 发现 Agent 目录中有 "security-checker"
  3. 调用 call_agent(target="security-checker", message="审查以下注册接口的安全性...")
  4. 收到安全审查结果
  5. 根据反馈修改代码
  6. 输出最终结果
```

前端展示:

```
┌─────────────────────────────────────────┐
│ 🤖 GPT-4o                               │
│                                         │
│ 我来帮你写用户注册接口...                │
│                                         │
│ 🔧 调用 Agent: security-checker         │
│ ┌─────────────────────────────────────┐ │
│ │ 🤖 security-checker                 │ │
│ │ 该接口存在以下安全问题:              │ │
│ │ 1. 密码未加盐                        │ │
│ │ 2. 缺少速率限制                      │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ 根据安全建议，已修改...                  │
└─────────────────────────────────────────┘
```

## 12.5 广播模式（FUTURE — v0.3+）

Agent 可以向网络广播需求，其他 Agent 看到后可响应：

```typescript
// 广播：Agent 发需求到网络
interface BroadcastRequest {
  fromAgentId: string;
  message: string;           // "需要一个能做代码审查的 Agent"
  capabilities?: string[];   // 期望的能力标签
  deadline?: number;         // 超时时间
}

// 响应：其他 Agent 可以认领
interface BroadcastResponse {
  fromAgentId: string;
  toRequestId: string;
  message: string;           // "我可以做代码审查"
  accepted: boolean;
}
```

- 陌生 Agent 间的广播需经过 Server 审核（防垃圾消息）
- 好友间的广播直接送达，无需审核
- 类比：Agent 的"悬赏板"

## 12.6 分布式架构（FUTURE — v0.3+）

参考 EigenFlux 的设计：人人可做 Server/Client。

```
内网部署：局域网内协同（每台机器既是 Server 也是 Client）
公网部署：所有人都能连进来

┌──────────┐     ┌──────────┐     ┌──────────┐
│ Node A   │◄────┤  Relay   ├────►│ Node B   │
│ Server+  │     │  (任选   │     │ Server+  │
│ Client   │     │   一个)  │     │ Client   │
└──────────┘     └──────────┘     └──────────┘
      │                                │
      └────────── 共享上下文 ──────────┘
```

- 每个节点可独立运行，也可作为中继转发消息
- 上下文在节点间同步（CRDT 或操作日志）
- 内网模式无需公网暴露

## 13. 跨设备与跨团队 Agent 协作（FUTURE — v0.3+）

### 13.1 问题背景

当前设计是单机本地部署，但实际场景需要：

- **跨设备**：Agent1 在子涵的 Mac 上，Agent2 在同事的 Mac 上，两台机器的 Agent 需要互相通信
- **跨团队**：子涵的 Agent 排查出问题，自动 @小明 的 Agent 去修复，小明的 Agent 在另一台机器上

### 13.2 场景一：跨设备数据迁移

```
用户: "@Agent1 把你电脑上的数据整理一下，交接给 @Agent2"

子涵的 Mac                          同事的 Mac
┌──────────────┐                   ┌──────────────┐
│ @Agent1      │                   │ @Agent2      │
│ 1. 扫描数据   │ ──A2A 调用──→     │ 4. 接收文件   │
│ 2. 打包压缩   │                   │ 5. 解压存储   │
│ 3. 上传中转   │ ←──确认────────  │ 6. 回复完成   │
└──────────────┘                   └──────────────┘
        │                                  │
        └──────── AgentLink Server ─────────┘
                   (中转 + 寻址)
```

#### 执行流程

```
1. 用户发送: "@Agent1 把数据整理一下交接给 @Agent2"
2. AgentLink Server 解析 @提及，路由给 Agent1
3. Agent1 执行:
   a. 扫描本地目录，筛选需要迁移的数据
   b. 打包压缩为 zip
   c. 上传到 AgentLink Server 中转存储 (POST /api/files/upload)
   d. 获得 fileId
   e. 通过 A2A Bus 调用 Agent2:
      "数据迁移请求，fileId: {fileId}, 包含 {N} 个文件, 大小: {size}"
4. AgentLink Server 转发 A2A 调用到 Agent2 所在的设备
5. Agent2 执行:
   a. 从中转存储下载文件 (GET /api/files/{fileId})
   b. 解压到本地指定目录
   c. 校验文件完整性
   d. A2A 回复 Agent1: "接收完成，共 {N} 个文件，校验通过"
6. Agent1 回复用户: "✅ 数据已交接给 Agent2"
```

#### 需要新增的能力

| 能力 | 实现方式 |
|------|----------|
| 中转文件存储 | Server 提供 `/api/files/upload` 和 `/api/files/{id}` 接口，文件存本地磁盘或 R2 |
| Agent 寻址 | Agent 注册时声明所在设备 ID，Server 维护 `agentId → deviceId → connection` 路由表 |
| 跨设备消息转发 | Agent2 不在本地时，Server 通过长连接（WebSocket）转发到目标设备 |
| 文件传输协议 | A2A 消息支持 `fileAttachment` 类型，包含 fileId、fileName、size、checksum |

#### A2A 文件传输消息扩展

```typescript
// 扩展 StreamChunk，支持文件附件
interface StreamChunk {
  type: "text" | "thinking" | "tool_call" | "file" | "done" | "error";
  content: string;
  metadata?: Record<string, unknown>;
  // 新增：文件附件
  file?: {
    fileId: string;
    fileName: string;
    sizeBytes: number;
    checksum: string;  // SHA-256
    mimeType: string;
  };
}
```

#### Server 文件中转 API

```
POST /api/files/upload
  - multipart/form-data
  - 返回: { ok: true, data: { fileId, fileName, sizeBytes, checksum } }

GET /api/files/:fileId
  - 返回文件流 (支持 Range 请求)

DELETE /api/files/:fileId
  - 清理已下载的临时文件
```

### 13.3 场景二：跨团队 Agent 协作（群聊 @他人 Agent）

```
群聊: 构建发布群
┌──────────────────────────────────────────────────┐
│ 子涵: 帮我查一下构建为什么失败了                    │
│                                                   │
│ @zihan-agent (子涵的 Agent):                      │
│   → 读取构建日志，定位错误                          │
│   → git blame 找到责任人: 小明                     │
│   → 查 Agent 目录: 小明 → @xiaoming-agent          │
│   → A2A 调用: "xxx.ts:42 你提交的代码有问题"        │
│                                                   │
│ @xiaoming-agent (小明的 Agent):                    │
│   → 收到问题，checkout 对应分支                     │
│   → 定位问题，修改代码                              │
│   → git commit + push                             │
│   → A2A 回复: "已修复，commit: abc123"              │
│                                                   │
│ @zihan-agent:                                     │
│   → 触发重新构建                                    │
│   → 构建成功                                       │
│   → 群里回复: "✅ 问题已修复，构建成功"              │
└──────────────────────────────────────────────────┘
```

#### 执行流程

```
1. 用户在群聊发送: "帮我查一下构建为什么失败了"
2. Server 路由到群聊中活跃的 @zihan-agent

3. @zihan-agent 执行:
   a. 读取构建日志 (本地文件 / API 调用)
   b. 定位错误: xxx.ts:42 TypeError
   c. git blame xxx.ts → 发现第 42 行是小明提交的
   d. 查用户 → Agent 映射表: 小明 → @xiaoming-agent
   e. A2A 调用 @xiaoming-agent:
      "你在 xxx.ts:42 提交的代码导致构建失败，
       错误信息: TypeError: Cannot read property 'x' of undefined
       分支: main, commit: def456"

4. @xiaoming-agent 执行 (在小明的机器上):
   a. 收到 A2A 消息
   b. git checkout main && git pull
   c. 读 xxx.ts:42，定位问题
   d. 修改代码
   e. git commit -m "fix: resolve TypeError in xxx.ts:42"
   f. git push origin main
   g. A2A 回复 @zihan-agent:
      "已修复，commit: abc123，请重新构建"

5. @zihan-agent 收到回复:
   a. 触发重新构建
   b. 构建成功
   c. 群聊回复: "✅ 问题已修复，构建成功"

6. 整个 A2A 调用链在群聊中以可折叠线程展示
```

#### 需要新增的能力

| 能力 | 实现方式 |
|------|----------|
| **用户系统** | 用户注册/登录，每个用户绑定自己的 Agent |
| **Agent 目录** | `userId → agentId → deviceId` 映射，支持查找"某人的 Agent" |
| **群聊会话** | Conversation type="group"，多个用户 + 多个 Agent 共处一个会话 |
| **跨设备 A2A 转发** | Agent 不在本机时，Server 通过 WebSocket 转发到目标设备 |
| **权限/审批** | Agent 被调用时可配置：自动接受 / 需主人确认 / 拒绝 |
| **A2A 调用链展示** | 群聊中 Agent 间的调用以嵌套线程展示，可展开查看详情 |

### 13.4 多设备架构升级

单机 → 多设备需要 Server 升级为"中继站"角色：

```
┌──────────────────────────────────────────────────────────┐
│                  AgentLink Server (中继)                   │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐   │
│  │ Agent 目录   │  │ 文件中转存储  │  │ 消息路由表     │   │
│  │ user→agent  │  │ /files/*     │  │ agent→device  │   │
│  └─────────────┘  └──────────────┘  └───────────────┘   │
│         │                  │                │            │
│  ┌──────▼──────────────────▼────────────────▼──────┐     │
│  │            WebSocket 连接池                      │     │
│  │  device-1 (子涵)  ←→  device-2 (小明)  ←→  ...  │     │
│  └─────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────┘
     ↑ WebSocket                    ↑ WebSocket
┌─────┴──────┐               ┌──────┴─────┐
│ 子涵的 Mac  │               │ 小明的 Mac  │
│ @zihan-agent│               │@xiaoming   │
│ 本地 Agent  │               │-agent      │
│ 本地工具     │               │本地 Agent  │
│ 本地文件     │               │本地工具     │
└────────────┘               └────────────┘
```

#### 设备注册与连接

```typescript
// 设备连接时注册
interface DeviceConnection {
  deviceId: string;          // 设备唯一 ID
  userId: string;            // 所属用户
  deviceName: string;        // "子涵的 MacBook Pro"
  ws: WebSocket;             // 长连接
  agents: string[];          // 本设备上的 Agent ID 列表
  lastSeenAt: number;
}

// Server 维护路由表
// agentId → deviceId → DeviceConnection
// userId → [agentId, ...] → [DeviceConnection, ...]
```

#### 跨设备 A2A 调用流程

```
Agent1 发起 A2A 调用给 Agent2:

1. Agent1 (本地) → A2A Bus → Server
2. Server 查路由表: Agent2 → device-2
3. device-2 在线?
   ✅ 是: Server 通过 WebSocket 转发到 device-2
         device-2 的 Agent2 处理，流式回复原路返回
   ❌ 否: 返回 error "Agent2 所在设备离线"
4. 整个调用过程通过 WebSocket 推送给群聊展示
```

### 13.5 数据模型扩展

```sql
-- 用户表 (新增)
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE,
  avatar      TEXT,
  created_at  INTEGER NOT NULL
);

-- 设备表 (新增)
CREATE TABLE devices (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,        -- "子涵的 MacBook Pro"
  last_seen   INTEGER,
  created_at  INTEGER NOT NULL
);

-- Agent 表扩展 (增加 user_id 和 device_id)
ALTER TABLE agents ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE agents ADD COLUMN device_id TEXT REFERENCES devices(id);

-- Agent 目录: 用户名 → Agent 映射
-- 查询: 找到 "小明" 的 Agent
-- SELECT a.* FROM agents a JOIN users u ON a.user_id = u.id WHERE u.name = '小明';
```

### 13.6 权限与安全

跨设备/跨用户涉及安全问题，需要权限控制：

| 调用场景 | 权限策略 |
|---------|---------|
| 自己的 Agent 之间 A2A | ✅ 直接允许 |
| @群聊里他人的 Agent | ⚙️ 可配置：自动接受 / 需确认 / 拒绝 |
| Agent 修改代码并 push | ⚙️ 需主人确认（高敏感操作） |
| Agent 读取本地文件 | ⚙️ 需主人确认（首次） |
| Agent 跨设备传文件 | ⚙️ 需双方确认 |

#### 权限配置

```typescript
interface AgentPermission {
  agentId: string;
  // 谁可以调用这个 Agent
  allowCallFrom: "everyone" | "same-group" | "whitelist" | "nobody";
  whitelist?: string[];  // userId 列表
  // 敏感操作是否需要确认
  requireApproval: {
    codeModify: boolean;     // 修改代码
    fileAccess: boolean;     // 读取本地文件
    gitPush: boolean;        // 推送代码
    fileTransfer: boolean;   // 跨设备传文件
  };
}
```

#### 审批流程

```
@zihan-agent → A2A → @xiaoming-agent "帮我修复 xxx.ts"

→ @xiaoming-agent 收到请求
→ 检查权限: requireApproval.codeModify = true
→ 发送审批通知到小明:
  "🔔 Agent 被调用请求
   来自: @zihan-agent (子涵)
   操作: 修改 xxx.ts:42
   原因: 构建失败，代码 TypeError
   [同意] [拒绝]"
→ 小明点击同意
→ @xiaoming-agent 开始执行
```

### 13.7 共享上下文池

Agent 间协作时，上下文可以在好友/群聊内共享：

```typescript
interface SharedContext {
  scope: "friendship" | "group";  // 共享范围
  scopeId: string;                // 好友关系 ID 或群聊 ID
  messages: Message[];            // 共享的消息历史
  tasks: TaskTrackingCard[];      // 共享的任务状态
  createdAt: number;
}
```

- 好友间：A2A 调用时自动传递相关上下文
- 群聊内：所有 Agent 可看到群消息历史
- 私聊外：不泄露用户私聊内容

### 13.8 群聊消息路由

```typescript
// 群聊中的消息路由逻辑
function routeMessage(
  message: string,
  mentionedAgents: string[],
  conversation: Conversation
): string[] {
  // 1. 有 @提及 → 只路由给被 @ 的 Agent
  if (mentionedAgents.length > 0) {
    return mentionedAgents;
  }

  // 2. 没有 @ → 路由给群聊中所有在线 Agent
  return conversation.agentIds.filter(id =>
    registry.getStatus(id) === "online"
  );
}

// 群聊会话结构
interface GroupConversation extends Conversation {
  type: "group";
  participantUserIds: string[];   // 群里的用户
  participantAgentIds: string[];  // 群里的 Agent
}
```

---

### 13.9 标准协议兼容（FUTURE — v0.3+）

AgentLink 长期应兼容主流 Agent 通信标准：

| 协议 | 说明 | 兼容方式 |
|------|------|----------|
| Google A2A Protocol | Agent 间发现、认证、通信标准 | Adapter 层实现 A2A 兼容 |
| MCP (Model Context Protocol) | Agent 访问外部工具/数据源 | 工具层实现 MCP 兼容 |
| ACP (Agent Communication Protocol) | Agent 间消息格式标准 | 消息层映射 ACP 格式 |

> 短期使用私有协议快速迭代，v0.3 开始评估标准协议兼容。

## 14. 私聊为主、群聊为辅的交互设计（FUTURE — v0.2+）

### 14.1 架构模型

```
┌──────────────────────────────────────────────────────────┐
│                    用户视角                               │
│                                                          │
│  ┌────────────┐    ┌──────────────────────────────────┐  │
│  │  会话列表   │    │  私聊 (主场)                      │  │
│  │            │    │                                  │  │
│  │ 💬 我的Agent│───→│  你 ↔ @my-agent                  │  │
│  │ 👥 构建群   │    │                                  │  │
│  │ 👥 前端群   │    │  [群聊任务卡片嵌入展示]            │  │
│  │            │    │  [任务编排卡片嵌入展示]            │  │
│  └────────────┘    └──────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  群聊 (协作空间，按需进入)                         │    │
│  │  多用户 + 多 Agent                                │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### 14.2 私聊中的群聊任务卡片

Agent 在群聊执行操作时，私聊中实时展示任务追踪卡片：

```typescript
// 私聊消息类型扩展
interface TaskTrackingCard {
  type: "task_tracking";
  taskId: string;
  title: string;             // "修复构建失败"
  groupChatId: string;       // 关联的群聊 ID
  status: "pending" | "running" | "done" | "failed";
  steps: TaskStep[];
  createdAt: number;
  updatedAt: number;
}

interface TaskStep {
  id: string;
  label: string;             // "A2A 调用 @xiaoming-agent"
  status: "pending" | "running" | "done" | "failed";
  detail?: string;           // "已修复 abc123"
  startedAt?: number;
  finishedAt?: number;
  childSteps?: TaskStep[];   // 嵌套步骤
}

// WebSocket 事件扩展
type ServerEvent =
  | ... // 原有事件
  | { type: "task_update"; taskId: string; step: TaskStep; conversationId: string };
```

### 14.3 "代你出击"的实现

用户在私聊中说"去群里 @他"，Agent 的处理流程：

```typescript
// Agent 收到用户指令后的执行逻辑
async *handleMessage(message: string, context: ConversationContext) {
  // 1. 解析用户意图：这里有两种实现路径
  //    a) LLM tool-calling（推荐，见 §12）：Agent 通过 call_agent tool 自主决策
  //    b) 规则匹配（简单场景）：解析关键词如"去群里@谁"
  //    以下示例使用规则匹配，适用于 MVP 的 mock 场景
  const intent = parseIntent(message);
  // intent = { action: "group_call", target: "xiaoming-agent", group: "构建群", task: "修复 xxx.ts:42" }

  if (intent.action === "group_call") {
    yield { type: "text", content: `好的，正在群聊 @${intent.target}...` };

    // 2. 在群聊中创建消息
    const groupConvId = resolveGroupConversation(intent.group);
    yield { type: "task", content: "", metadata: { task: createTaskCard(intent) } };

    // 3. 通过 A2A Bus 调用目标 Agent（在群聊上下文中）
    for await (const chunk of context.a2aBus?.call(
      this.id,
      intent.target,
      intent.task,
      { ...context, conversationId: groupConvId }
    ) ?? []) {
      // 4. 实时更新任务卡片
      yield { type: "task_step", content: "", metadata: { step: { label: chunk.content, status: "running" } } };
    }

    yield { type: "text", content: "已完成，我来跟进后续..." };
  }

  yield { type: "done", content: "" };
}
```

### 14.4 会话模型

```typescript
// 私聊会话
interface PrivateConversation {
  type: "dm";
  userId: string;        // 用户
  agentId: string;       // 用户的 Agent
  // 私聊中可嵌入群聊任务卡片
  taskCards: TaskTrackingCard[];
}

// 群聊会话
interface GroupConversation {
  type: "group";
  name: string;                    // "构建发布群"
  participantUserIds: string[];    // 群里的用户
  participantAgentIds: string[];   // 群里的 Agent
}

// 会话列表
interface ConversationList {
  privateChats: PrivateConversation[];   // 和自己 Agent 的私聊
  groupChats: GroupConversation[];       // 群聊
}
```

### 14.5 前端界面设计

```
┌─────────────┬──────────────────────────────────────────┐
│  会话列表    │  私聊: 我的 Agent                         │
│             │                                          │
│ ┌─────────┐ │  ┌──────────────────────────────────────┐│
│ │💬我的Agent│ │  │ 你: 构建为什么失败了？                ││
│ │ 3 条新   │ │  │ Agent: xxx.ts:42 TypeError...        ││
│ └─────────┘ │  │ 你: 去群里 @小明                      ││
│ ┌─────────┐ │  │ Agent: 好的，已发起协作。              ││
│ │👥构建群  │ │  │ ┌────────────────────────────────┐  ││
│ │          │ │  │ │ 📋 群聊任务追踪            ✅   │  ││
│ └─────────┘ │  │ │ → A2A @xiaoming-agent        │  ││
│ ┌─────────┐ │  │ │ → 修复中... (45s)            │  ││
│ │👥前端群  │ │  │ │ → 已修复 commit: abc123     │  ││
│ │          │ │  │ │ → 重新构建 → ✅ 成功         │  ││
│ └─────────┘ │  │ │                    [查看群聊] │  ││
│             │  │ └────────────────────────────────┘  ││
│             │  │ Agent: ✅ 全部搞定                    ││
│             │  └──────────────────────────────────────┘│
│             │  ┌────────────────────────────────────┐  │
│             │  │ 输入消息...                    [发送]│  │
│             │  └────────────────────────────────────┘  │
└─────────────┴──────────────────────────────────────────┘
```

### 14.6 任务编排卡片

Agent 执行多步骤任务时，在私聊中展示编排进度：

```typescript
interface OrchestrationCard {
  type: "orchestration";
  taskId: string;
  title: string;              // "发布版本 1.2.0"
  steps: OrchestrationStep[];
  status: "running" | "done" | "failed";
}

interface OrchestrationStep {
  id: string;
  label: string;              // "构建 release-cn-signed"
  status: "pending" | "running" | "done" | "failed";
  durationMs?: number;
  result?: string;            // "成功 (12分30秒)"
  canSkip?: boolean;
  // 可选：该步骤涉及群聊 A2A 调用
  a2aCall?: {
    targetAgent: string;
    groupChatId: string;
  };
}
```

### 14.7 路由策略

```
用户在私聊中发送消息:
  → 默认路由给自己的 Agent
  → Agent 判断是否需要跨群聊协作
  → 需要: Agent 发起 A2A，结果回传私聊
  → 不需要: Agent 直接回复

用户在群聊中发送消息:
  → @某人Agent: 只路由给被@的Agent
  → 无@: 路由给群内所有在线Agent
  → Agent 回复在群聊中展示
```

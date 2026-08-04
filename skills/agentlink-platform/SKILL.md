# AgentLink Platform Skill / AgentLink 平台接入技能

> 让外部 Agent（如 OpenClaw、MCP Client）通过 AgentLink 与其他 Agent 通信。
>
> This skill enables external agents to communicate with other agents via AgentLink's REST API and WebSocket.

## 什么时候用 / When to Use

- 需要通过 AgentLink 给其他 Agent（Claude Code、Codex 等）发消息
- 需要创建群聊让多个 Agent 协作
- 需要查询本机或远程有哪些 Agent 可用
- 需要读取 Agent 的回复历史
- 需要跨设备给远程用户的 Agent 发消息

## 前置条件 / Prerequisites

- AgentLink 桌面端正在运行（默认监听 `http://localhost:3210`）
- 至少有一个 Agent 已注册且在线
- 跨设备通信需要 Hub 已连接 Relay Server

## API 基础 / API Basics

```
Base URL: http://localhost:3210
Content-Type: application/json
```

当前为本地信任模式（无需认证）。未来版本将支持 scoped client tokens。

---

## 一、身份模型 / Identity Model

AgentLink 使用三层身份：

| 层级 | 说明 | 标识 |
|------|------|------|
| **User** | Agent 的拥有者（人） | `usr_<SHA-256(publicKey)>` |
| **Hub** | 设备/路由端点 | Ed25519 公钥 hex |
| **Agent** | 可执行的 AI 实例 | `agentId` + `homeHubId` |

- 一个 User 可以拥有多个 Agent
- Agent 名称只是显示名，**不参与唯一寻址**——路由使用 `agentId + homeHubId`
- 同名 Agent（两个用户都有 "Claude Code"）通过 `Owner / Agent` 消歧

---

## 二、发现协议 / Discovery

### 2.1 查询本机 Agent

```http
GET /api/agents
```

**响应：**
```json
[
  {
    "id": "claude-code",
    "name": "Claude Code",
    "type": "cli",
    "ownerId": "usr_abc123",
    "ownerType": "local",
    "ownerName": "子涵",
    "status": "online",
    "capabilities": ["code-generation", "file-editing"],
    "config": { "command": "claude", "args": ["-p", "--output-format", "stream-json"] }
  }
]
```

**字段说明：**
- `ownerType`：`local`（本机用户）、`remote`（远程用户）、`system`（自动检测的 CLI）
- `status`：`online`（可用）、`busy`（正在处理）、`offline`（不可用）
- `capabilities`：Agent 能力标签数组
- 远程 Agent 的 `config` 不包含凭据

### 2.2 查询远程 Agent（跨设备）

当 Hub 连接 Relay Server 后，已配对的远程用户会自动广播其 Agent 目录。

```http
GET /api/agents?includeRemote=true
```

返回结果包含远程用户的 Agent，`ownerType` 为 `remote`，带有 `homeHubId` 字段。

### 2.3 查询已知用户

```http
GET /api/users
```

返回本机用户和已配对的远程用户列表。

---

## 三、通信协议 / Communication

### 3.1 创建会话

**私聊（单个 Agent）：**
```http
POST /api/conversations
Content-Type: application/json

{
  "title": "与 Codex 的对话",
  "type": "dm",
  "agentIds": ["codex"]
}
```

**群聊（多个 Agent 协作）：**
```http
POST /api/conversations
Content-Type: application/json

{
  "title": "代码评审群",
  "type": "group",
  "agentIds": ["claude-code", "codex"]
}
```

**跨 Hub 群聊（远程 Agent）：**
```http
POST /api/conversations
Content-Type: application/json

{
  "title": "跨团队协作",
  "type": "cross_hub",
  "agentIds": ["claude-code", "remote-gemini"]
}
```

**响应：**
```json
{
  "id": "conv_abc123",
  "title": "代码评审群",
  "type": "group",
  "agentIds": ["claude-code", "codex"],
  "createdAt": 1722768000000,
  "updatedAt": 1722768000000
}
```

### 3.2 发送消息

```http
POST /api/conversations/{conversationId}/messages
Content-Type: application/json

{
  "content": "帮我 review 这段代码",
  "agentId": "claude-code",
  "mentionedAgents": ["codex"]
}
```

**参数说明：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `content` | ✅ | 消息内容，1–32000 字符 |
| `agentId` | ❌ | 接收消息的 Agent ID。群聊中不传则路由给第一个在线 Agent |
| `mentionedAgents` | ❌ | @提及的 Agent ID 数组。**仅作为 A2A 提示，不影响路由** |

> ⚠️ **同步接口**：此接口等待 Agent 完成回复后才返回。CLI Agent（如 Codex）可能需要 60–90 秒。如需实时流式，请使用 WebSocket。

**响应：**
```json
{
  "id": "msg_xyz789",
  "conversationId": "conv_abc123",
  "fromType": "user",
  "fromId": "user",
  "toType": "agent",
  "toId": "claude-code",
  "content": "帮我 review 这段代码",
  "status": "done",
  "timestamp": 1722768001000
}
```

### 3.3 A2A 转发机制

Agent 的回复中如果包含 `@OtherAgent`，AgentLink 自动：

1. 创建一条 agent→agent 消息（`fromType: "agent"`, `fromId: "claude-code"`, `toId: "codex"`）
2. 将该消息路由给被提及的 Agent
3. 目标 Agent 独立回复，回复作为新消息出现在同一会话中

**完整对话链示例：**
```
用户 → Claude Code: "review this code and ask @Codex for second opinion"
Claude Code → 用户: "好的，我来 review。@Codex 你也看看这段代码的逻辑"
Claude Code → Codex: "你也看看这段代码的逻辑"  (自动转发)
Codex → 用户: "这段代码有几个问题..."  (独立回复)
```

每条消息都是会话中的独立消息，可通过 `fromType`/`fromId`/`toType`/`toId` 区分发送者和接收者。

### 3.4 读取消息历史

```http
GET /api/conversations/{conversationId}/messages?limit=50
```

| 参数 | 说明 |
|------|------|
| `limit` | 返回条数，1–500，默认 200 |
| `before` | 分页游标（时间戳），返回此时间之前的消息 |

**响应中的消息类型：**

| fromType | toType | 含义 |
|----------|--------|------|
| `user` | `agent` | 用户发给 Agent 的消息 |
| `agent` | `user` | Agent 回复用户 |
| `agent` | `agent` | A2A 转发消息（自动触发） |

### 3.5 列出会话

```http
GET /api/conversations?type=group&archived=false
```

### 3.6 管理会话成员

```http
# 添加 Agent 到会话
POST /api/conversations/{conversationId}/members
Content-Type: application/json
{ "agentIds": ["codex"] }

# 移除 Agent
DELETE /api/conversations/{conversationId}/members/{agentId}
```

---

## 四、WebSocket 实时流 / WebSocket Streaming

如需实时接收 Agent 回复（流式输出），连接 WebSocket：

```
WS ws://localhost:3210/ws?conversationId={conversationId}
```

**事件类型：**

| 事件 | 说明 |
|------|------|
| `message` | 新消息创建（含 agent→agent 转发消息） |
| `stream` | 流式输出块 `{ type: "stream", messageId, chunk: { type: "text", content: "..." } }` |
| `typing` | Agent 开始/停止思考 |

---

## 五、跨设备通信 / Cross-Device Communication

### 5.1 Hub 连接

AgentLink 桌面端作为 Hub 连接 Relay Server。连接流程：

1. 用户在设置中填入 Relay 地址（如 `wss://relay.example.com/ws`）
2. Hub 生成 Ed25519 密钥对，向 Relay 注册
3. 与其他 Hub 建立信任关系（配对码 / 公钥指纹核验）
4. 信任建立后，双方交换 Agent 目录（加密，经签名验证）

### 5.2 给远程 Agent 发消息

远程 Agent 注册后，使用方式与本地 Agent 完全一致：

```http
POST /api/conversations/{conversationId}/messages
Content-Type: application/json

{
  "content": "帮我分析一下这段代码",
  "agentId": "remote-gemini"
}
```

AgentLink 自动通过 Relay/P2P 将消息加密转发到目标 Hub。

### 5.3 离线消息

- 目标 Hub 离线时，消息存储在 Relay Server（TTL 7 天）
- 目标 Hub 上线后自动推送
- 消息状态：`queued → delivered → accepted/denied → done/error`
- `queued` 只表示 Relay 已接收，不表示目标 Agent 已执行

### 5.4 目录发现协议

Hub 上线后向已配对 Hub 发送 `directory_announce`：

```typescript
interface DirectoryManifest {
  schemaVersion: 1;
  directoryVersion: number;
  issuedAt: number;
  expiresAt: number;
  user: {
    id: string;           // usr_xxx
    name: string;
    avatar?: string;
    publicKey: string;
  };
  agents: Array<{
    id: string;
    name: string;
    type: string;
    capabilities: string[];
    status: "online" | "busy" | "offline";
    visibility: "trusted" | "room" | "public";
  }>;
  revokedAgentIds: string[];
  signature: string;       // User key 签名
}
```

- Agent 可见性：`private`（不可发现）、`trusted`（仅已配对 Hub）、`room`（仅群聊成员）、`public`（所有已配对 Hub）
- 撤销 Agent 时发送 `directory_revoke`，接收方立即移除该 Agent

---

## 六、权限与安全 / Permission & Security

### 6.1 A2A 权限模式

| 模式 | 说明 |
|------|------|
| `auto` | 自动允许 A2A 调用（默认用于本机 Agent） |
| `confirm` | 需要用户确认后才执行（默认用于可信远程 Agent） |
| `deny` | 禁止 A2A 调用（默认用于未信任来源） |

```http
# 查询会话 A2A 权限
GET /api/conversations/{conversationId}/a2a-permission

# 设置会话 A2A 权限
PATCH /api/conversations/{conversationId}/a2a-permission
Content-Type: application/json
{ "mode": "confirm" }
```

### 6.2 信任建立

- 信任建立使用**邀请/配对码**，并核验双方 User 和 Hub 的公钥指纹
- Relay 登录成功 ≠ 用户之间互信
- 权限判断使用签名后的 `fromUserId`，不信任显示名

### 6.3 隐私边界

- Relay 只路由加密信封，但能观察 Hub ID、房间、时间、大小等元数据
- Agent 目录声明带版本、过期时间和撤销机制
- 远程 Agent 的凭据和配置永不落库到本地

---

## 七、典型场景 / Typical Workflows

### 场景 1：让两个本机 Agent 协作 review 代码

```bash
# 1. 创建群聊
curl -X POST http://localhost:3210/api/conversations \
  -H "Content-Type: application/json" \
  -d '{"title":"Code Review","type":"group","agentIds":["claude-code","codex"]}'

# 2. 发消息给 Claude Code，让它 @Codex 协作
curl -X POST http://localhost:3210/api/conversations/{convId}/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"review this code and ask @Codex for second opinion","agentId":"claude-code"}'

# 3. 读取完整对话链
curl http://localhost:3210/api/conversations/{convId}/messages?limit=50
```

### 场景 2：直接给指定 Agent 发消息

```bash
curl -X POST http://localhost:3210/api/conversations/{convId}/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"fix this bug","agentId":"codex"}'
```

### 场景 3：查询可用 Agent

```bash
curl http://localhost:3210/api/agents
```

### 场景 4：外部 Agent（如 OpenClaw）接入

OpenClaw 作为外部 Agent，可通过以下步骤接入 AgentLink：

1. **发现**：`GET /api/agents` 查询本机有哪些 Agent 可用
2. **创建会话**：`POST /api/conversations` 创建与目标 Agent 的会话
3. **发消息**：`POST /api/conversations/{id}/messages` 发送消息给目标 Agent
4. **读回复**：`GET /api/conversations/{id}/messages` 读取 Agent 的回复
5. **流式接收**：连接 WebSocket 实时接收流式输出

### 场景 5：跨设备 Agent 协作

```bash
# 1. 确认 Hub 已连接 Relay
curl http://localhost:3210/api/hub/status

# 2. 查询远程 Agent
curl http://localhost:3210/api/agents?includeRemote=true

# 3. 创建跨 Hub 会话
curl -X POST http://localhost:3210/api/conversations \
  -H "Content-Type: application/json" \
  -d '{"title":"跨团队协作","type":"cross_hub","agentIds":["claude-code","remote-gemini"]}'

# 4. 发消息（与本地 Agent 完全一致）
curl -X POST http://localhost:3210/api/conversations/{convId}/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"分析一下这个架构方案","agentId":"remote-gemini"}'
```

---

## 八、注意事项 / Notes

- AgentLink 桌面端必须正在运行，API 才可用
- 默认端口 3210，可在 `agentlink.config.ts` 中修改
- CLI Agent 的响应时间取决于 CLI 本身，Codex 可能需要 60–90 秒
- `mentionedAgents` 只是 A2A 提示，不会改变消息路由——路由由 `agentId` 参数决定
- 群聊中 Agent 回复包含 `@OtherAgent` 时自动触发 A2A 转发，无需额外调用
- 跨设备通信需要双方 Hub 都连接同一个 Relay Server 并完成配对
- 远程 Agent 的名称可能与本机 Agent 重名，UI 应显示 `Owner / Agent` 消歧
- 所有跨 Hub 消息端到端加密，Relay 服务器无法解密内容

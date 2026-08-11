# Chorus 跨用户通信架构设计

> 最后更新：2026-08-04

> 实现状态：`packages/relay` 已包含 Relay Server、Hub 注册、WebSocket 路由、离线消息和 Room 基础；`packages/server` 已有 Hub Client/P2P/E2E 代码。本文定义的新目标是“Contact → Room → owner-authorized Agent”。现有自动目录交换和直接远程 Agent 入口属于待迁移行为，不能作为新流程继续扩展。
>
> Target model: pairing creates a contact, rooms contain people, and each owner explicitly brings their own agents into a room. Transport readiness does not imply product-level authorization.

## 1. 架构总览

### 三种通信模式

```
模式一：Relay Server（公网部署）
┌──────────┐         ┌─────────────┐         ┌──────────┐
│  Hub A   │◄═══════►│ Relay Server │◄═══════►│  Hub B   │
│ (用户A)  │  WSS    │  (公网VPS)   │  WSS    │ (用户B)  │
└──────────┘         └─────────────┘         └──────────┘
                     · 离线消息存储
                     · 群聊扇出
                     · Hub 寻址（不提供 Agent 全局发现）

模式二：P2P（内网直连）
┌──────────┐                    ┌──────────┐
│  Hub A   │◄═════════════════►│  Hub B   │
│ (用户A)  │  WS (mDNS发现)    │ (用户B)  │
└──────────┘                    └──────────┘
  · 零延迟 (LAN < 1ms)
  · 无需公网
  · mDNS/Bonjour 自动发现

模式三：Hybrid（混合）
┌──────────┐         ┌─────────────┐         ┌──────────┐
│  Hub A   │◄──P2P──►│  Hub B      │◄═══════►│  Hub C   │
│          │  (LAN)  │             │  Relay  │ (远程)   │
└──────────┘         └─────────────┘         └──────────┘
  · 同局域网走 P2P (< 1ms)
  · 跨网络走 Relay (~50ms)
  · 自动选择最优路径
```

### 组件架构

```
┌─────────────────────────────────────────────────────┐
│              Chorus Desktop (Tauri)               │
│  ┌───────────────────────────────────────────────┐  │
│  │              Frontend (React)                  │  │
│  │  · 连接状态指示器 (P2P/Relay/离线)            │  │
│  │  · 联系人与 Room 列表                         │  │
│  │  · 人类成员 / Agent 成员分离的聊天室 UI       │  │
│  └───────────────────┬───────────────────────────┘  │
│  ┌───────────────────▼───────────────────────────┐  │
│  │            Local Hub Server (Fastify)          │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │ Agent    │ │ A2A Bus  │ │ Hub Client   │  │  │
│  │  │ Runtime  │ │ (本地)   │ │ (跨Hub通信)  │  │  │
│  │  └──────────┘ └──────────┘ └──────┬───────┘  │  │
│  │  ┌──────────────────────────────┐ │           │  │
│  │  │ P2P Listener (mDNS + WS)     │◄┘           │  │
│  │  └──────────────────────────────┘             │  │
│  └───────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │ WSS
┌──────────────────────▼──────────────────────────────┐
│              Relay Server (公网 VPS)                  │
│  ┌──────────┐ ┌──────────┐ ┌────────────────────┐  │
│  │ Hub Reg  │ │ Message  │ │ Offline Store      │  │
│  │ (认证)   │ │ Router   │ │ (SQLite, TTL 7天)  │  │
│  └──────────┘ └──────────┘ └────────────────────┘  │
│  ┌──────────────────────────────────────────────┐  │
│  │ Room Manager (群聊)                          │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## 2. User 与 Hub 身份 / User and Hub Identity

User、Hub、Agent 必须分层：User 是拥有者，Hub 是设备/路由端点，Agent 是可调用执行者。Relay 认证 Hub 是否可连接，不证明某个 User 可以调用另一个 User 的 Agent。

### 密钥对

- 算法：Ed25519 (libsodium)
- 首次启动时生成密钥对，存储在 `data/hub-keypair.json`
- Hub ID = Ed25519 公钥完整 hex；UI 仅将前 8 位作为短指纹
- 显示名：用户自定义，不唯一

本机另生成 User Ed25519 密钥并存入系统钥匙串；`userId = usr_<base64url(SHA-256(userPublicKey))>`。一个 User 可通过已实现的 `user_hubs` 表绑定多个 Hub；每个绑定对象同时由 User key 和对应 Hub key 签名：

```typescript
interface UserHubBinding {
  userId: string;
  userPublicKey: string;
  hubId: string;
  issuedAt: number;
  expiresAt: number;
  userSignature: string;
  hubSignature: string;
}
```

### Relay 注册

```
POST /api/hubs/challenge
{
  "hubId": "a1b2c3...",
  "publicKey": "full-ed25519-public-key-hex",
  "displayName": "子涵的 Hub"
}

Response: `{ challengeId, nonce, hubId, publicKey, displayName, expiresAt, purpose }`。
Hub 用对应 Ed25519 私钥对完整响应做 JCS 签名，然后提交：

```
POST /api/hubs/register
{
  "challengeId": "...",
  "signature": "<base64-ed25519-signature>"
}

Response:
{
  "token": "relay-jwt-token",
  "expiresInSeconds": 86400,
  "relayHubId": "relay-assigned-uuid"
}
```

挑战默认两分钟过期且只能消费一次。JWT 包含 `exp` 与持久化认证版本；重新注册会轮换版本并使旧 Token 失效。Relay 默认只监听 `127.0.0.1`；设置非 loopback `RELAY_HOST` 时必须显式提供至少 32 字符的 `RELAY_JWT_SECRET`。

### Hub 间互认证

1. Hub A 通过 Relay/邀请获取 Hub B 的 Ed25519 公钥并核验指纹。
2. 双方交换随机 challenge，各自用 Hub 私钥签名 `challenge + 两端 Hub ID + timestamp`。
3. 双方验证签名和 5 分钟时间窗口，再把 Ed25519 key 转换为 X25519 建立加密通道。
4. UserHubBinding 通过双签名验证后，才把 Hub 上的目录归属于 User。

**English summary:** A User owns agents and may bind multiple device Hubs through the implemented `user_hubs` table. A Hub authenticates a device transport, and both the User key and that Hub's key sign each binding.

## 3. 消息协议

### 消息信封

```typescript
interface HubEnvelope {
  id: string;            // UUID v7 (时序可排序)
  from: string;          // 发送方 Hub ID
  to: string;            // 接收方 Hub ID | "room:xxx" | "broadcast"
  type: "direct" | "group" | "broadcast" | "presence" | "discovery";
  timestamp: number;     // 发送方 Unix ms
  nonce: string;         // 防重放 (base64, 24 bytes)
  ciphertext: string;    // 加密后的 payload (base64)
  signature: string;     // 发送方 Ed25519 签名 (base64)
}

// 解密后的 payload
interface HubPayload {
  protocolVersion: 2;
  messageType:
    | "chat" | "a2a_call" | "a2a_response" | "agent_status" | "typing"
    | "contact_request" | "contact_accept" | "contact_block"
    | "room_invite" | "room_accept" | "room_leave"
    | "room_agent_upsert" | "room_agent_remove"
    | "directory_request" | "directory_announce" | "directory_revoke"
    | "delivery_ack";
  conversationId?: string;
  messageId: string;
  content?: string;
  fromUserId: string;
  fromUserName: string;  // 仅展示，禁止用于授权
  toUserId?: string;     // 房间/目录消息可省略
  fromAgentId?: string;
  toAgentId?: string;
  directory?: DirectoryManifest;
  metadata?: Record<string, unknown>;
}
```

接收方先验证 envelope 的 Hub 签名，再解密 payload，再验证 UserHubBinding/DirectoryManifest 的 User 签名，最后执行权限策略。任一 ID、签名、绑定或目录版本不一致即拒绝；不得用 `fromUserName` 或 Agent 显示名回退寻址。

`contact_*`、`room_*` 和 `directory_*` 是不同授权域。`contact_accept` 之后不得自动发送 `directory_request`；`room_accept` 只加入人类成员；只有所有者签名的 `room_agent_upsert` 才创建 Room 内的远程 Agent 能力。

**English:** Contact acceptance, room acceptance, and room-agent admission are separate signed events. None implies the next. In particular, pairing never triggers directory synchronization.

### 直连与成对加密方案 / Direct and pairwise encryption

- **算法**：libsodium `crypto_box` (X25519 + XSalsa20-Poly1305)
- **流程**：
  1. Hub A 用 Hub B 的 X25519 公钥 + 自己的私钥生成共享密钥
  2. 用共享密钥加密 payload → ciphertext
  3. 用自己的 Ed25519 私钥签名 envelope → signature
- **Relay 无法解密**：只有 ciphertext 和元数据经过 Relay
- **离线消息**：Relay 存储 ciphertext，等接收方上线后投递

此方案用于 Hub 直连消息、逐成员 fallback 和 Room 群组密钥分发；Room 正文的 v1 默认加密方案是 §7 定义的 `GroupKeyManager` AES-256-GCM。

**English:** `crypto_box` protects direct Hub messages, the per-member fallback, and Room group-key distribution. Room content uses the `GroupKeyManager` AES-256-GCM group key by default in v1, as specified in §7.

### 消息去重

- 每条消息有唯一 `id` (UUID v7)
- 接收方维护最近 1000 个 message ID 的 LRU 缓存
- 重复 ID 直接丢弃

## 4. Relay Server 设计

### 技术方案

- **包路径**：`packages/relay/` (独立 npm 包)
- **技术栈**：Node.js 22 + Fastify 5 + WebSocket + SQLite
- **部署**：Docker + docker-compose

### WebSocket 协议

```
Hub → Relay:
  { type: "register", hubId, token }
  { type: "message", envelope: HubEnvelope }
  { type: "presence", status: "online"|"offline" }
  { type: "room:join", roomId }
  { type: "room:leave", roomId }
  { type: "ping" }

Relay → Hub:
  { type: "registered", relayHubId }
  { type: "message", envelope: HubEnvelope }
  { type: "offline_messages", envelopes: HubEnvelope[] }
  { type: "presence", hubId, status }
  { type: "room:event", roomId, event, hubId }
  { type: "pong" }
```

### REST API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/hubs/register` | POST | 注册 Hub，返回 JWT |
| `/api/hubs/:id` | GET | 获取 Hub 公钥和信息 |
| `/api/hubs/discover` | POST | 按 Hub ID 查询在线状态 |
| `/api/rooms` | POST | 创建群聊房间 |
| `/api/rooms/:id` | GET | 获取房间信息 + 成员列表 |
| `/api/rooms/:id/join` | POST | 使用已接受的邀请加入房间 |
| `/api/rooms/:id/leave` | POST | 离开房间 |
| `/api/rooms/:id/invite` | POST | 邀请 Hub 加入 |
| `/api/health` | GET | 健康检查 |

Relay API 只管理 Hub 路由和加密 Room 信封，不能决定某个用户是否有权添加或调用 Agent。Local Hub API 才负责联系人、邀请、Owner 校验和本地会话映射：

| Local Hub 端点 | 方法 | 语义 / Semantics |
|----------------|------|------------------|
| `/api/hub/config` | PATCH | 验证并保存 Relay 配置，返回 `{ ok, config, connectionState }` 后异步连接 |
| `/api/hub/status` | GET | 返回 `disconnected/connecting/connected/reconnecting/error` 和最近错误 |
| `/api/trust/pair` | POST | 按完整 Hub ID 创建目标绑定、10 分钟有效的一次性配对包；不请求 Agent 目录 |
| `/api/trust/pairing-sessions/accept` | POST | 接收配对包并启动双端密钥确认 |
| `/api/trust/pairing-sessions/:id/approve` | POST | SAS 核对后本端明确批准；双方批准才创建 Contact |
| `/api/trust/pairing-sessions/:id/cancel` | POST | 取消未完成配对 |
| `/api/contacts` | GET | 只列出联系人名片和 presence |
| `/api/rooms` | POST | 创建 `direct` 或 `group` Room，并建立 `type=room` 本地会话 |
| `/api/rooms/:id/invitations` | POST | 邀请已配对联系人 |
| `/api/rooms/:id/invitations/:inviteId/accept` | POST | 被邀请者明确接受 |
| `/api/rooms/:id/agents` | POST | 仅所有者把自己的 `room/public` Agent 加入 Room |
| `/api/rooms/:id/agents/:agentId` | DELETE | 所有者或 Room 管理员移出；只有所有者可以再次加入 |

**English:** Relay endpoints transport encrypted membership events. Local Hub endpoints enforce contact state, invitation acceptance, room roles, agent ownership, visibility, and conversation mapping.

### 离线消息

- Relay 维护 SQLite `offline_messages` 表
- 消息到达时接收方不在线 → 存入 offline store
- 接收方上线 → 批量推送；Hub 持久化成功后发送 `delivery_ack`，Relay 再删除对应记录
- TTL 默认 7 天；过期后向发送方返回 `expired`（若发送方仍可达），客户端不得长期显示 `queued`
- 同一会话按发送方 sequence 排序，目录 revoke 优先于较旧 announce；接收端按 message ID 幂等
- 加密存储：Relay 只存 ciphertext，无法解密

离线排队只表示 Relay 已接收，不表示目标 Agent 已执行。消息状态依次为 `queued → delivered → accepted/denied → done/error`。

### 部署

```yaml
# docker-compose.yml
services:
  chorus-relay:
    image: chorus/relay:latest
    ports:
      - "3211:3211"
    volumes:
      - relay-data:/data
    environment:
      - RELAY_PORT=3211
      - RELAY_JWT_SECRET=your-secret
      - RELAY_OFFLINE_TTL_DAYS=7
      - RELAY_MAX_HUBS=1000

volumes:
  relay-data:
```

```bash
# 一键自部署
docker run -d -p 3211:3211 -v relay-data:/data \
  -e RELAY_JWT_SECRET=your-secret \
  chorus/relay:latest
```

### 扩展性

- v1：单实例，支持 ~1000 Hub 同时在线
- v2：Redis pub/sub 多实例，水平扩展
- v3：Kubernetes 部署 + 负载均衡

### User/Agent 目录发现 / Directory Discovery

Relay 不建立可搜索的明文用户或 Agent 目录。**配对成功和 Hub 上线都不触发 Agent 目录交换。** 联系人只同步最小 User Card（User ID、显示名、头像、Hub 指纹和 presence），Agent Card 必须由所有者按范围主动发布。

```typescript
interface DirectoryManifest {
  schemaVersion: 1;
  directoryVersion: number;
  issuedAt: number;
  expiresAt: number;
  scope: "contact" | "room";
  roomId?: string;              // scope=room 时必填
  binding: UserHubBinding;
  user: {
    id: string;
    name: string;
    avatar?: string;
    publicKey: string;
  };
  agents: Array<{
    id: string;                  // Hub 内稳定 sourceAgentId
    name: string;
    description?: string;
    type: string;
    capabilities: string[];
    status: "online" | "busy" | "offline" | "error";
    visibility: "room" | "public";
  }>;
  revokedAgentIds: string[];
  signature: string;             // User key 对 canonical JSON 签名
}
```

可见性语义：

| 值 | 远程披露 / Remote disclosure | 是否自动加入 Room |
|----|------------------------------|--------------------|
| `private`（默认） | 从不进入远程 manifest | 否；跨用户 Room 中不可选择 |
| `room` | 仅发送到所有者已明确加入该 Agent 的指定 Room，manifest 必须带 `roomId` | 否，仍需所有者操作 |
| `public` | 可向已配对联系人发送最小 Agent Card，也可被所有者加入 Room；不进入 Relay 全局搜索 | 否，仍需所有者操作 |

发布与同步流程：

1. 配对成功后只创建 Contact；不得调用 `buildLocalDirectory()` 或发送 `directory_request`。
2. 所有者在 Agent 设置中把可见性从默认 `private` 改为 `room` 或 `public`。只有 `public` 变更才生成 `scope=contact` 的声明并加密发送给联系人。
3. 所有者在某 Room 点击“添加我的 Agent”时，Local Hub 验证 `actorUserId === ownerId`、Room 人类成员关系和可见性，再签发 `scope=room, roomId=<id>` 的单 Agent 声明及 `room_agent_upsert`。
4. 接收 Hub 验证 envelope、UserHubBinding、所有者签名、Contact/Room membership、scope、版本和 TTL；仅将远程 Agent 注册为对应 Room 的可用成员，不加入全局 Agent 侧边栏。
5. 凭据、config、system prompt、本地路径和历史永不进入声明。寻址使用 `(homeHubId, sourceAgentId)`，显示使用 `Owner / Agent`。
6. 移出 Room、改回 `private`、删除 Agent、离开 Room、解除联系人或封禁时立即发送对应 scope 的 `directory_revoke` / `room_agent_remove`；缓存到期只是故障兜底，不是撤销机制。

目录消息可以使用现有 `{ type: "message", envelope }` Relay frame，因此 Relay 无需解析 `DirectoryManifest`。Relay 只管理 Hub 在线状态和 Room membership，不得依据 User/Agent 内容做授权决策。

**English:** There is no automatic agent-directory exchange. `private` is the default. `room` cards are disclosed only after the owner adds that agent to a specific room; `public` cards may be advertised to paired contacts but are never globally searchable and grant no invocation permission. Receivers scope remote agent records to the authorized room.

## 5. P2P 发现

### mDNS 广播

```typescript
// 使用 bonjour-service 包
import bonjour from "bonjour-service";

const service = bonjour.publish({
  name: `chorus-${hubId.slice(0, 8)}`,
  type: "chorus",
  port: 3212,           // P2P 监听端口 (独立于 3210)
  txt: {
    hubId,
    protocol: "2",
    // displayName 仅在用户明确允许 LAN 可见时发送；默认不带 User/Agent 信息。
  },
});

// 发现其他 Hub
bonjour.find({ type: "chorus" }, (service) => {
  // service.txt.hubId → 获取公钥 → 握手 → 直连
});
```

### P2P 连接

1. mDNS 发现 → 获取 IP + 端口 + Hub ID
2. 通过 Relay 获取对方公钥（或 mDNS TXT 带公钥指纹）
3. WebSocket 直连 `ws://<ip>:3212/hub`
4. 双方互认证（Ed25519 签名挑战）
5. 建立加密通道，直接发送消息

### NAT 穿透（v2 规划）

- STUN 服务器获取公网 IP
- TURN 服务器中继（P2P 不可用时的兜底）
- ICE 协商选择最优路径
- 暂不在 v1 实现

## 6. 混合模式

### 连接管理器

```typescript
class HubConnectionManager {
  // 优先级：P2P > Relay
  async sendMessage(envelope: HubEnvelope): Promise<void> {
    // 1. 尝试 P2P（如果目标 Hub 在局域网内）
    const p2pConn = this.p2pConnections.get(envelope.to);
    if (p2pConn?.isHealthy()) {
      try {
        await p2pConn.send(envelope);
        return; // P2P 成功，不走 Relay
      } catch {
        // P2P 失败，降级到 Relay
      }
    }

    // 2. 走 Relay
    await this.relayClient.send(envelope);
  }
}
``### 路径健康检查

- 每 30s ping 检查 P2P 连接延迟
- 延迟 > 100ms 或连续 3 次 ping 失败 → 标记 P2P 不可用
- Relay 连接持续保活（已有 WebSocket 心跳）
- 两条路径同时维护，P2P 为主、Relay 为备

## 7. 群聊协议

### 房间模型

```
Relay Server
├── Room "project-alpha"
│   ├── Member: Hub A (online)
│   ├── Member: Hub B (online)
│   └── Member: Hub C (offline)
│
├── 消息流:
│   Hub A 发消息 → Relay → fan-out to Hub B (online)
│                                  → Hub C (offline, 存入 offline store)
│
└── 消息加密:
    · v1 默认使用 Room 群组密钥
    · GroupKeyManager 使用 AES-256-GCM 加解密 Room payload
    · rekey 后把新密钥分别安全分发给所有 Room 成员
    · 成员数 ≤5 时可选择逐成员加密作为 fallback
```

### Room 加密决策 / Room encryption decision

- v1 默认使用 `GroupKeyManager` 已实现的 AES-256-GCM 群组密钥；Relay 只接触密文，不持有 Room 明文密钥。
- 所有者把 Agent 加入 Room 时必须触发 rekey，并通过各成员 Hub 的成对加密通道把新密钥分发给所有 Room 成员。
- 人类成员离开或被移除、Agent 被移除时必须触发 rekey；旧密钥立即作废，不得继续用于新的 Room 消息。
- 群组成员数不超过 5 时，可选用逐成员加密作为 fallback：发送方为每个接收 Hub 单独生成密文，但权限和审计语义不变。

**English:** v1 uses the existing `GroupKeyManager` AES-256-GCM group key by default. Adding an agent, removing an agent, or a human member leaving or being removed triggers a rekey; the new key is distributed to every remaining room member over pairwise encrypted channels and the old key is invalid for new messages. Per-member encryption is an optional fallback for rooms with at most five members.

### Room 角色与管理权限 / Room roles and administration

- Room 创建者默认为管理员；角色绑定 User 身份，而不是某个设备 Hub。
- 管理员可以邀请联系人、移除成员、移除任何已入房 Agent，并可把其他 Room 成员委派为管理员。
- 管理员不能添加别人的 Agent；无论角色如何，只有 Agent 所有者能执行 `room_agent_upsert` 将自己的 Agent 加入 Room。
- 非管理员只能退出 Room，以及添加或移除自己的 Agent；不能邀请、移除其他成员或更改管理员角色。
- 管理员移除他人的 Agent 时，必须向该 Agent 所有者的所有已绑定 Hub 发送通知，并写入包含 `roomId`、`agentId`、`ownerUserId`、`actorUserId`、时间和原因的审计日志。移除事件同时触发 rekey。

**English:** The room creator is an administrator by default. Administrators may invite contacts, remove members, remove any room agent, and delegate the administrator role to another member, but they can never add an agent owned by someone else. Non-administrators may only leave and add or remove their own agents. An administrator removal of another user's agent must notify the owner on all bound Hubs, write an audit event, and trigger rekeying.

### 创建群聊

1. Hub A 调用 `POST /api/rooms` 创建房间
2. 获取 `roomId`
3. 通过 `POST /api/rooms/:id/invite` 邀请 Hub B、Hub C
4. Relay 通知被邀请的 Hub
5. 各 Hub 本地创建 `type: "cross_hub"` 会话并保存 `relayRoomId`
6. 本地 `conversation_agents` 记录 Agent、ownerId 以及 Owner/Agent/Hub 身份快照

### 同一 User 的多 Hub 状态同步 / Multi-Hub state for one User

- 一个 User 可绑定多个 Hub，绑定关系由已实现的 `user_hubs` 表维护；Room 人类成员资格和管理员角色属于 User，Hub 只是同步与路由端点。
- 用户在 Mac Hub 上把自己的 Agent 加入 Room 后，该 Hub 发送签名的 `room_agent_upsert`；Relay 把状态事件同步给同一 User 的其他已绑定 Hub，因此手机 Hub 能看到该 Agent 已入房。`room_agent_remove` 以相同方式在各设备收敛。
- 每个 Room Agent 记录必须包含 `ownerUserId` 和 `ownerHubId`。本文路由流程中的 `homeHubId` 即该 Agent 的实际执行 `ownerHubId`；其他同用户 Hub 只展示和同步状态，不运行该 Agent。
- 若 `ownerHubId` 离线，发送端立即显示投递状态 `Agent unavailable (owner offline)`，同时 Relay 可将加密的 @mention 存入 offline store。owner Hub 在 TTL 内上线后仍会收到并处理；该状态表示即时不可用，不等于消息已丢弃。

**English:** One User may bind multiple Hubs through `user_hubs`. Room membership and roles are User-scoped, while signed `room_agent_upsert` and `room_agent_remove` events synchronize room-agent state to all of that User's Hubs. A phone therefore reflects an agent added on a Mac. Only the agent's `ownerHubId`—called `homeHubId` in the routing flow—executes it. If that Hub is offline, the sender sees `Agent unavailable (owner offline)` while the encrypted mention may remain queued for later delivery within the offline-store TTL.

### 跨 Hub @mention 路由 / Cross-Hub @mention routing

```text
用户 A 在 Room 中发送 "@Codex 帮我 review"
→ 本地 Hub A 检测 @Codex，以 (roomId, agentId) 精确匹配并查找 Codex 的 homeHubId
→ Hub A 用 Room 密钥加密 payload → HubEnvelope(to: "room:xxx") → Relay
→ Relay 向所有在线 Room 成员 Hub fan-out；离线目标写入 offline store
→ Hub B（Codex 的 owner/home Hub）收到并解密，只由 Hub B 把调用路由给 Codex
→ Codex 流式回复 → Hub B 加密各回复帧 → HubEnvelope(to: "room:xxx") → Relay
→ Relay 向所有在线 Room 成员 Hub fan-out
→ Hub A 收到并解密回复，在原 Room 中显示
```

Room fan-out 用于让成员显示同一段房间历史，不代表每个 Hub 都调用 Agent。加密 payload 必须携带不可伪造的 `toAgentId` 和目标 `homeHubId`；除该 `homeHubId` 外，其他成员 Hub 只保存/展示消息，不把 @mention 分发给本地 Agent。若 Codex 的 owner Hub 离线，Relay 为该 Hub 保存密文；它上线并验证 Room membership、Agent membership 和目标 ID 后处理并回复。不得按 Agent 显示名广播给所有成员，也不得由同一 User 的其他 Hub 代执行。

**English:** Hub A resolves the mention by `(roomId, agentId)`, includes the authenticated target `homeHubId` inside the encrypted room payload, and sends a room envelope. Relay fans the room content out for a consistent room history, but only the agent's home/owner Hub dispatches the invocation. Other Hubs display or store the message without invoking local agents. If the owner Hub is offline, Relay queues its ciphertext; when it reconnects, it validates the room and agent membership, invokes the agent, and streams encrypted room replies.

### 消息路由 / Message routing

- **发送方** → Relay（`to: "room:xxx"`）
- **Relay** → 查询房间成员 → fan-out 给所有在线成员
- **离线成员** → 存入 offline store，上线后推送
- **P2P 群聊** → 发送方逐个 unicast 给局域网内的成员
- **应用层目标** → 有 `@` 时仅目标 Agent 的 `homeHubId` 执行；不得把调用广播给所有成员 Hub 上的 Agent。无 `@` 时只投递会话主 Agent，只有显式广播才让各 Hub 扇出给多个 Agent

**English:** Relay fan-out distributes encrypted room content, whereas application dispatch is narrower: an @mention is executed only on the target agent's `homeHubId`. Offline room recipients use the offline store, and explicit broadcast is the only operation that may dispatch to multiple agents.

## 8. 安全

| 层面 | 措施 |
|------|------|
| 传输层 | WSS (TLS) 用于 Relay 连接 |
| 消息层 | 直连/密钥分发使用 libsodium `crypto_box`；Room 正文默认使用 `GroupKeyManager` AES-256-GCM |
| 身份层 | Ed25519 签名验证 |
| 用户绑定 | UserHubBinding 双签名；User/Hub 公钥变化必须重新配对 |
| 调用授权 | own=`auto`，trusted remote=`confirm`，unknown/stale=`deny`；Relay JWT 不授予 Agent 权限 |
| 防重放 | nonce + 5 分钟时间窗口 |
| 防篡改 | envelope signature 覆盖所有字段 |
| Relay 隔离 | Relay 只看到 ciphertext + 元数据 |
| 速率限制 | Relay 限制每 Hub 100 msg/s |
| 注册控制 | 可选 invite code 防止滥用 |

隐私边界：E2E 加密保护 User/Agent 目录与正文，但 Relay 仍可看到 Hub ID、源/目标或 Room、时间、密文大小、在线状态和 IP。若 threat model 不接受这些元数据，必须使用自托管 Relay、P2P 或额外的流量填充/匿名网络；产品不得宣称“Relay 看不到任何信息”。

## 9. 任务拆解

### Phase 0: Multi-user Identity（新增，先于远程 Agent 可用性）

| ID | 标题 | 描述 | 依赖 | 优先级 |
|:---|------|------|------|:---:|
| MU-01 | User identity | User key、UserHubBinding、users 表与现有 Agent owner 回填 | — | 🔴 P0 |
| MU-02 | Payload v2 | `fromUserId/fromUserName/toUserId`、兼容解析、签名验证 | MU-01 | 🔴 P0 |
| MU-03 | Signed directory | visibility 过滤、announce/request/revoke、版本与过期 | MU-01, MU-02 | 🔴 P0 |
| MU-04 | Remote registration | 事务性注册 remote User + Agent、冲突寻址、撤销与 stale | MU-03 | 🔴 P0 |
| MU-05 | Trust & permission | 配对指纹、Agent/会话策略、审批和审计 | MU-01, MU-04 | 🔴 P0 |
| MU-06 | Owner-aware UI/API | Owner 分组、`Owner / Agent` 显示、能力与状态查询 | MU-04 | 🟡 P1 |

### Phase 1: Relay Server MVP

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| R1-01 | Relay 包初始化 | 创建 `packages/relay/`，Fastify + WebSocket + SQLite，健康检查端点 | 2h | — | 🔴 P0 |
| R1-02 | Hub 注册与认证 | Ed25519 公钥注册 + JWT 签发 + WebSocket 认证握手 | 3h | R1-01 | 🔴 P0 |
| R1-03 | 消息路由 | 按 Hub ID 路由消息，在线 WebSocket 投递 | 2h | R1-02 | 🔴 P0 |
| R1-04 | 离线消息存储 | SQLite offline_messages 表 + TTL 清理 + 上线批量推送 | 2h | R1-03 | 🔴 P0 |
| R1-05 | Presence 管理 | Hub 上下线广播 + 在线状态查询 | 1.5h | R1-02 | 🟡 P1 |
| R1-06 | Docker 部署 | Dockerfile + docker-compose + 环境变量配置 | 1.5h | R1-04 | 🟡 P1 |

### Phase 2: Hub Client

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| R2-01 | 密钥对管理 | Ed25519 密钥对生成 + 存储 + 加载 | 1.5h | — | 🔴 P0 |
| R2-02 | Relay 客户端 | WebSocket 连接 + 认证 + 心跳 + 重连 | 3h | R2-01, R1-02 | 🔴 P0 |
| R2-03 | 消息加解密 | libsodium crypto_box 封装 + 签名/验证 | 2h | R2-01 | 🔴 P0 |
| R2-04 | Hub 消息路由 | 接收跨 Hub 消息 → 路由到本地 Agent → 回复发送 | 3h | R2-02, R2-03 | 🔴 P0 |
| R2-05 | 跨 Hub 会话 UI | 连接状态指示器 + 跨 Hub 联系人列表 + 添加 Hub 好友 | 3h | R2-04 | 🟡 P1 |

### Phase 3: P2P 发现

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| R3-01 | mDNS 广播与发现 | bonjour-service 发布 + 发现 + TXT 记录 | 2h | R2-01 | 🟡 P1 |
| R3-02 | P2P WebSocket 监听 | 独立端口 (3212) 接收其他 Hub 的直连 | 2h | R3-01 | 🟡 P1 |
| R3-03 | P2P 认证握手 | Ed25519 签名挑战 + 加密通道建立 | 2h | R3-02, R2-03 | 🟡 P1 |
| R3-04 | P2P 消息路由 | 直连通道发送/接收消息，与 Relay 消息格式一致 | 1.5h | R3-03 | 🟡 P1 |

### Phase 4: 混合模式

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| R4-01 | 连接管理器 | P2P 优先 + Relay 兜底 + 自动路径选择 | 3h | R2-04, R3-04 | 🟡 P1 |
| R4-02 | 路径健康检查 | 30s ping + 延迟监控 + 自动降级 | 1.5h | R4-01 | 🟡 P1 |
| R4-03 | 连接状态 UI | 前端展示当前模式 (P2P/Relay/离线) + 延迟指示 | 1.5h | R4-01 | 🟢 P2 |

### Phase 5: 群聊

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| R5-01 | Relay 房间管理 | 创建/加入/离开/邀请 + 成员列表 + presence | 3h | R1-05 | 🔴 P0 |
| R5-02 | 群聊消息扇出 | Relay 收到 `to: "room:xxx"` → fan-out 所有在线成员 | 2h | R5-01 | 🔴 P0 |
| R5-03 | 本地群聊会话 | Hub 端创建 group 类型会话 + conversation_agents 映射 | 2h | R5-01 | 🔴 P0 |
| R5-04 | 群聊 UI | 群聊消息展示 + 成员列表 + 邀请入口 + @提及跨 Hub Agent | 3h | R5-03 | 🟡 P1 |
| R5-05 | 跨 Hub A2A | 群聊中 @对方 Hub 的 Agent → 跨 Hub A2A 调用 | 2h | R5-02, R2-04 | 🟡 P1 |

### Phase 6: 部署与文档

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| R6-01 | Docker 镜像 | Relay Server Dockerfile + 多阶段构建 + 发布到 Docker Hub | 1.5h | R1-06 | 🟡 P1 |
| R6-02 | 自部署指南 | 文档：Docker 部署 + Nginx 反代 + TLS 配置 | 1h | R6-01 | 🟡 P1 |
| R6-03 | Hub 配置 UI | 设置面板：Relay 地址 + P2P 开关 + Hub ID 显示 | 1.5h | R2-05 | 🟡 P1 |
| R6-04 | 官方 Relay | 部署一个官方 Relay 实例供体验用户使用 | 1h | R6-01 | 🟢 P2 |

## 10. 包结构

```
packages/
├── shared/              # 现有，新增 Hub 协议类型
│   └── src/types/
│       ├── hub.ts       # HubEnvelope, HubPayload, HubIdentity
│       └── relay.ts     # RelayMessage, RoomEvent
├── server/              # 现有，新增 Hub Client 模块
│   └── src/
│       ├── hub/         # 新增
│       │   ├── identity.ts    # 密钥对管理
│       │   ├── relay-client.ts # Relay WebSocket 客户端
│       │   ├── p2p-listener.ts # mDNS + P2P WebSocket
│       │   ├── connection-manager.ts # 混合模式路由
│       │   └── crypto.ts      # 加解密封装
│       └── ...
├── web/                 # 现有，新增连接状态 UI
│   └── src/
│       ├── store/
│       │   └── hubStore.ts     # 跨 Hub 连接状态
│       └── components/
│           └── hub/            # 连接状态、Hub 好友列表
├── relay/               # 新增：Relay Server
│   ├── src/
│   │   ├── index.ts           # Fastify 入口
│   │   ├── routes/            # REST API
│   │   ├── ws/                # WebSocket 处理
│   │   ├── hub-registry.ts    # Hub 注册与认证
│   │   ├── message-router.ts  # 消息路由
│   │   ├── room-manager.ts    # 群聊房间管理
│   │   └── offline-store.ts   # 离线消息存储
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── package.json
└── ...
```

## 11. 配置扩展

```typescript
// chorus.config.ts 新增字段
export default {
  // ... 现有配置
  hub: {
    enabled: true,
    displayName: "子涵的 Hub",
    // Relay 配置
    relay: {
      url: "wss://relay.chorus.app/ws",  // 官方 Relay
      // url: "wss://my-relay.example.com/ws", // 自部署
      token: undefined,  // 首次注册后自动填充
    },
    // P2P 配置
    p2p: {
      enabled: true,
      port: 3212,        // P2P WebSocket 监听端口
      discovery: "mdns", // mDNS 发现
    },
    // 密钥对（首次启动自动生成）
    // keypairPath: "./data/hub-keypair.json",
  },
} satisfies AppConfig;
```

## 12. 数据流示例

### Hub 上线与远程 Agent 注册

```text
Hub A 上线并完成 Relay/P2P Hub 认证
  → 向已配对 Hub B 发送 directory_request
  → Hub B 按 A 的 trust/room 范围过滤本机 Agent
  → User B 签名 DirectoryManifest，Hub B 加密并签名 envelope
  → Hub A 验证 Hub B → UserHubBinding → Directory signature
  → BEGIN: upsert remote User B → upsert B 的可见 Agent → COMMIT
  → UI/API 出现 “User B / Gemini CLI”，状态来自 manifest
  → 后续 revoke 或 manifest 过期：停止新调用，历史身份快照仍保留
```

任何一步验证失败都不得创建半条 remote Agent 记录；只记录不含正文和目录详情的安全审计事件。

### 跨 Hub 直接消息

```
用户A → "帮我分析下这段代码"
  ↓
Hub A Agent 生成回复
  ↓
Hub A 加密 payload → HubEnvelope(to: Hub B)
  ↓
连接管理器：P2P 可用？→ 走 P2P（LAN < 1ms）
  ↓
Hub B 解密 → 路由到本地 Agent → 生成回复
  ↓
Hub B 加密回复 → HubEnvelope(to: Hub A)
  ↓
P2P 直传回 Hub A → 前端展示
```

### 群聊消息

```
用户A → "@AgentB 帮我 review 这个 PR"
  ↓
Hub A 解析 @提及 → 目标是 Hub B 的 Agent
  ↓
Hub A 加密 payload → HubEnvelope(to: "room:xxx")
  ↓
走 Relay（Hub B 不在局域网）
  ↓
Relay fan-out → Hub B (online) + Hub C (offline, 存入 offline store)
  ↓
Hub B 解密 → 路由给 Agent B → 流式回复
  ↓
Hub B 加密回复 → HubEnvelope(to: "room:xxx") → Relay → fan-out
```

---

## 13. Review 结论与修订

> 2026-08-01 Code Review 结果，已合并到上述设计中。

### 13.1 Ed25519 / X25519 密钥转换（已修订 §2, §3）

**问题**：Hub ID = Ed25519 公钥，但 crypto_box 需要 X25519 公钥。

**方案**：生成一对 Ed25519 密钥用于签名和身份，加密时通过 `crypto_sign_ed25519_pk_to_curve25519` 转换为 X25519 公钥。Hub ID = Ed25519 公钥完整 hex（不截断），显示时取前 8 位。

```typescript
import sodium from "libsodium-wrappers";

// 加密时转换公钥
const x25519PublicKey = sodium.crypto_sign_ed25519_pk_to_curve25519(ed25519PublicKey);
const ciphertext = sodium.crypto_box(payload, nonce, x25519PublicKey, x25519SecretKey);
```

### 13.2 群聊加密：GroupKeyManager（已修订 §7）

**问题**：逐成员加密的密文数量随成员数线性增长，且 Room 成员或 Agent 变更后需要明确的密钥撤销边界。

**方案**：
- v1 默认使用 `GroupKeyManager` 的 AES-256-GCM 群组密钥
- 创建/加入房间时，Relay 返回所有成员的 Hub ID + 公钥，供各 Hub 建立成对加密的群组密钥分发通道；Relay 不接触明文群组密钥
- Agent 加入、Agent 移除以及人类成员离开或被移除时执行 rekey，并向所有剩余 Room 成员分发新密钥；旧密钥作废
- 逐成员加密仅作为成员数 ≤5 时的可选 fallback

```
POST /api/rooms/:id/join
Response:
{
  "roomId": "xxx",
  "members": [
    { "hubId": "a1b2...", "publicKey": "ed25519-pub-hex", "displayName": "子涵", "online": true },
    ...
  ]
}
```

**English:** v1 uses the AES-256-GCM key managed by `GroupKeyManager`. Pairwise member public keys protect group-key distribution, membership or agent changes trigger rekeying, and per-member encryption is retained only as an optional fallback for rooms of at most five members.

### 13.3 Tauri sidecar mDNS 验证（已修订 §5, R3-01）

**问题**：Tauri 生产模式下 Node.js sidecar 运行在子进程，mDNS 可能受限。

**方案**：
- R3-01 任务描述增加"验证 Tauri sidecar 模式下 mDNS 可用性"
- mDNS 绑定到 `0.0.0.0:3212`
- macOS：确认 App Sandbox 网络权限（com.apple.security.network.server）
- Windows：确认防火墙例外（首次启动提示用户允许）
- fallback：如果 mDNS 不可用，仅使用 Relay 模式

### 13.4 离线消息持久化（已修订 §4, R1-04）

**问题**：Relay 单实例宕机可能导致离线消息丢失。

**方案**：
- SQLite WAL 模式 + 每 5 分钟 checkpoint
- 离线消息表写入时同步刷盘（`PRAGMA synchronous = FULL`）
- v2 支持 Redis 副本

### 13.5 消息顺序保证（已修订 §3）

**问题**：不同 Hub 时钟偏差导致消息顺序错乱。

**方案**：
- 接收方按 `timestamp` 排序，容忍 ±5s 时钟偏差
- Relay 在 fan-out 时附加 `relayTimestamp` 作为排序兜底
- 群聊 UI 内消息按 `timestamp` 排序，不按到达顺序

```typescript
interface HubEnvelope {
  // ... 现有字段
  relayTimestamp?: number;  // Relay 转发时附加，用于跨 Hub 排序兜底
}
```

### 13.6 其他修订

| 位置 | 修订内容 |
|------|---------|
| §2 Hub ID | 用完整公钥 hex 做 ID，显示时截断前 8 位 |
| §5 mDNS TXT | 默认只带 Hub ID + protocol，不带 User/Agent 信息；Hub 公钥通过 Relay/配对获取，displayName 仅显式允许时广播 |
| §4 REST API | 新增 `DELETE /api/hubs/:id` — Hub 注销，清除公钥和离线消息 |
| §8 速率限制 | 分级：direct 50/s, group 20/s, broadcast 5/s |
| §4 离线 TTL | 做成环境变量 `RELAY_OFFLINE_TTL_DAYS`，默认 7 天 |
| §5 P2P 端口 | 支持配置端口范围，被封时回退到 Relay |

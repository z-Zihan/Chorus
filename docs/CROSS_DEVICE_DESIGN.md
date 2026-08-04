# AgentLink 跨设备通信设计 / Cross-Device Communication Design

> 最后更新 / Last updated: 2026-08-04  
> 状态 / Status: **规范性设计（后续跨设备通信实现的唯一参考）/ Normative design and the single source of truth for future cross-device communication work**

本文整合并取代 `RELAY_DESIGN.md`、`PRD.md`、`GUIDE.md` 与 `DEV_PLAN.md` 中分散的跨设备通信规则。上述文件保留为历史背景；若其跨设备内容与本文冲突，以本文为准。协议关键字“必须 / MUST”“不得 / MUST NOT”“应该 / SHOULD”具有规范含义。

This document consolidates and supersedes the cross-device rules previously spread across `RELAY_DESIGN.md`, `PRD.md`, `GUIDE.md`, and `DEV_PLAN.md`. Those files remain historical context; this document takes precedence for cross-device behavior. “MUST”, “MUST NOT”, and “SHOULD” are normative.

---

## 1. 概述与设计原则 / Overview and Design Principles

AgentLink 连接不同设备上的 User、Hub 与 Agent，同时保持本地优先。单机功能不依赖 Relay；跨设备传输可使用公网 Relay、局域网 P2P，或自动选择路径的混合模式。

AgentLink connects users, device hubs, and agents while remaining local-first. Local use never depends on a Relay. Cross-device transport may use a public/self-hosted Relay, LAN P2P, or a hybrid path selector.

### 1.1 三种通信模式 / Three transport modes

| 模式 / Mode | 路径 / Path | 用途 / Purpose |
|---|---|---|
| Relay | Hub A ↔ WSS Relay ↔ Hub B | 跨网络寻址、离线消息、Room 扇出 / Internet routing, offline delivery, and room fan-out |
| P2P | Hub A ↔ LAN WebSocket ↔ Hub B | mDNS 发现后的低延迟局域网直连 / Low-latency LAN connection after mDNS discovery |
| Hybrid | P2P 优先，Relay 兜底 / P2P first, Relay fallback | 同时维护两条路径并自动降级 / Maintain both paths and fail over automatically |

P2P 每 30 秒执行健康检查；延迟超过 100 ms 或连续 3 次 ping 失败时回退 Relay。Relay 连接持续保活。NAT 穿透（STUN/TURN/ICE）不属于 v1；mDNS 不可用时必须仍可使用 Relay。

P2P is checked every 30 seconds. Latency above 100 ms or three consecutive failed pings causes fallback to Relay, whose connection remains warm. NAT traversal with STUN/TURN/ICE is outside v1; Relay MUST remain usable when mDNS is unavailable.

### 1.2 核心原则 / Core principles

1. **身份分层 / Layered identity:** User 是人和所有权主体，Hub 是设备与路由端点，Agent 是执行能力；三者不得混用。
2. **授权分层 / Layered authorization:** Contact、Room 人类成员、Room Agent 成员是三个独立、显式且可撤销的授权。前一层不得隐式授予后一层。
3. **所有者控制 / Owner control:** 只有 Agent 所有者能把自己的 Agent 加入 Room。管理员可以移除但不能替他人添加 Agent。
4. **隐私默认 / Private by default:** Agent 默认为 `private`；配对或上线不得触发 Agent 目录交换。
5. **端到端加密 / End-to-end encryption:** Relay 只处理加密信封、路由与必要元数据，不能解密正文或目录。
6. **稳定 ID 路由 / Stable-ID routing:** 显示名只用于展示。授权与寻址必须使用签名后的 User ID、Hub ID、Agent ID 和 Room ID。
7. **本地授权 / Local enforcement:** Relay JWT 只证明 Hub 可连接 Relay；Agent 调用权限由接收方 Local Hub 验证。
8. **状态可解释 / Explainable state:** 保存、连接、投递、授权和执行是不同状态，不得统一显示为“成功”或“发送失败”。
9. **可撤销且保留历史 / Revocable with durable history:** 撤销立即阻止新调用，但历史消息保留不可变的身份快照。

---

## 2. 身份模型（User → Hub → Agent）/ Identity Model

```text
User（稳定的人类身份与所有权 / stable human identity and ownership）
└── Hub 1（设备、传输、在线状态 / device, transport, presence）
│   ├── Agent A（仅在此 Hub 执行 / executes only here）
│   └── Agent B
└── Hub 2（同步同一 User 的 Room 状态 / syncs the same User's room state）
    └── Agent C
```

### 2.1 User 身份 / User identity

- 首次启动创建本机 User，不要求云账号。User 使用 Ed25519 密钥；私钥存系统钥匙串。
- `userId = "usr_" + base64url(SHA-256(userPublicKey))`，跨设备保持稳定。
- 一个 User 可绑定多个 Hub。Room 成员资格和管理员角色属于 User，而不是单个 Hub。

A local User is created on first launch without requiring a cloud account. The User has an Ed25519 key stored in the OS keychain. Its stable ID is derived from the public key. One User may bind multiple Hubs; room membership and roles are User-scoped.

### 2.2 Hub 身份 / Hub identity

- 每个 Hub 首次启动生成 Ed25519 密钥，存于 `data/hub-keypair.json`。
- `hubId` 是完整 Ed25519 公钥 hex；UI 只显示前 8 位短指纹。
- Hub 显示名不唯一，不能参与授权或路由。
- Hub 通过 Relay 注册、JWT 和 Ed25519 challenge-response 证明设备身份。

Each Hub has an Ed25519 key pair. The full public-key hex is the Hub ID; only the first eight characters are a UI fingerprint. Display names are non-unique and never authorize or route traffic.

### 2.3 User–Hub 绑定 / User–Hub binding

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

绑定必须同时由 User key 和 Hub key 签名，并记录在 `user_hubs`。公钥变化、绑定过期或设备撤销后必须重新验证；Relay 注册本身不能创建 User 信任。

The binding MUST be signed by both keys and stored in `user_hubs`. Key changes, expiry, or device revocation require re-verification. Relay registration alone creates no User trust.

### 2.4 Agent 身份与所有权 / Agent identity and ownership

- 每个 Agent 必须有 `ownerId`、稳定的 `sourceAgentId` 和实际执行设备 `ownerHubId`（路由中亦称 `homeHubId`）。
- `ownerType` 可为 `local`、`remote` 或 `system`；自动检测的 `system` Agent 仍归本机 User 所有。
- 唯一远程地址是 `(homeHubId, sourceAgentId)`；Room 内用 `(roomId, agentId)` 解析。名称只作展示。
- UI 默认只在“我的 Agent”显示本机 Agent。远程 Agent 只出现在其获授权的 Room，并显示为 `Owner / Agent`；重名时附 Hub 短指纹。
- 远程 Agent 被撤销后不再作为在线目录项，但历史保留 Owner、Agent、Hub 的不可变快照。

Every Agent has an owner, stable source ID, and one execution Hub. Stable IDs—not names—address it. Remote agents are room-scoped and shown as `Owner / Agent`; revoked agents disappear from live discovery while historical identity snapshots remain.

---

## 3. 通信协议 / Communication Protocol

### 3.1 HubEnvelope

```typescript
interface HubEnvelope {
  id: string;                 // UUID v7
  from: string;               // sender Hub ID
  to: string;                 // Hub ID | "room:<roomId>" | "broadcast"
  type: "direct" | "group" | "broadcast" | "presence" | "discovery";
  timestamp: number;          // sender Unix time in ms
  nonce: string;              // base64; algorithm-specific uniqueness is mandatory
  ciphertext: string;         // encrypted HubPayload, base64
  signature: string;          // sender Ed25519 signature, base64
  relayTimestamp?: number;    // Relay-added, untrusted ordering fallback
}
```

发送方签名覆盖除 `signature` 和 `relayTimestamp` 外的所有发送方字段的规范序列化。`relayTimestamp` 由 Relay 转发时添加，只能用于排序兜底，不能参与身份、权限或重放判断。

The sender signs the canonical serialization of every sender-owned field except `signature` and `relayTimestamp`. The Relay-added timestamp is an untrusted ordering hint only and MUST NOT affect identity, authorization, or replay decisions.

### 3.2 HubPayload v2

```typescript
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
  sequence?: number;          // monotonic within sender + conversation when present
  content?: string;
  fromUserId: string;
  fromUserName: string;       // display only; never authorize with it
  toUserId?: string;
  fromAgentId?: string;
  toAgentId?: string;
  homeHubId?: string;         // required for a targeted remote-agent invocation
  directory?: DirectoryManifest;
  metadata?: Record<string, unknown>;
}
```

v2 写入方必须发送 `protocolVersion: 2`。迁移期读取方可兼容 v1，但必须采取拒绝优先策略：无法安全映射 User、Agent 或 Room 身份时拒绝，不得用显示名补全。

Writers MUST emit protocol v2. Readers may accept v1 during migration, but MUST fail closed when User, Agent, or Room identity cannot be mapped safely. Display names are never a fallback address.

### 3.3 消息类型语义 / Message type semantics

| 类别 / Class | 消息 / Messages | 语义 / Semantics |
|---|---|---|
| 内容 / Content | `chat`, `typing` | 人类消息和临时输入状态 / Human content and ephemeral typing state |
| A2A | `a2a_call`, `a2a_response`, `agent_status` | Agent 调用、流式/最终响应和状态 / Agent invocation, streamed/final response, and status |
| 联系人 / Contact | `contact_request`, `contact_accept`, `contact_block` | 配对、接受、封禁；不授予目录或调用权 / Pair, accept, or block; grants no agent access |
| Room | `room_invite`, `room_accept`, `room_leave` | 人类成员关系 / Human room membership |
| Room Agent | `room_agent_upsert`, `room_agent_remove` | 所有者授权 Agent 入房或撤销 / Owner-authorized agent admission or removal |
| 目录 / Directory | `directory_request`, `directory_announce`, `directory_revoke` | 分范围、签名、带版本的 Agent Card 同步 / Scoped, signed, versioned Agent Card synchronization |
| 投递 / Delivery | `delivery_ack` | Hub 持久化成功确认；不是 Agent 执行成功 / Persistence acknowledgement, not execution success |

`contact_*`、`room_*`、`room_agent_*` 属于不同授权域。`contact_accept` 后不得自动发送目录请求；`room_accept` 只加入人类成员；只有所有者签名的 `room_agent_upsert` 才使 Agent 在该 Room 可寻址。

Contact, room-human, and room-agent events are separate authorization domains. Accepting one MUST NOT imply the next.

### 3.4 接收验证顺序 / Receive validation order

1. 验证协议版本、必填字段、大小限制、UUID 和时间窗口。
2. 用 `from` Hub 公钥验证 envelope 签名、nonce 和重放缓存。
3. 解密 payload，并确认内部目标与 envelope 路由一致。
4. 验证 `UserHubBinding`，再验证 User 签名的目录或成员事件。
5. 验证 Contact/Room/Agent membership、可见性、trust 和 `auto/confirm/deny` 策略。
6. 只有目标 `homeHubId` 可以执行 Agent；其他 Hub 仅保存和展示。
7. 任一步失败均拒绝并记录不含正文、凭据或目录详情的安全审计事件。

The receiver validates syntax, Hub signature and replay protection, decryption and target consistency, User–Hub binding, owner signatures, membership, visibility, trust, and invocation policy—in that order. Any failure is fail-closed and safely audited.

### 3.5 去重与排序 / Deduplication and ordering

- `id` 和 `messageId` 必须全局唯一；接收方至少维护最近 1000 个 ID 的 LRU，并对持久化消息提供数据库幂等约束。
- 同一发送方与会话优先按 `sequence` 排序；否则按 `timestamp`，容忍 ±5 秒偏差，并以 `relayTimestamp` 作 UI 排序兜底。
- `directory_revoke` 优先于更旧的 `directory_announce`；到达顺序不能覆盖更高 `directoryVersion`。

IDs are idempotency keys. Sequence is preferred for per-conversation ordering; sender time and then Relay time are display fallbacks. A newer revoke or directory version always wins over older arrival order.

---

## 4. 加密方案 / Encryption

### 4.1 直连与成对加密 / Direct and pairwise encryption

- 身份和签名使用 Ed25519；加密使用 libsodium `crypto_box`（X25519 + XSalsa20-Poly1305）。
- 使用 `crypto_sign_ed25519_pk_to_curve25519` 和对应 secret-key 转换函数，将 Ed25519 key 转为 X25519 key；不得把截断指纹当公钥。
- Hub A 用 Hub B 的 X25519 公钥和自己的 X25519 私钥加密 payload，再用 Ed25519 私钥签名 envelope。
- 该方案用于 direct 消息、P2P 通道、Room key 分发，以及小 Room 的逐成员 fallback。
- 每条密文使用唯一 nonce；接收方同时执行 nonce/消息 ID 重放保护。

Identity uses Ed25519; pairwise encryption uses libsodium `crypto_box` after the defined Ed25519-to-X25519 conversion. Pairwise channels protect direct traffic and group-key distribution. Relay never receives plaintext keys.

### 4.2 Room 群组密钥 / Room group key

- v1 规范默认由 `GroupKeyManager` 管理 AES-256-GCM Room key；每条 Room payload 使用唯一的 GCM nonce。
- Room 创建/加入后，通过各成员 Hub 的成对加密通道分发当前 key。Relay 只见密文。
- Agent 加入、Agent 移除、人类成员离开或被移除时必须 rekey；旧 key 立即禁止用于新消息。
- Room 人数不超过 5 时，可协商逐成员加密 fallback；授权、审计和撤销语义不变。
- MLS 或其他大群方案只能作为新协议版本/能力协商启用，不得静默改变 v2 密文格式。

The normative v1 room scheme is an AES-256-GCM key managed by `GroupKeyManager`. Membership or agent changes trigger rekeying, with the new key distributed pairwise to remaining members. Per-member encryption is an optional negotiated fallback for rooms of at most five members. Future MLS support requires explicit version/capability negotiation.

### 4.3 传输加密与边界 / Transport encryption and boundary

公网 Relay 必须使用 WSS/TLS。`ws://` 只允许显式开发模式或可信局域网。TLS 不代替消息 E2E 加密；即使 Relay 终止 TLS，也只能读取路由元数据和密文。

Public Relays MUST use WSS/TLS. Plain WS is limited to explicit development or trusted LAN use. TLS does not replace message-level E2E encryption.

---

## 5. Relay Server 设计 / Relay Server Design

### 5.1 职责边界 / Responsibility boundary

Relay 负责：Hub 注册与认证、在线连接、Hub 寻址、presence、加密 envelope 路由、Room Hub membership、在线 fan-out 和离线密文存储。

Relay 不负责：明文 User/Agent 全局目录、目录解密、User 互信判断、Agent 所有权判断、Agent 加入 Room、调用审批或 Agent 执行。

The Relay authenticates transport endpoints and moves encrypted envelopes. It MUST NOT make product-level User, owner, visibility, or Agent-invocation authorization decisions.

### 5.2 实现基线 / Implementation baseline

- 包：`packages/relay/`
- 技术栈：Node.js 22、Fastify 5、WebSocket、SQLite
- 部署：Docker / docker-compose；默认端口 `3211`
- v1 单实例目标：约 1000 个并发 Hub
- v2 扩展：Redis pub/sub；v3：Kubernetes 与负载均衡
- 持久化：SQLite WAL，每 5 分钟 checkpoint，离线写入使用 `PRAGMA synchronous = FULL`

The v1 baseline is a single Fastify/WebSocket/SQLite service packaged for Docker. Redis fan-out and Kubernetes are later scaling layers, not prerequisites for protocol correctness.

### 5.3 WebSocket 帧 / WebSocket frames

```text
Hub → Relay
  { type: "register", hubId, token }
  { type: "message", envelope: HubEnvelope }
  { type: "presence", status: "online" | "offline" }
  { type: "room:join", roomId }
  { type: "room:leave", roomId }
  { type: "ping" }

Relay → Hub
  { type: "registered", relayHubId }
  { type: "message", envelope: HubEnvelope }
  { type: "offline_messages", envelopes: HubEnvelope[] }
  { type: "presence", hubId, status }
  { type: "room:event", roomId, event, hubId }
  { type: "pong" }
```

所有业务消息都通过 `message + HubEnvelope` 传输。Relay 不解析 `HubPayload` 或 `DirectoryManifest`。Room 帧中的 Hub membership 是投递路由数据，不是 User/Agent 授权证明。

All application traffic uses the encrypted envelope frame. Relay room membership is routing state, never proof of User or Agent authorization.

### 5.4 Hub 注册与互认证 / Hub registration and mutual authentication

1. Hub 向 `/api/hubs/register` 提交 Hub ID、公钥、显示名和签名 challenge，获取 Relay JWT 与 `relayHubId`。
2. WebSocket 使用 token 注册；token 只授予 Relay 连接和路由能力。
3. Hub A 从 Relay 或可信邀请获取 Hub B 的完整公钥并核验指纹。
4. 双方签名 `challenge + 两端 Hub ID + timestamp`；时间窗口为 5 分钟。
5. 验证后建立成对加密通道；User 归属仍需双签名 `UserHubBinding`。

Registration authenticates each Hub to the Relay. Separate mutual challenge-response authenticates Hubs to each other, and a separately signed binding associates a Hub with a User.

### 5.5 部署配置 / Deployment configuration

```yaml
services:
  agentlink-relay:
    image: agentlink/relay:latest
    ports: ["3211:3211"]
    volumes: ["relay-data:/data"]
    environment:
      RELAY_PORT: 3211
      RELAY_JWT_SECRET: "replace-with-a-strong-secret"
      RELAY_OFFLINE_TTL_DAYS: 7
      RELAY_MAX_HUBS: 1000

volumes:
  relay-data:
```

生产部署必须配置 TLS 反向代理、强 JWT secret、持久卷、备份与日志保留策略。Relay 运维日志不得记录正文、解密目录、token 或 key。

Production deployments require TLS, a strong JWT secret, persistent storage, backups, and a retention policy. Operational logs MUST NOT contain plaintext content, decrypted directories, tokens, or keys.

---

## 6. 目录发现与可见性 / Directory Discovery and Visibility

Relay 不建立可搜索的明文 User/Agent 目录。配对成功和 Hub 上线都不得自动触发 `directory_request` 或 `directory_announce`。配对只同步最小 User Card：User ID、显示名、可选头像、Hub 指纹和 presence。

The Relay has no searchable plaintext User or Agent directory. Pairing and reconnecting MUST NOT trigger automatic agent-directory exchange. A contact card contains only minimal User identity and presence data.

### 6.1 签名目录 / Signed directory manifest

```typescript
interface DirectoryManifest {
  schemaVersion: 1;
  directoryVersion: number;
  issuedAt: number;
  expiresAt: number;
  scope: "contact" | "room";
  roomId?: string; // required when scope === "room"
  binding: UserHubBinding;
  user: {
    id: string;
    name: string;
    avatar?: string;
    publicKey: string;
  };
  agents: Array<{
    id: string; // stable sourceAgentId on the home Hub
    name: string;
    description?: string;
    type: string;
    capabilities: string[];
    status: "online" | "busy" | "offline" | "error";
    visibility: "room" | "public";
  }>;
  revokedAgentIds: string[];
  signature: string; // User signature over canonical JSON
}
```

凭据、API key、config、system prompt、本地路径、文件内容和历史消息永远不得进入 manifest。

Credentials, API keys, configuration, system prompts, local paths, files, and conversation history MUST NEVER enter a manifest.

### 6.2 可见性 / Visibility

| 值 / Value | 远程披露 / Remote disclosure | 调用授权 / Invocation grant |
|---|---|---|
| `private`（默认 / default） | 不进入任何远程 manifest / Never disclosed remotely | 无 / None |
| `room` | 仅由所有者加入的指定 Room；manifest 必须带 `roomId` / Only a room where its owner explicitly adds it | 仍需 Room Agent membership 与调用策略 / Still requires room-agent membership and policy |
| `public` | 可向已配对联系人发送最小 Agent Card；不进入全局搜索 / Minimal card may be sent to paired contacts; never globally searchable | 无隐式调用权 / No implicit invocation right |

### 6.3 发布、接收与撤销 / Publish, receive, and revoke

1. 所有者把 Agent 从 `private` 改为 `room` 或 `public`。只有 `public` 可产生 `scope=contact` 声明。
2. 所有者在 Room 选择“添加我的 Agent”时，Local Hub 验证 owner、Room membership 和 visibility，签发单 Agent 的 `scope=room` manifest 与 `room_agent_upsert`。
3. 接收方验证 envelope、binding、User 签名、scope、Room membership、版本和 TTL，再事务性 upsert 远程 User 与 Room-scoped Agent。
4. 远程 Agent 不进入全局 Agent 侧边栏，只进入获授权 Room。
5. 改回 `private`、删除/移出 Agent、离开 Room、解除联系人或 block 时立即发送 `directory_revoke` / `room_agent_remove`。TTL 只是故障兜底，不能替代撤销。
6. 撤销或更高版本必须在在线链路 60 秒内收敛，并立即拒绝新调用。

Publishing is explicit and scope-bound. Receivers verify and register atomically. Revocation is an active event; expiry is only a safety net. A revoked capability stops accepting new calls while historical snapshots remain.

---

## 7. 联系人与配对 / Contacts and Pairing

### 7.1 联系人状态 / Contact states

| 状态 / State | 含义 / Meaning |
|---|---|
| `pending` | 配对请求或一次性码尚未由双方确认 / Pairing request or one-time code not yet confirmed |
| `trusted` | 指纹已核验，可发人类消息与 Room 邀请 / Fingerprints verified; human messaging and room invitations allowed |
| `blocked` | 拒绝新消息、邀请、目录和调用 / Reject new messages, invites, directory events, and calls |
| `removed` | 联系关系撤销；历史保留 / Relationship revoked; history retained |

### 7.2 配对流程 / Pairing flow

1. 发起方输入对方完整 Hub ID，并创建一次性配对码。
2. 双方通过可信的带外渠道交换配对码。
3. 接收方核验 User 与 Hub 公钥指纹，确认 challenge 和有效期。
4. 双方保存 Contact 和信任记录；公钥变化必须重新配对。
5. 配对结果只显示头像、名称、Hub 指纹和 presence；远端 Agent 数必须仍为 0。

The initiator enters the full Hub ID, exchanges a one-time code out of band, and both sides verify User and Hub fingerprints. Successful pairing creates only a contact. It does not discover, register, or authorize any Agent.

### 7.3 联系人授予与不授予的能力 / What a contact grants—and does not grant

`trusted` 联系人可以互发人类消息、创建/打开 direct Room、发送 Room 邀请，并接收所有者主动发布的 `public` Agent Card。它不授予 Room membership、Agent discovery beyond explicit cards、Agent admission 或 A2A 调用权。

A trusted contact may exchange human messages and room invitations and may receive owner-published public cards. It grants no implicit room membership, agent admission, or A2A invocation right.

解除或 block 联系人必须撤销后续投递和相关 Agent 能力，但不得删除历史。所有 contact、Room 和 Agent 撤销事件都必须可审计。

Removing or blocking a contact revokes future delivery and related capabilities without deleting history. Contact, room, and agent revocations are auditable separately.

---

## 8. Room 设计 / Room Design

### 8.1 模型 / Model

- `kind=direct` 是两个 User 的 Room；`kind=group` 是命名多人 Room。
- 新跨用户会话统一使用 `type=room` 并关联 `roomId`。旧 `cross_hub` 只作迁移期读取兼容，不得用于新建。
- 人类成员与 Agent 成员是两张独立列表。Relay 维护 Hub 投递 membership；Local Hub 维护 User role、Agent membership 和本地会话映射。
- 每条 Room Agent 记录包含 `agentId`、`ownerUserId`、`ownerHubId/homeHubId`、可见性和身份快照。

A direct message is a two-person room; named rooms are groups. New cross-user conversations use `type=room`. Human and agent memberships are separate, and every room agent has an owner and one execution Hub.

### 8.2 角色与权限 / Roles and permissions

| 操作 / Action | 管理员 / Administrator | 普通成员 / Member |
|---|---:|---:|
| 邀请联系人 / Invite contacts | 是 / Yes | 否 / No |
| 委派管理员 / Delegate admin | 是 / Yes | 否 / No |
| 移除人类成员 / Remove humans | 是 / Yes | 否 / No |
| 添加自己的 Agent / Add own agent | 是 / Yes | 是 / Yes |
| 添加他人的 Agent / Add another user's agent | **否 / Never** | **否 / Never** |
| 移除自己的 Agent / Remove own agent | 是 / Yes | 是 / Yes |
| 移除他人的 Agent / Remove another user's agent | 是，需通知、审计、rekey / Yes, with notice, audit, and rekey | 否 / No |
| 退出 Room / Leave room | 是 / Yes | 是 / Yes |

创建者默认是管理员，角色绑定 User。只有所有者能发出有效 `room_agent_upsert`。管理员移除他人 Agent 时，必须通知该 User 的所有绑定 Hub，审计 `roomId`、`agentId`、`ownerUserId`、`actorUserId`、时间和原因，并触发 rekey。

The creator is an administrator by default. Only an owner can admit their agent. An administrator may remove another user's agent only with owner notification across bound Hubs, a complete audit event, immediate authorization revocation, and rekeying.

### 8.3 创建与邀请 / Creation and invitation

1. Local Hub 创建 direct/group Room 和本地 `type=room` 会话。
2. Relay 创建路由 Room 并返回 `roomId`、成员 Hub ID 与公钥。
3. 管理员只可邀请已配对联系人；受邀者收到 `room_invite`。
4. 对方明确接受后发送 `room_accept`，才成为人类成员并获得当前 Room key。
5. 拒绝、过期或待接受邀请不得产生 membership。

The Local Hub creates the conversation and the Relay routing room. Only paired contacts may be invited, and an explicit acceptance is required before membership and key distribution.

### 8.4 Agent 加入与移除 / Agent admission and removal

加入 Agent 时必须同时满足：`actorUserId === agent.ownerId`、操作者是 Room 人类成员、Agent visibility 为 `room|public`、manifest scope 与 `roomId` 匹配。否则返回 `403 AGENT_OWNER_REQUIRED`、`403 AGENT_NOT_IN_ROOM` 或相应 visibility 错误。

Agent admission requires owner equality, human room membership, eligible visibility, and matching room scope. A remote member cannot browse or add another user's hidden agents.

加入成功后广播签名的 `room_agent_upsert`、注册 Room-scoped 能力并 rekey。所有者移除、管理员移除、改回 `private`、删除 Agent 或所有者离开 Room 时发送 `room_agent_remove`/revoke，立即阻止新调用并 rekey。

Admission publishes a signed event and triggers rekeying. Any removal, privacy downgrade, deletion, or owner departure revokes new calls immediately and rekeys the room.

### 8.5 @mention 与消息路由 / @mention and message routing

```text
User A sends "@Codex review this" in Room R
→ Hub A resolves exactly by (roomId, agentId), then reads homeHubId
→ payload includes signed/encrypted toAgentId + homeHubId
→ Hub A encrypts with Room key and sends to "room:R"
→ Relay fans out ciphertext to online member Hubs and queues it for offline Hubs
→ every Hub stores/displays the same room message
→ only Codex's homeHubId validates membership and invokes Codex
→ encrypted streaming responses return to "room:R" and are fanned out
```

- Relay fan-out 只同步 Room 历史，不代表每个 Hub 都执行 Agent。
- 有 `@` 时仅目标 Agent 的 `homeHubId` 执行；不得按名称广播，也不得由同 User 的其他 Hub 代执行。
- 无 `@` 时只处理人类 Room 消息或显式选择的会话主 Agent。只有用户明确选择 broadcast 时才可调用多个 Agent。
- 远程调用继续执行 `auto/confirm/deny`；可信远程默认 `confirm`。

Room fan-out distributes history, while application dispatch remains narrow. Only the authenticated target home Hub invokes a mentioned agent. Display-name broadcast and implicit multi-agent dispatch are forbidden.

### 8.6 多设备同步 / Multi-device synchronization

- `room_agent_upsert`、`room_agent_remove`、人类 membership 和 role 事件同步到同一 User 的所有有效绑定 Hub。
- 其他 Hub 只展示状态；只有 Agent 的 `ownerHubId` 实际执行。
- owner Hub 离线时，UI 立即显示 `Agent unavailable (owner offline)`；Relay 可在 TTL 内保留加密 mention，owner Hub 上线并重新验证后处理。
- 设备撤销后不再接收新 Room key 或状态；剩余成员必须 rekey。

Signed room state converges across all Hubs bound to a User, but execution never migrates implicitly. An offline owner Hub may later process queued ciphertext within TTL after re-validation.

---

## 9. 离线消息与状态机 / Offline Messages and State Machines

### 9.1 Relay 连接状态 / Relay connection state

```text
disconnected → connecting → connected
                    └─ failure → reconnecting → connected
                                      └─ retries exhausted → error
```

保存 Relay 配置与建立连接是两个动作。保存成功后 500 ms 内显示“保存成功，正在连接”，配置在重启后保留；连接失败显示最近错误和“重试”，不能撤销已成功的保存。

Saving configuration and connecting are separate operations. Persistence feedback appears within 500 ms, while connection state and retry errors remain independently visible.

### 9.2 消息投递与执行状态 / Delivery and execution state

```text
queued → delivered → accepted → done
                    ├→ denied
                    └→ error
queued ── TTL elapsed → expired
```

| 状态 / State | 定义 / Definition |
|---|---|
| `queued` | Relay 已持久化密文；目标尚未确认 / Relay persisted ciphertext; target has not acknowledged |
| `delivered` | 目标 Hub 已持久化并发送 `delivery_ack` / Target Hub persisted it and acknowledged |
| `accepted` | 目标通过授权并接受处理 / Target authorization accepted processing |
| `denied` | trust、membership、visibility 或策略拒绝 / Trust, membership, visibility, or policy rejected it |
| `done` | Agent/人类处理成功 / Processing completed successfully |
| `error` | 已接受但执行失败 / Accepted, but execution failed |
| `expired` | 默认 7 天 TTL 到期仍未完成投递 / Default seven-day TTL elapsed before delivery |

`queued` 不表示 Agent 已执行；`delivered` 也不表示调用获准。客户端不得让过期消息长期停留在 queued。

Queued is not executed, and delivered is not authorized. Expired messages MUST leave the queued state.

### 9.3 离线存储 / Offline store

- 目标 Hub 离线时，Relay 将完整加密 envelope 写入 SQLite `offline_messages`。
- Hub 上线后收到批量 `offline_messages`；本地持久化成功才发送 `delivery_ack`，Relay 收到 ack 后删除。
- 默认 TTL 为 7 天，可通过 `RELAY_OFFLINE_TTL_DAYS` 配置。过期时若发送方可达则通知 `expired`。
- 离线记录只含密文和路由元数据。幂等、顺序和 revoke 优先级遵循 §3.5。
- 单实例使用 WAL、同步刷盘和周期 checkpoint；多实例需要具备等价持久性语义。

The Relay stores ciphertext durably while a target is offline and deletes it only after the target persists and acknowledges it. TTL, ordering, idempotency, and revoke precedence are protocol semantics, not implementation details.

---

## 10. 安全与隐私 / Security and Privacy

### 10.1 安全控制 / Security controls

| 层面 / Layer | 控制 / Control |
|---|---|
| 传输 / Transport | 公网 WSS/TLS；P2P 互认证 / WSS/TLS publicly; mutually authenticated P2P |
| 身份 / Identity | Ed25519 Hub/User 签名、双签名 binding、指纹核验 / Ed25519 signatures, dual-signed binding, fingerprint verification |
| 消息 / Message | direct 使用 `crypto_box`；Room 使用 AES-256-GCM group key / Pairwise `crypto_box`; AES-256-GCM room key |
| 重放 / Replay | UUID、唯一 nonce、5 分钟握手窗口、LRU/数据库幂等 / IDs, unique nonces, five-minute handshake window, durable idempotency |
| 授权 / Authorization | own=`auto`，trusted remote=`confirm`，unknown/stale=`deny` / Own auto, trusted remote confirm, unknown or stale deny |
| 目录 / Directory | 最小披露、User 签名、scope、版本、TTL、主动撤销 / Minimal signed scoped manifests with version, TTL, and active revocation |
| Relay 隔离 / Relay isolation | JWT 不授予 Agent 权限；Relay 不持有明文 key / JWT grants no agent permission; Relay has no plaintext key |
| 速率 / Rate limits | direct 50/s、group 20/s、broadcast 5/s，每 Hub / Per Hub: direct 50/s, group 20/s, broadcast 5/s |
| 滥用 / Abuse | 可选注册 invite code、大小限制、审计和 block / Optional registration invite, size limits, audit, and block |

### 10.2 默认权限 / Default permissions

| 对象 / Object | 默认 / Default | 可配置 / Configurable |
|---|---|---|
| User Card | 只对已配对 Hub 显示最小资料 / Minimal data to paired Hubs only | 房间内名称/头像披露 / Room name/avatar disclosure |
| Agent | `private` | `private` / `room` / `public` |
| A2A | 自有 `auto`，可信远程 `confirm`，陌生 `deny` / Own auto, trusted remote confirm, unknown deny | Agent 级、会话级 `auto/confirm/deny` |
| Context | 当前消息和明确构造的 `ContextPacket` / Current message and explicit ContextPacket | 文件、路径、历史摘要、工具结果 / Files, paths, history summary, tool results |

内容扩展必须由用户明确选择。API key、credential 和未选择的本地上下文不得跨设备发送。

Context expansion requires explicit user choice. Credentials and unselected local context MUST NOT cross devices.

### 10.3 Relay 可见元数据 / Relay-visible metadata

E2E 加密隐藏正文和目录，但 Relay 仍可观察 Hub ID、源/目标或 Room、时间、密文大小、在线状态和 IP。产品不得宣称“Relay 看不到任何信息”。不接受该 threat model 的用户应使用自托管 Relay、P2P，或未来的流量填充/匿名网络。

E2E encryption hides content and directory data, not traffic metadata. The product MUST disclose that the Relay can observe Hub IDs, routing destination or room, timing, ciphertext size, presence, and IP addresses.

### 10.4 必须通过的安全验收 / Required security acceptance

- 配对后自动创建的远程 Agent 记录为 0；同名误路由为 0。
- 非所有者加入 Agent 返回 `403 AGENT_OWNER_REQUIRED`；未入房 Agent 调用返回 `403 AGENT_NOT_IN_ROOM`。
- 非管理员邀请或移除他人返回 `403 ROOM_ADMIN_REQUIRED`。
- 撤销在线 60 秒内收敛，历史不丢失，后续调用被拒绝。
- 公钥变化需要重新配对；重放、陈旧 manifest 和过期 invitation 被拒绝。
- 两台真实设备必须覆盖 Relay/P2P、在线/离线、重名、重放、撤销、key 变化、拒绝与 fallback。

Security acceptance requires zero pairing leakage and name-based misrouting, strict owner/admin enforcement, rapid revocation, key-change re-pairing, replay resistance, and a real two-device E2E matrix.

---

## 11. 用户指南 / User Guide

### 11.1 连接 Relay / Connect to a Relay

1. 打开 **设置 → 跨设备协作 / Settings → Cross-device Collaboration**。
2. 输入其他设备可访问的地址，如 `wss://relay.example.com/ws` 或可信 LAN 中的 `ws://192.168.1.20:3211/ws`。
3. 除显式开发模式外，前后端都拒绝 `localhost`、`127.0.0.0/8` 和 `::1`。公网优先使用 `wss://`。
4. 设置 Hub 显示名并保存。先确认保存 Toast，再观察 `connecting/connected/reconnecting/error`。

Open the collaboration settings, enter an externally reachable Relay URL, and save. Loopback addresses are rejected outside explicit development mode. Save success and connection success are shown separately.

自部署 / Self-host:

```bash
docker run -d -p 3211:3211 \
  -e RELAY_JWT_SECRET=replace-with-a-strong-secret \
  -v relay-data:/data \
  agentlink/relay:latest
```

生产环境在 Relay 前配置 TLS 反向代理。/ Put a TLS reverse proxy in front of a production Relay.

### 11.2 添加好友 / Add a contact

1. 在侧边栏点击 **添加好友 / Add Contact**，输入对方完整 Hub ID。
2. 发送配对请求，并通过可信渠道交换一次性码。
3. 双方核对 User/Hub 指纹后确认。
4. 联系人区域只出现最小名片和在线状态；此时看不到对方 Agent，这是预期行为。

Enter the full Hub ID, exchange the one-time code through a trusted channel, and verify fingerprints. Pairing creates a contact card only; seeing no remote agents is the correct result.

### 11.3 创建 Room / Create a room

1. 点击联系人选择 **发消息 / Message**，创建或复用 direct Room；或选择 **创建聊天室 / Create Room** 创建 group Room。
2. 管理员从已配对联系人中发送邀请。对方接受前不会入房。
3. 人类成员在成员面板中分开显示；任何人都不能替别人选择 Agent。

Messaging a contact opens a direct room; a named room supports multiple contacts. Invitations require explicit acceptance, and human members are shown separately from agents.

### 11.4 加入 Agent 并协作 / Add agents and collaborate

1. Agent 默认 `private`。所有者先按需要改为 `room` 或 `public`。
2. 每位成员点击 **添加我的 Agent / Add My Agent**，只选择自己拥有的 Agent。
3. 只能 `@` 已由所有者加入当前 Room 的 Agent；`@` 不会发现隐藏 Agent。
4. 远程调用遵循 `auto/confirm/deny`，可信远程默认请求确认。
5. 对方离线时查看 `queued`/`Agent unavailable`，而不是假定消息丢失或已执行。
6. 移除 Agent、改回 `private`、离房或解除联系人后，新调用立即停止；历史仍保留。

Each participant explicitly brings only their own eligible agents into the room. Mentions address admitted room agents only, remote calls follow the permission policy, and revocation stops new calls without deleting history.

### 11.5 常见失败 / Common failures

| 状态 / State | 用户动作 / User action |
|---|---|
| Relay 地址不可达 / Relay unreachable | 检查公网/LAN 可达性、TLS 与防火墙 / Check reachability, TLS, and firewall |
| 配对码错误或过期 / Pairing code invalid/expired | 重新生成并核验指纹 / Generate a new code and verify fingerprints |
| 邀请待接受 / Invitation pending | 等待对方明确接受 / Wait for explicit acceptance |
| Agent 未入房 / Agent not in room | 请所有者添加其 Agent / Ask the owner to add the agent |
| 等待确认 / Awaiting confirmation | 由目标所有者批准或拒绝 / Target owner approves or denies |
| Owner Hub 离线 / Owner Hub offline | 等待 TTL 内上线，或联系所有者 / Wait for reconnect within TTL or contact the owner |
| 消息过期 / Message expired | 目标上线后重新发送 / Resend after the target returns |

---

## 12. API 端点清单 / API Endpoint Inventory

### 12.1 Relay REST API

Relay API 只管理 Hub 路由和加密 Room envelope。/ Relay APIs manage Hub routing and encrypted room delivery only.

| 方法 / Method | 端点 / Endpoint | 语义 / Semantics |
|---|---|---|
| POST | `/api/hubs/register` | 注册 Hub 并返回 JWT、`relayHubId` / Register a Hub and return JWT and Relay ID |
| GET | `/api/hubs/:id` | 获取 Hub 公钥与最小信息 / Fetch Hub public key and minimal metadata |
| DELETE | `/api/hubs/:id` | 注销 Hub，清除其公钥和离线消息 / Deregister a Hub and clear its key/offline queue |
| POST | `/api/hubs/discover` | 按精确 Hub ID 查询 presence；不是目录搜索 / Exact Hub presence lookup, not directory search |
| POST | `/api/rooms` | 创建 Relay 路由 Room / Create a Relay routing room |
| GET | `/api/rooms/:id` | 获取 Room 路由信息、成员 Hub 与公钥 / Get routing room, member Hubs, and public keys |
| POST | `/api/rooms/:id/join` | 使用已接受 invitation 加入 / Join with an accepted invitation |
| POST | `/api/rooms/:id/leave` | 离开 Relay 路由 Room / Leave the routing room |
| POST | `/api/rooms/:id/invite` | 将加密邀请路由给目标 Hub / Route an encrypted invitation |
| GET | `/api/health` | 存活与就绪检查 / Liveness/readiness check |

### 12.2 Local Hub REST API

Local Hub 执行 Contact、owner、role、visibility、permission 和本地会话规则。/ The Local Hub enforces contacts, ownership, roles, visibility, permissions, and local conversation mapping.

| 方法 / Method | 端点 / Endpoint | 语义 / Semantics |
|---|---|---|
| PATCH | `/api/hub/config` | 验证并持久化 Relay 配置；异步连接 / Validate and persist Relay config, then connect asynchronously |
| GET | `/api/hub/status` | 返回连接状态、路径、延迟与最近错误 / Return connection state, path, latency, and latest error |
| POST | `/api/contacts/pairing-requests` | 按 Hub ID 创建一次性配对请求；不请求目录 / Create one-time pairing request without directory access |
| POST | `/api/contacts/pairing-requests/:id/confirm` | 校验配对码/指纹并创建 Contact / Verify code/fingerprints and create contact |
| GET | `/api/contacts` | 只列最小 Contact Card 和 presence / List minimal contact cards and presence |
| POST | `/api/rooms` | 创建 `direct`/`group` Room 与 `type=room` 会话 / Create room and local room conversation |
| POST | `/api/rooms/:id/invitations` | 管理员邀请已配对联系人 / Admin invites a paired contact |
| POST | `/api/rooms/:id/invitations/:inviteId/accept` | 被邀请者明确接受 / Invitee explicitly accepts |
| POST | `/api/rooms/:id/agents` | 所有者加入自己的 `room/public` Agent / Owner adds their own eligible agent |
| DELETE | `/api/rooms/:id/agents/:agentId` | 所有者或管理员移除；只有所有者能重新加入 / Owner/admin removes; only owner may re-add |
| GET | `/api/users` | Owner-aware User 发现；支持分页与 stale 状态 / Owner-aware user discovery with pagination/stale state |

所有 mutation 端点必须校验经过认证的 actor，返回稳定错误码，并写入不含敏感正文的审计事件。客户端 token 必须有 hash、`clientId/userId`、scope、expiry 和 revoke；WebSocket 使用短期 ticket，默认只绑定 loopback。

Every mutation authenticates its actor, returns stable error codes, and writes a content-safe audit event. Client tokens are hashed, scoped, expiring, and revocable; WebSockets use short-lived tickets and default to loopback binding.

### 12.3 协议 API / Protocol API

WebSocket frame 清单见 §5.3；加密 payload 的完整消息类型见 §3.3。实现不得添加绕过 `HubEnvelope` 的明文业务帧。新增端点或消息类型必须先更新本文、定义权限边界、错误码、幂等键和协议兼容策略。

The WebSocket frame inventory is in §5.3 and payload types are in §3.3. No plaintext business frame may bypass `HubEnvelope`. New APIs require this document to define authorization, errors, idempotency, and compatibility first.

---

## 13. 开发任务与优先级 / Development Tasks and Priorities

### 13.1 状态口径 / Status convention

截至 2026-08-04，Relay、Hub Client、P2P、Hybrid 和跨 Hub Room 的基础代码已存在；详细任务表将身份、协议、权限、Owner-aware UI/API、多 Hub 与扩展工作标为完成。但“代码存在”不等于发布完成：真实双设备 E2E 与 Tauri 生产包验证仍是发布阻断项。旧摘要中“未完成”与详细行冲突时，以详细任务行和本节归一化状态为准。

As of 2026-08-04, transport and room foundations exist, and detailed task rows report identity, protocol, security, owner-aware UX/API, multi-Hub, and scaling work as complete. Release readiness still requires real two-device E2E and packaged-Tauri validation. This normalized table supersedes contradictory legacy summaries.

### 13.2 归一化任务表 / Normalized task table

| 优先级 / Priority | ID / Area | 交付物 / Deliverable | 依赖 / Dependency | 状态 / Status |
|---|---|---|---|---|
| P0 | ID-01..04 | User schema、双签名 binding、Agent owner、会话迁移 / Identity, binding, ownership, migration | — | 已完成 / Done |
| P0 | PROTO-01 | HubPayload v2、兼容读取、拒绝策略 / Payload v2 and compatibility policy | ID-02 | 已完成 / Done |
| P0 | DISC-01..02 | 签名目录、事务注册、撤销、stale / Signed directory, atomic registration, revoke/stale | PROTO-01, ID-03 | 已完成 / Done |
| P0 | SEC-01..03 | Trust、入站授权、离线状态与幂等 / Trust, inbound authorization, offline semantics | Identity + directory | 已完成 / Done |
| P0 | FLOW-01 | Contact → Room → owner-only Agent 流程必须完全替代自动目录/直接远程 Agent 旧入口 / Enforce the normative contact-room-owner flow everywhere | P0 foundation | 集成验收 / Integration acceptance |
| P1 | API-01..02 | Owner-aware discovery、scoped token、WS ticket / Owner-aware APIs and scoped access | P0 | 已完成 / Done |
| P1 | UI-01..03 | Owner 分组、Room 会话、隐私/权限设置 / Owner grouping, room UI, privacy controls | API + security | 已完成 / Done |
| P1 | EXT-01 | 外部 Agent discovery/send/stream/error 契约测试 / External-agent conformance | API-01..02 | 已完成 / Done |
| P1 | TEST-01 | 两设备 E2E：Relay/P2P、在线/离线、重名、重放、撤销、key 变化、拒绝、fallback / Real two-device matrix | SEC-03, UI-02 | **未完成，发布阻断 / Open, release blocker** |
| P1 | PKG-01 | Tauri sidecar 生产包验证：mDNS、端口、防火墙、macOS entitlement / Packaged sidecar validation | TEST-01 | **未完成，发布阻断 / Open, release blocker** |
| P2 | SCALE-01 | `user_hubs`、设备撤销、多 Hub 聚合 / Multi-Hub User state | P1 foundation | 已完成 / Done |
| P2 | SCALE-02 | 大群加密/rekey 扩展；启用须协议协商 / Scalable group crypto with negotiated activation | TEST-01 | 代码完成，待 E2E / Code done, E2E pending |
| P2 | STD-01 | Google A2A/MCP/ACP identity/capability adapter / Standards adapters | EXT-01 | 已完成 / Done |
| P2 | OPS-01 | 元数据 retention、padding 评估、滥用检测、自托管基线 / Metadata hardening and ops baseline | TEST-01 | 代码/设计完成，运维待验证 / Code/design done, ops validation pending |
| P2 | RELAY-OPS | 官方 Relay 实例、TLS、监控、备份 / Official Relay deployment and operations | TEST-01, OPS-01 | 未完成 / Open |

### 13.3 发布门槛 / Exit criteria

1. 所有 Agent 都有有效 owner；升级/回滚后历史可读，同名误路由为 0。
2. 配对不会创建远程 Agent；owner-only 入房、管理员规则和 60 秒撤销通过验收。
3. 可信远程调用默认 confirm，unknown/stale deny；重放不产生重复执行。
4. 两台真实设备分别经 Relay 与 P2P 跑完 TEST-01，失败不产生半注册 User/Agent。
5. Tauri macOS/Windows/Linux 生产构建验证 mDNS、P2P listener、系统权限和 Relay fallback。
6. Relay 通过持久性、TTL、ack-delete、速率限制、TLS、备份和日志隐私检查。

Release requires identity correctness, zero pairing leakage, owner/admin enforcement, revocation and replay safety, a real two-device Relay/P2P matrix, packaged desktop validation, and Relay operational checks.

---

## 14. 设计参考 / Design References

### 14.1 仓库来源 / Repository sources

- [`RELAY_DESIGN.md`](./RELAY_DESIGN.md)：历史协议、Relay、P2P、Room、加密与任务拆解 / Historical protocol and transport design.
- [`PRD.md`](./PRD.md)：多用户产品规则、权限、交互与验收 / Product rules, permissions, interaction, and acceptance.
- [`GUIDE.md`](./GUIDE.md)：跨设备用户操作流程 / Cross-device user workflow.
- [`DEV_PLAN.md`](../DEV_PLAN.md)：实现状态、任务依赖与发布门槛 / Implementation status, dependencies, and release gates.

这些文件不再是跨设备实现的规范来源；后续协议、权限、API、用户流程或任务优先级变更必须先修改本文，再同步其他面向产品或用户的摘要。

These files are no longer normative for cross-device implementation. Any protocol, authorization, API, user-flow, or priority change MUST update this document first; other product and user summaries follow it.

### 14.2 外部设计参考 / External references

- [Google A2A Agent Cards](https://google.github.io/A2A/latest/specification/)：借鉴由所有者选择发布、最小且可撤销的能力卡；AgentLink 不在配对后抓取全量目录。
- [Discord OAuth2/Bots](https://discord.com/developers/docs/topics/oauth2) 与 [Slack OAuth](https://api.slack.com/authentication/oauth-v2)：借鉴 room/workspace-first、再显式安装 bot/app 的授权顺序。
- [Agent Client Protocol (ACP)](https://agentclientprotocol.com/)：借鉴客户端与 Agent 的明确控制边界；AgentLink 额外要求跨用户 trust、Room scope 与 owner authorization。
- Ed25519/X25519、XSalsa20-Poly1305 与 AES-256-GCM 的具体实现必须使用经过审计的 libsodium/平台密码库，不得自行实现密码原语。

The interaction model combines opt-in A2A-style capability cards, room-first bot admission, and ACP-style ownership boundaries. AgentLink's local-first identity, E2E envelopes, scoped room agents, and Relay metadata boundary remain architecture-specific.

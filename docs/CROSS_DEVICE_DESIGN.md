# Chorus 跨设备通信设计 / Cross-Device Communication Design

> 最后更新 / Last updated: 2026-08-04  
> 状态 / Status: **规范性设计（后续跨设备通信实现的唯一参考）/ Normative design and the single source of truth for future cross-device communication work**

本文整合并取代 `RELAY_DESIGN.md`、`PRD.md`、`GUIDE.md` 与 `DEV_PLAN.md` 中分散的跨设备通信规则。上述文件保留为历史背景；若其跨设备内容与本文冲突，以本文为准。协议关键字“必须 / MUST”“不得 / MUST NOT”“应该 / SHOULD”具有规范含义。

This document consolidates and supersedes the cross-device rules previously spread across `RELAY_DESIGN.md`, `PRD.md`, `GUIDE.md`, and `DEV_PLAN.md`. Those files remain historical context; this document takes precedence for cross-device behavior. “MUST”, “MUST NOT”, and “SHOULD” are normative.

---

## 1. 概述与设计原则 / Overview and Design Principles

Chorus 连接不同设备上的 User、Hub 与 Agent，同时保持本地优先。单机功能不依赖 Relay；跨设备传输可使用公网 Relay、局域网 P2P，或自动选择路径的混合模式。

Chorus connects users, device hubs, and agents while remaining local-first. Local use never depends on a Relay. Cross-device transport may use a public/self-hosted Relay, LAN P2P, or a hybrid path selector.

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

- 每个 Hub 首次启动生成 Ed25519 密钥；私钥通过复用 `credential-store` 存入系统钥匙串，`data/hub-keypair.json` 只保存公钥和非敏感元数据。
- `hubId` 是完整 Ed25519 公钥 hex；Hub 指纹为 `hex(SHA-256(raw Ed25519 public key)[0:16])`，即 SHA-256 的前 128 bit、共 32 个 hex 字符。UI 必须显示完整 32 字符指纹，不得再以更短截断值作为安全核验依据。
- Hub 显示名不唯一，不能参与授权或路由。
- Hub 通过 Relay 注册、JWT 和 Ed25519 challenge-response 证明设备身份。

Each Hub has an Ed25519 key pair. Its private key is stored in the OS keychain through the shared `credential-store`; `data/hub-keypair.json` contains only the public key and non-sensitive metadata. The full public-key hex is the Hub ID, while the security fingerprint is the first 128 bits of SHA-256 over the raw public key, rendered as all 32 hex characters. Display names are non-unique and never authorize or route traffic.

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
  keyEpoch?: number;          // required for every Room-key-encrypted envelope
  ciphertext: string;         // encrypted HubPayload, base64
  signature: string;          // sender Ed25519 signature, base64
  relayTimestamp?: number;    // Relay-added, untrusted ordering fallback
}
```

发送方签名覆盖除 `signature` 和 `relayTimestamp` 外的所有发送方字段的 RFC 8785 JCS 规范序列化。`relayTimestamp` 由 Relay 转发时添加，只能用于排序兜底，不能参与身份、权限或重放判断。

The sender signs the RFC 8785 JCS serialization of every sender-owned field except `signature` and `relayTimestamp`. The Relay-added timestamp is an untrusted ordering hint only and MUST NOT affect identity, authorization, or replay decisions.

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
    | "resync_request" | "resync_response"
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
  roomId?: string;
  roomRevision?: number;
  keyEpoch?: number;          // must equal the authenticated envelope keyEpoch
  ownerProof?: OwnerProof;
  directory?: DirectoryManifest;
  metadata?: Record<string, unknown>;
}
```

Room 密钥加密的每个 envelope 和其加密 payload 必须都携带相同的 `keyEpoch`；接收方必须先按 envelope 的 epoch 选择密钥，解密后再校验两处 epoch 相等。`delivery_ack` 仍是加密的 E2E 业务确认（例如接收、拒绝或处理结果），Relay 不得解析它，也不得依据它删除离线消息。

Every room-key-encrypted envelope and its encrypted payload MUST carry the same `keyEpoch`. The receiver selects the epoch key from the authenticated envelope and then verifies the decrypted value matches. `delivery_ack` remains an encrypted end-to-end business acknowledgement; the Relay neither parses it nor uses it to delete queued ciphertext.

投递层另定义 Relay 可读的明文控制帧；它不属于 `HubPayload`，不表达业务是否接受或执行成功：

The delivery layer separately defines a Relay-readable plaintext control frame. It is not a `HubPayload` and conveys no application acceptance or execution result:

```typescript
interface TransportReceipt {
  type: "transport_receipt";
  messageId: string;          // the persisted HubEnvelope.id
  recipientHubId: string;
  status: "persisted";
  timestamp: number;
  signature: string;          // recipient Hub signature over all preceding fields
}
```

Relay 必须验证 `recipientHubId` 与已认证连接一致并验证签名；只有匹配待投递记录的 `transport_receipt(status="persisted")` 才能删除该记录。明文 `messageId` 仅是投递幂等键，不泄露加密 payload 内的业务确认。

The Relay verifies that `recipientHubId` matches the authenticated connection and verifies the signature. Only a matching `transport_receipt(status="persisted")` may delete an offline record. Its plaintext `messageId` is a transport idempotency key, not the encrypted business acknowledgement.

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
| 状态同步 / State sync | `resync_request`, `resync_response` | 按 Room revision 请求和返回增量状态 / Request and return incremental state by Room revision |
| E2E 确认 / E2E acknowledgement | `delivery_ack` | 加密的业务接收、拒绝或处理语义；Relay 不可读 / Encrypted application receipt, rejection, or processing semantics; opaque to Relay |
| 传输回执 / Transport receipt | `transport_receipt`（明文控制帧 / plaintext control frame） | Hub 持久化成功后供 Relay 删除离线记录；不代表业务接受或执行 / Lets Relay delete an offline record after durable persistence; no application acceptance or execution meaning |

`contact_*`、`room_*`、`room_agent_*` 属于不同授权域。`contact_accept` 后不得自动发送目录请求；`room_accept` 只加入人类成员；只有所有者签名的 `room_agent_upsert` 才使 Agent 在该 Room 可寻址。

Contact, room-human, and room-agent events are separate authorization domains. Accepting one MUST NOT imply the next.

### 3.4 接收验证顺序 / Receive validation order

全协议唯一的规范序列化是 RFC 8785 JSON Canonicalization Scheme（JCS）。所有签名对象，包括 envelope、manifest、owner proof 和授权/rekey event，都必须对移除签名字段后的完整对象执行 JCS，并以其 UTF-8 bytes 作为签名或验签输入；不得使用实现自定义的字段顺序、空白或“canonical JSON”变体。

RFC 8785 JSON Canonicalization Scheme (JCS) is the protocol's sole canonical serialization. Every signed envelope, manifest, owner proof, and authorization/rekey event MUST be signed and verified over the UTF-8 bytes of the complete object after removing its signature field and applying JCS. Implementation-specific field ordering, whitespace, or other “canonical JSON” variants are forbidden.

1. 验证协议版本、必填字段、大小限制、UUID 和时间窗口。
2. 用 `from` Hub 公钥验证 envelope 签名、nonce 和重放缓存；Room 消息还必须选择对应 `keyEpoch` 的 key。
3. 解密 payload，并确认内部目标、`keyEpoch` 与 envelope 路由一致。
4. 验证 `UserHubBinding`，再验证 User 签名的目录或成员事件。
5. 验证 Contact/Room/Agent membership、可见性、trust 和 `mention/call/off` 策略。
6. 只有目标 `homeHubId` 可以执行 Agent；其他 Hub 仅保存和展示。
7. 任一步失败均拒绝并记录不含正文、凭据或目录详情的安全审计事件。

The receiver validates syntax, Hub signature and replay protection, decryption and target consistency, User–Hub binding, owner signatures, membership, visibility, trust, and invocation policy—in that order. Any failure is fail-closed and safely audited.

### 3.5 去重与排序 / Deduplication and ordering

- `id` 和 `messageId` 必须全局唯一；接收方至少维护最近 1000 个 ID 的 LRU，并对二者提供数据库唯一约束。即使 `transport_receipt` 丢失导致 Relay 重投，同一 `messageId` 也只能持久化和处理一次，但接收方必须再次发送 receipt。
- 同一发送方与会话优先按 `sequence` 排序；否则按 `timestamp`，容忍 ±5 秒偏差，并以 `relayTimestamp` 作 UI 排序兜底。
- `directory_revoke` 优先于更旧的 `directory_announce`；到达顺序不能覆盖更高 `directoryVersion`。

IDs are idempotency keys. A redelivery caused by a lost transport receipt MUST be persisted and processed at most once, while the receiver re-emits the receipt. Sequence is preferred for per-conversation ordering; sender time and then Relay time are display fallbacks. A newer revoke or directory version always wins over older arrival order.

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

- v1 规范默认由 `GroupKeyManager` 管理 AES-256-GCM Room key。Room 保存单调递增的 `keyEpoch`；初始 epoch 为 `1`，每次 rekey 必须恰好加 `1`，不得回退或复用。
- 每条 Room 密文必须携带 `keyEpoch`。接收方按 epoch 取 key；未知或过期 epoch 必须拒绝并触发 §8.6 的 resync，不得尝试当前 key 或其他 key。
- 同一 epoch 中，96-bit GCM nonce 固定为 `senderHubNonceId (8 bytes) || counter (4 bytes, unsigned big-endian)`。`senderHubNonceId` 是 `SHA-256(hubId UTF-8)` 的前 8 bytes；每个 Hub 对每个 Room/epoch 原子持久化自己的 counter，首次取值为 `0`，每条密文加 `1`，不得回绕或在崩溃恢复后复用。
- counter 仅在成功安装新 epoch key 后重置为 `0`；到达 `2^32 - 1` 前必须 rekey。接收方按 `(roomId, keyEpoch, senderHubNonceId, counter)` 检测重复 nonce，发现碰撞即拒绝并记录安全事件。
- Room 创建/加入后，通过各成员 Hub 的成对加密通道分发当前 epoch key。Relay 只见密文。
- Agent 加入、Agent 移除、人类成员离开或被移除时必须 rekey；旧 key 立即禁止用于加密新消息，但必须仅为解密在途消息保留 5 分钟 grace period，之后安全销毁。
- rekey 事件必须引用 `baseRevision` 和 `baseKeyEpoch`，携带 `newRevision = baseRevision + 1`、`newKeyEpoch = baseKeyEpoch + 1` 和 `keyCommitment`，并以 RFC 8785 JCS 序列化后签名。`keyCommitment = hex(HMAC-SHA-256(newRoomKey, UTF8(roomId) || uint64be(newKeyEpoch)))`；这里 `||` 是无歧义的字节拼接。
- 每个成员 Hub 通过成对加密通道收到新 key 后，必须自行计算 HMAC 并以常量时间比较 `keyCommitment`。不一致表示同一 epoch 的 key 分发发生分歧；接收方必须拒绝安装该 rekey、记录安全事件并触发 §8.6 resync。
- rekey 必须通过 Room 状态的 compare-and-swap 提交。使用 Relay 时，Relay 为每个 Room 原子维护权威 `(revision, keyEpoch)` 计数器并处理 §5.3 的 `room_cas`；它只决定并发提案的先后，不接收 key、commitment 明文含义或事件内容。只有一个提案可成为下一 `revision/keyEpoch`，失败方必须先 resync 再重试。
- P2P-only 时，由 owner Hub 作为 CAS 仲裁者并持久化该计数器；Agent 变更触发的 rekey 由该 Agent 所有者的 Hub 决定顺序。参与方必须验证 owner 身份和签名，失败提案同样先 resync 再重试。
- Room 人数不超过 5 时，可协商逐成员加密 fallback；授权、审计和撤销语义不变。
- MLS 或其他大群方案只能作为新协议版本/能力协商启用，不得静默改变 v2 密文格式。

The normative v1 room scheme is an epoch-indexed AES-256-GCM key managed by `GroupKeyManager`. Every ciphertext identifies its epoch and uses the per-sender nonce `senderHubNonceId(8) || counter(4)`. Counters are atomic and durable per room/epoch, reset only after a successful rekey, and never wrap. Each JCS-signed rekey event commits to the distributed key with `hex(HMAC-SHA-256(newRoomKey, UTF8(roomId) || uint64be(newKeyEpoch)))`; recipients reject and resync on a mismatch. With a Relay, its atomic per-room `(revision, keyEpoch)` counter arbitrates only CAS ordering and reveals no key or event content. In P2P-only mode the owner Hub arbitrates, with an Agent owner's Hub ordering rekeys caused by that Agent. Losing proposals resync before retrying. The previous key is decrypt-only for a five-minute in-flight grace period. Per-member encryption is an optional negotiated fallback for rooms of at most five members. Future MLS support requires explicit version/capability negotiation.

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
  { type: "transport_receipt", messageId, recipientHubId, status: "persisted", timestamp, signature }
  { type: "room_cas", roomId, expectedRevision, expectedKeyEpoch, newRevision, newKeyEpoch }
  { type: "contact_block", blockedHubIds, affectedRoomIds, timestamp, signature }
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
  { type: "room_cas_result", roomId, accepted, revision, keyEpoch }
  { type: "contact_blocked", blockedHubIds, affectedRoomIds }
  { type: "pong" }
```

所有业务消息都通过 `message + HubEnvelope` 传输。`transport_receipt` 是唯一可携带明文消息 ID 和持久化状态的投递控制帧；它不得包含业务 ack、正文或授权结果。Relay 不解析 `HubPayload` 或 `DirectoryManifest`。Room 帧中的 Hub membership 是投递路由数据，不是 User/Agent 授权证明。

Relay 必须为每个 Room 原子持久化 `(revision, keyEpoch)`。`room_cas` 仅在当前值同时等于 `expectedRevision/expectedKeyEpoch` 且新值分别恰好加 `1` 时返回 `accepted: true`；否则返回当前计数器。Relay 只仲裁“谁先”，不得接收或解释 rekey event、Room key 或 `keyCommitment`，因此不越过 §5.1 的职责边界。

`contact_block` 是经认证 Hub 发给 Relay 的明文路由控制通知，签名输入使用 RFC 8785 JCS。Relay 验证连接身份、签名和发送方对 `affectedRoomIds` 的现有路由 membership 后，必须立即停止这些 Room 中向 `blockedHubIds` 投递以及接受其发来的新流量；该帧不得包含联系人资料、正文或 Room key。`contact_blocked` 仅确认路由规则已安装。

All application traffic uses the encrypted envelope frame. The plaintext `transport_receipt` is a delivery-control exception limited to message ID and persistence status. The Relay atomically persists one `(revision, keyEpoch)` counter per room and accepts `room_cas` only when both expected values match and both new values increment by exactly one. It arbitrates ordering only and never receives or interprets rekey contents, keys, or commitments. A JCS-signed `contact_block` is a routing-only notice: after authenticating the sender and its room routing membership, the Relay immediately stops new traffic to and from the listed blocked Hubs in the affected rooms. Relay room membership remains routing state, never proof of User or Agent authorization.

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
  chorus-relay:
    image: chorus/relay:latest
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
  signature: string; // User signature over RFC 8785 JCS of this object without signature
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

1. 发起方输入对方完整 Hub ID，生成至少 128 bit 的随机 `nonce` 和一次性配对码；双方交换完整 Hub ID，排序时按其 UTF-8 byte lexicographic order。
2. 配对码必须作为 SPAKE2 的 password 输入，不得直接当作认证 token。SPAKE2 transcript 必须绑定排序后的两个完整 Hub ID、`nonce` 和双方密钥交换消息；双方以 PAKE 导出的确认密钥验证完整 transcript，任一 key confirmation 失败即终止配对。
3. 双方计算 6 位数字 SAS：`digest = SHA-256(JCS({ hubIds: sort([hubIdA, hubIdB]), nonce }))`，`SAS = zeroPad6(OS2IP(digest) mod 1_000_000)`。这就是 `SHA-256(bothHubIds sorted + nonce)` 的 6 位十进制表示；必须保留前导零。
4. 双方通过可信带外渠道逐位核对 SAS，并核验 User key 以及 32 hex 字符（128 bit）的 Hub 指纹、challenge 和有效期。SAS 不一致、SPAKE2 key confirmation 失败或指纹不匹配均必须拒绝，且不得保存部分信任状态。
5. 全部验证通过后双方保存 Contact 和信任记录；公钥变化必须重新配对。结果只显示头像、名称、32 字符 Hub 指纹和 presence；远端 Agent 数必须仍为 0。

The initiator supplies the peer's full Hub ID and creates a random nonce of at least 128 bits plus a one-time pairing code. The code is the SPAKE2 password, and the PAKE transcript binds both sorted full Hub IDs, the nonce, and both key-exchange messages; both sides MUST complete key confirmation. They then compute `zeroPad6(OS2IP(SHA-256(JCS({ hubIds: sort([hubIdA, hubIdB]), nonce }))) mod 1_000_000)` and compare the six-digit SAS through a trusted out-of-band channel, including leading zeroes, while checking the User key and full 32-hex-character Hub fingerprint. Any mismatch fails closed. Successful pairing creates only a contact; it does not discover, register, or authorize any Agent.

### 7.3 联系人授予与不授予的能力 / What a contact grants—and does not grant

`trusted` 联系人可以互发人类消息、创建/打开 direct Room、发送 Room 邀请，并接收所有者主动发布的 `public` Agent Card。它不授予 Room membership、Agent discovery beyond explicit cards、Agent admission 或 A2A 调用权。

A trusted contact may exchange human messages and room invitations and may receive owner-published public cards. It grants no implicit room membership, agent admission, or A2A invocation right.

解除或 block 联系人必须撤销后续投递和相关 Agent 能力，但不得删除历史。所有 contact、Room 和 Agent 撤销事件都必须可审计。

Removing or blocking a contact revokes future delivery and related capabilities without deleting history. Contact, room, and agent revocations are auditable separately.

### 7.4 Block 后的共享 Room / Shared rooms after blocking

1. 发起 block 的 Hub 必须把对方所有已验证 Hub ID 加入本地 `TrustStore.blockedHubIds`，并广播签名的 `ContactBlockedEvent`。
2. 每个受影响的共享 Room 将该 User 的成员状态标记为 `blocked`，并使其 Agent 显示 `unavailable`。
3. Relay 路由 membership 必须停止向被 block 的 Hub 投递这些 Room 的新消息；该 Hub 发来的新 Room 消息、目录事件和调用也必须被拒绝。
4. 历史 Room 消息及身份快照保持可读，但被 block 的成员不得新增消息、Agent 或调用。
5. block 本身必须立即触发每个受影响 Room 的 rekey，并从新 key 的成对分发列表中排除被 block User 的所有 Hub；旧 key 立即不得用于加密新消息。Room 管理员随后正式移除该成员及其所有 Agent只是额外的状态清理，会产生明确授权事件并递增 `revision`，不得作为停止密钥访问的前置条件。

Blocking adds every verified Hub of the contact to `TrustStore.blockedHubIds`. In shared rooms the member becomes `blocked`, their agents become `unavailable`, and no new room traffic is delivered to or accepted from those Hubs. The block itself immediately rekeys every affected room and excludes every blocked Hub from new-key distribution. History remains readable. A later administrator removal is additional state cleanup that emits authorization events and increments the room revision; it is not a prerequisite for revoking key access.

---

## 8. Room 设计 / Room Design

### 8.1 模型 / Model

- `kind=direct` 是两个 User 的 Room；`kind=group` 是命名多人 Room。
- 新跨用户会话统一使用 `type=room` 并关联 `roomId`。旧 `cross_hub` 只作迁移期读取兼容，不得用于新建。
- 人类成员与 Agent 成员是两张独立列表。Relay 维护 Hub 投递 membership；Local Hub 维护 User role、Agent membership 和本地会话映射。
- 每条 Room Agent 记录包含 `agentId`、`ownerUserId`、`ownerHubId/homeHubId`、可见性和身份快照。
- 每个 Room 必须保存单调递增的 `revision` 和 `keyEpoch`。创建时二者均为 `1`；成员增减、Agent 增减、rekey、角色变更和 block 状态变更各自产生一个签名状态事件并使 `revision + 1`。rekey 同时使 `keyEpoch + 1`；非 rekey 事件不得改变 epoch。

```typescript
interface RoomState {
  roomId: string;
  kind: "direct" | "group";
  revision: number;
  keyEpoch: number;
  managementState: "managed" | "unmanaged";
  members: RoomMember[];
  agents: RoomAgent[];
}
```

A direct message is a two-person room; named rooms are groups. New cross-user conversations use `type=room`. Human and agent memberships are separate, and every room agent has an owner and one execution Hub. Every signed state transition increments the monotonic `revision`; rekey transitions also increment the monotonic `keyEpoch`.

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
| 退出 Room / Leave room | 仅当仍有其他管理员 / Only if another admin remains | 是 / Yes |

创建者默认是管理员，角色绑定 User。只有所有者能发出有效 `room_agent_upsert`。管理员移除他人 Agent 时，必须通知该 User 的所有绑定 Hub，审计 `roomId`、`agentId`、`ownerUserId`、`actorUserId`、时间和原因，并触发 rekey。

The creator is an administrator by default. Only an owner can admit their agent. An administrator may remove another user's agent only with owner notification across bound Hubs, a complete audit event, immediate authorization revocation, and rekeying.

最后一个管理员不得离开或退出 Room；Local Hub 和 Relay 都必须返回 `409 LAST_ROOM_ADMIN`，UI 必须禁用退出按钮并提示“请先委派新管理员 / Delegate a new administrator first”。如果该管理员 User 的所有有效 Hub 离线直至离线 TTL 过期，Room 进入 `unmanaged`（无人管理）状态。任一非 blocked 人类成员均可发起接管申请；只有当前非 blocked 人类成员中严格过半数（`yes > eligibleMembers / 2`）提交签名同意后，申请人才成为管理员，Room 回到 `managed`，角色事件使 `revision + 1`。接管期间不得执行邀请、移除成员或委派等管理员操作。

The last administrator cannot leave. Both the Local Hub and Relay return `409 LAST_ROOM_ADMIN`, and the UI disables Leave with “Delegate a new administrator first.” If every valid Hub of that administrator remains offline beyond the offline TTL, the room becomes `unmanaged`. Any non-blocked human member may request takeover; signed approval from a strict majority of all current non-blocked human members is required. The resulting role event increments `revision` and restores `managed`; administrative mutations are forbidden while takeover is pending.

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

Agent 入房请求必须携带所有者签名证明。签名输入是移除 `roomJoinSignature` 后整个 `OwnerProof` 的 RFC 8785 JCS UTF-8 bytes；不得使用显示名：

Every agent-admission request carries an owner proof. The signature covers the RFC 8785 JCS UTF-8 bytes of the complete `OwnerProof` after removing `roomJoinSignature`; display names are never signed as identifiers:

```typescript
interface OwnerProof {
  agentId: string;
  ownerId: string;
  roomId: string;
  keyEpoch: number;
  roomJoinSignature: string;
}
```

接收方必须以已验证 `UserHubBinding` 中 `ownerId` 的 User 公钥验证 `roomJoinSignature`，并确认 proof 的 `agentId`、请求 `roomId` 和当前 `keyEpoch` 完全匹配。验证失败必须返回 `403 INVALID_OWNER_PROOF`；只有验证成功后才可接受 Agent 入房、递增 revision 并发起 rekey。

Receivers verify `roomJoinSignature` with the `ownerId` User public key from a valid `UserHubBinding`, and require exact agreement with the requested agent, room, and current epoch. Failure returns `403 INVALID_OWNER_PROOF`; admission, revision advancement, and rekey occur only after successful verification.

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
- 远程调用继续执行 `mention/call/off`；可信远程默认 `confirm`。

Room fan-out distributes history, while application dispatch remains narrow. Only the authenticated target home Hub invokes a mentioned agent. Display-name broadcast and implicit multi-agent dispatch are forbidden.

### 8.6 多设备同步 / Multi-device synchronization

- `room_agent_upsert`、`room_agent_remove`、人类 membership 和 role 事件同步到同一 User 的所有有效绑定 Hub。
- 其他 Hub 只展示状态；只有 Agent 的 `ownerHubId` 实际执行。
- owner Hub 离线时，UI 立即显示 `Agent unavailable (owner offline)`；Relay 可在 TTL 内保留加密 mention，owner Hub 上线并重新验证后处理。
- 设备撤销后不再接收新 Room key 或状态；剩余成员必须 rekey。
- 每个 Hub 持久化最后应用的 `roomRevision`。在线增量事件只能按连续 revision 应用；发现缺口、未知 `keyEpoch` 或离线 TTL 过期后必须执行 resync。

Signed room state converges across all Hubs bound to a User, but execution never migrates implicitly. An offline owner Hub may later process queued ciphertext within TTL after re-validation.

离线超过 TTL 的恢复流程如下：

1. Hub 重新上线后，为每个 Room 发送加密 `resync_request { roomId, lastKnownRevision }`。
2. 其他已验证且未 blocked 的 Hub 回复加密 `resync_response { roomId, fromRevision, toRevision, events[], roomState }`；`events` 提供可用的连续增量，`roomState` 是 `toRevision` 的签名状态快照和当前 `keyEpoch`。
3. Relay 已删除的超 TTL 离线消息不得重投，也不得伪造成增量事件。
4. 恢复方验证事件签名、revision 连续性和快照；有完整增量时依次应用，否则以可验证的最高 revision Room state 补齐缺失状态。新 Room key 仍只通过成对加密分发给当前未 blocked 成员。

After returning beyond the TTL, a Hub sends `resync_request` with its last known revision. Verified peers answer with signed incremental events and a room-state snapshot in `resync_response`. Expired Relay messages are never redelivered. The recovering Hub validates signatures and revision continuity, applies a complete delta when available, or installs the highest verifiable state snapshot; current keys are distributed only through pairwise encryption to eligible members.

### 8.7 授权事件 schema / Authorization event schemas

授权事件不得塞入任意 `metadata` 后由实现自行解释。以下业务对象字段是规范性的，并放入带 `eventId`、`revision`、`actorSignature` 的签名事件 envelope；`actorSignature` 对移除自身后的完整 event envelope 的 RFC 8785 JCS UTF-8 bytes 签名。接收方必须验证 actor 权限、时间戳、目标 Room 当前 revision 及签名。

Authorization events MUST NOT be encoded as implementation-defined `metadata`. The following normative event bodies are carried in a signed event envelope containing `eventId`, `revision`, and `actorSignature`; that signature covers the RFC 8785 JCS UTF-8 bytes of the complete event envelope after removing `actorSignature`. Receivers verify actor authority, timestamp, expected room revision, and signature.

```typescript
interface RoomAgentRemovedEvent {
  roomId: string;
  agentId: string;
  removedBy: string;
  ownerNotified: boolean;
  timestamp: number;
}

interface RoomMemberRemovedEvent {
  roomId: string;
  userId: string;
  removedBy: string;
  timestamp: number;
}

interface RoomRoleChangedEvent {
  roomId: string;
  userId: string;
  oldRole: "admin" | "member";
  newRole: "admin" | "member";
  changedBy: string;
  timestamp: number;
}

interface ContactBlockedEvent {
  blockedHubId: string;
  blockedBy: string;
  timestamp: number;
  affectedRooms: string[];
}
```

`ownerNotified` 只有在向 owner 的所有有效 Hub 成功排队通知后才可为 `true`；该值不替代移除权限检查。`ContactBlockedEvent.affectedRooms` 必须列出 block 时所有共享 Room，供各实现一致地停止路由并更新成员/Agent 状态。

`ownerNotified` may be true only after notification has been queued for every valid owner Hub and never substitutes for authorization. `affectedRooms` enumerates every shared room at block time so implementations consistently stop routing and update member and agent state.

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
queued ── 3 deliveries without receipt → failed
```

| 状态 / State | 定义 / Definition |
|---|---|
| `queued` | Relay 已持久化密文；目标尚未确认 / Relay persisted ciphertext; target has not acknowledged |
| `delivered` | 目标 Hub 已持久化并发送有效 `transport_receipt` / Target Hub persisted it and sent a valid transport receipt |
| `accepted` | 目标通过授权并接受处理 / Target authorization accepted processing |
| `denied` | trust、membership、visibility 或策略拒绝 / Trust, membership, visibility, or policy rejected it |
| `done` | Agent/人类处理成功 / Processing completed successfully |
| `error` | 已接受但执行失败 / Accepted, but execution failed |
| `expired` | 默认 7 天 TTL 到期仍未完成投递 / Default seven-day TTL elapsed before delivery |
| `failed` | 连续 3 次投递均未收到有效 transport receipt / Three delivery attempts completed without a valid transport receipt |

`queued` 不表示 Agent 已执行；`delivered` 也不表示调用获准。客户端不得让过期消息长期停留在 queued。

Queued is not executed, and delivered is not authorized. Expired and failed messages MUST leave the queued state. An encrypted `delivery_ack` may refine the application state after delivery but never changes Relay storage directly.

### 9.3 离线存储 / Offline store

- 目标 Hub 离线时，Relay 将完整加密 envelope 写入 SQLite `offline_messages`。
- 每条离线记录包含 `deliveryAttempts`（初始为 `0`）、最后尝试时间和状态。Relay 每次实际发送该记录前原子执行 `deliveryAttempts + 1`；未收到 receipt 时按退避策略重投。
- Hub 上线后收到批量 `offline_messages`；本地持久化成功才发送明文签名 `transport_receipt`。Relay 验证 receipt 后删除；加密 `delivery_ack` 仅发送给业务对端。
- 三次投递仍无有效 receipt 时，Relay 将记录标记为 `failed`、停止自动重投，并在发送方可达时通知投递失败。管理员显式重试必须创建新的 envelope/message ID。
- 默认 TTL 为 7 天，可通过 `RELAY_OFFLINE_TTL_DAYS` 配置。过期时若发送方可达则通知 `expired`。
- receipt 可能在持久化后丢失，因此 Hub 必须用 `HubEnvelope.id` 和解密后的 `HubPayload.messageId` 做持久化去重与幂等处理；收到重复投递时不得重复展示、授权或执行，但必须重发 receipt。
- 离线记录只含密文、`deliveryAttempts` 和路由元数据。幂等、顺序和 revoke 优先级遵循 §3.5。
- 单实例使用 WAL、同步刷盘和周期 checkpoint；多实例需要具备等价持久性语义。

The Relay stores ciphertext durably while a target is offline and deletes it only after the target persists and returns a verified plaintext transport receipt. Each actual delivery increments `deliveryAttempts`; after three unacknowledged deliveries the record becomes `failed`. Receivers deduplicate both envelope and payload message IDs and re-emit receipts for duplicates. TTL, ordering, idempotency, and revoke precedence are protocol semantics, not implementation details.

### 9.4 TTL 过期后的恢复 / Recovery after TTL expiry

TTL 清理只删除无法投递的 ciphertext，不代表 Room 状态已经同步。Hub 检测到离线跨度超过 TTL 后必须把 Room 标记为 `resyncing`，执行 §8.6 的 `resync_request` / `resync_response` 流程；完成前不得发送依赖未知 revision/epoch 的新 Room 消息。同步成功后 UI 应区分“状态已恢复 / State restored”和“过期消息未恢复 / Expired messages not recovered”。

TTL cleanup removes undeliverable ciphertext, not room state. A Hub returning after the TTL marks each room `resyncing`, completes the §8.6 request/response flow, and only then sends messages that depend on the recovered revision and epoch. The UI distinguishes restored state from expired messages, which are never recovered or redelivered.

---

## 10. 安全与隐私 / Security and Privacy

### 10.1 安全控制 / Security controls

| 层面 / Layer | 控制 / Control |
|---|---|
| 传输 / Transport | 公网 WSS/TLS；P2P 互认证 / WSS/TLS publicly; mutually authenticated P2P |
| 身份 / Identity | Ed25519 Hub/User 签名、双签名 binding、指纹核验 / Ed25519 signatures, dual-signed binding, fingerprint verification |
| 消息 / Message | direct 使用 `crypto_box`；Room 使用带 `keyEpoch` 的 AES-256-GCM group key / Pairwise `crypto_box`; epoch-indexed AES-256-GCM room key |
| 重放 / Replay | UUID、per-sender nonce counter、5 分钟握手窗口、LRU/数据库幂等 / IDs, per-sender nonce counters, five-minute handshake window, durable idempotency |
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
| A2A | 自有 `auto`，可信远程 `confirm`，陌生 `deny` / Own auto, trusted remote confirm, unknown deny | Agent 级、会话级 `mention/call/off` |
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
- 多 Hub 同 epoch nonce 不碰撞；并发 rekey 不产生 split-brain；旧 epoch 在 5 分钟内仅可解密在途消息。

Security acceptance requires zero pairing leakage and name-based misrouting, strict owner/admin enforcement, rapid revocation, key-change re-pairing, replay resistance, and a real two-device E2E matrix.

### 10.5 E2E 测试场景矩阵 / E2E test scenario matrix

除特别说明外，每行都必须在 Relay 和 P2P 路径各运行一次，并在 Hybrid fallback 后重复关键断言；所有接收端还要断言 `messageId` 幂等且审计日志不含明文正文或 key。

Unless stated otherwise, each row runs once over Relay and once over P2P, with critical assertions repeated after Hybrid fallback. Every receiver also asserts message-ID idempotency and that audit logs contain neither plaintext content nor keys.

| ID | 场景 / Scenario | 操作 / Actions | 必须断言 / Required assertions |
|---|---|---|---|
| E2E-01 | 完整协作链路 / Full collaboration flow | 配对 → 创建 Room → 邀请并接受 → owner proof 加 Agent → `@mention` → Agent 回复 / Pair → create room → invite/accept → add agent with owner proof → mention → reply | 配对不泄露 Agent；revision/epoch 单调；仅 home Hub 执行一次；回复对所有合法成员可见 / Pairing leaks no agents; revision/epoch are monotonic; only the home Hub executes once; eligible members see the reply |
| E2E-02 | 并发 rekey / Concurrent rekey | 两个成员基于同一 revision 同时添加自己的 Agent / Two members concurrently add their own agents from one base revision | CAS 只接受一个 rekey；失败方 resync 后重试；无相同 epoch 不同 key；两个 Agent 最终各有有效 owner proof / One CAS wins; loser resyncs and retries; no same-epoch split key; both agents end with valid owner proofs |
| E2E-03 | 管理员委派与退出 / Admin delegation and leave | 验证最后管理员退出被禁用；委派新管理员后原管理员退出 / Verify last-admin leave is disabled; delegate, then original admin leaves | 先返回 `409 LAST_ROOM_ADMIN` 和提示；委派事件 revision+1；退出、rekey 与角色在所有 Hub 收敛 / Initial 409 and UI hint; delegation increments revision; leave, rekey, and role converge |
| E2E-04 | TTL 过期与 resync / TTL expiry and resync | Hub 离线超过 TTL，期间修改成员、角色和 Agent，再上线 / Keep a Hub offline beyond TTL while membership, role, and agent state change, then reconnect | 过期 ciphertext 不重投；发送 lastKnownRevision；验证增量/快照后补齐最新 Room state 与 epoch / Expired ciphertext is not redelivered; request carries lastKnownRevision; verified delta/snapshot restores latest state and epoch |
| E2E-05 | block 后共享 Room / Shared room after block | block 联系人，观察共享 Room，再由管理员正式移除 / Block a contact in a shared room, then have an admin remove them | TrustStore、`blocked`、`unavailable` 和停止双向新投递一致；历史保留；正式移除 revision+1 并 rekey / TrustStore, blocked/unavailable state, and routing stop agree; history remains; removal increments revision and rekeys |
| E2E-06 | nonce 碰撞检测 / Nonce collision detection | 两个 Hub 在同 epoch 各发送多条消息，并注入重复 `(senderHubNonceId,counter)` / Two Hubs send within one epoch; inject a duplicate sender/counter tuple | 正常 nonce 为 8+4 bytes 且跨 Hub 唯一；重复 nonce 被拒绝并审计；counter 不回绕，rekey 后才归零 / Normal nonces are 8+4 bytes and unique across Hubs; duplicate is rejected/audited; no wrap; reset only after rekey |
| E2E-07 | keyEpoch 在途解密 / In-flight epoch decryption | 延迟 epoch N 消息，完成 rekey 到 N+1 后分别在 5 分钟内外送达 / Delay an epoch-N message and deliver it inside and outside five minutes after rekey | 5 分钟内用 N key 解密但不再用其加密；超时后拒绝；N+1 消息只用 N+1 key；epoch 不匹配失败 / N decrypts only within grace and never encrypts; later delivery fails; N+1 uses only its key; epoch mismatch fails |
| E2E-08 | receipt 丢失重投 / Lost receipt redelivery | 让接收方持久化后丢弃前两次 transport receipt / Drop the first two receipts after durable persistence | Relay attempts 为 1→2→3；业务仅处理一次；重复投递重发 receipt；第三次 receipt 后删除队列 / Attempts advance 1→2→3; application processes once; duplicate re-emits receipt; third receipt deletes queue |
| E2E-09 | 三次无 receipt / Three missing receipts | 连续丢弃 3 次 transport receipt / Drop three consecutive receipts | 记录标记 `failed`、停止自动重投并通知发送方；加密 E2E ack 不能删除队列 / Record becomes failed, redelivery stops, sender is notified; encrypted E2E ack cannot delete queue |

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
  chorus/relay:latest
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
4. 远程调用遵循 `mention/call/off`，可信远程默认请求确认。
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

- [Google A2A Agent Cards](https://google.github.io/A2A/latest/specification/)：借鉴由所有者选择发布、最小且可撤销的能力卡；Chorus 不在配对后抓取全量目录。
- [Discord OAuth2/Bots](https://discord.com/developers/docs/topics/oauth2) 与 [Slack OAuth](https://api.slack.com/authentication/oauth-v2)：借鉴 room/workspace-first、再显式安装 bot/app 的授权顺序。
- [Agent Client Protocol (ACP)](https://agentclientprotocol.com/)：借鉴客户端与 Agent 的明确控制边界；Chorus 额外要求跨用户 trust、Room scope 与 owner authorization。
- Ed25519/X25519、XSalsa20-Poly1305 与 AES-256-GCM 的具体实现必须使用经过审计的 libsodium/平台密码库，不得自行实现密码原语。

The interaction model combines opt-in A2A-style capability cards, room-first bot admission, and ACP-style ownership boundaries. Chorus's local-first identity, E2E envelopes, scoped room agents, and Relay metadata boundary remain architecture-specific.

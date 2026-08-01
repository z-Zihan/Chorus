# AgentLink 跨用户通信架构设计

> 版本: v1.0 | 日期: 2026-08-01

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
                     · Hub 发现

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
│              AgentLink Desktop (Tauri)               │
│  ┌───────────────────────────────────────────────┐  │
│  │              Frontend (React)                  │  │
│  │  · 连接状态指示器 (P2P/Relay/离线)            │  │
│  │  · 跨 Hub 会话列表                            │  │
│  │  · 群聊 UI                                    │  │
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

## 2. Hub 身份与认证

### 密钥对

- 算法：Ed25519 (libsodium)
- 首次启动时生成密钥对，存储在 `data/hub-keypair.json`
- Hub ID = 公钥的 hex 编码前 32 字符（如 `a1b2c3...`）
- 显示名：用户自定义，不唯一

### Relay 注册

```
POST /api/hubs/register
{
  "hubId": "a1b2c3...",
  "publicKey": "full-ed25519-public-key-hex",
  "displayName": "子涵的 Hub",
  "signature": "<signed-challenge>"
}

Response:
{
  "token": "relay-jwt-token",
  "relayHubId": "relay-assigned-uuid"
}
```

### Hub 间互认证

1. Hub A 通过 Relay 获取 Hub B 的公钥
2. Hub A 生成临时 nonce，用 Hub B 公钥加密
3. Hub B 解密 nonce，签名返回
4. Hub A 验证签名 → 建立加密通道

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
  messageType: "chat" | "a2a_call" | "a2a_response" | "agent_status" | "typing";
  conversationId: string;
  messageId: string;
  content: string;
  agentId?: string;      // 来源 Agent ID
  metadata?: Record<string, unknown>;
}
```

### 加密方案

- **算法**：libsodium `crypto_box` (X25519 + XSalsa20-Poly1305)
- **流程**：
  1. Hub A 用 Hub B 的 X25519 公钥 + 自己的私钥生成共享密钥
  2. 用共享密钥加密 payload → ciphertext
  3. 用自己的 Ed25519 私钥签名 envelope → signature
- **Relay 无法解密**：只有 ciphertext 和元数据经过 Relay
- **离线消息**：Relay 存储 ciphertext，等接收方上线后投递

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
| `/api/rooms/:id/join` | POST | 加入房间 |
| `/api/rooms/:id/leave` | POST | 离开房间 |
| `/api/rooms/:id/invite` | POST | 邀请 Hub 加入 |
| `/api/health` | GET | 健康检查 |

### 离线消息

- Relay 维护 SQLite `offline_messages` 表
- 消息到达时接收方不在线 → 存入 offline store
- 接收方上线 → 批量推送，TTL 7 天自动清理
- 加密存储：Relay 只存 ciphertext，无法解密

### 部署

```yaml
# docker-compose.yml
services:
  agentlink-relay:
    image: agentlink/relay:latest
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
  agentlink/relay:latest
```

### 扩展性

- v1：单实例，支持 ~1000 Hub 同时在线
- v2：Redis pub/sub 多实例，水平扩展
- v3：Kubernetes 部署 + 负载均衡

## 5. P2P 发现

### mDNS 广播

```typescript
// 使用 bonjour-service 包
import bonjour from "bonjour-service";

const service = bonjour.publish({
  name: `agentlink-${hubId.slice(0, 8)}`,
  type: "agentlink",
  port: 3212,           // P2P 监听端口 (独立于 3210)
  txt: {
    hubId,
    displayName,
    version: "1.0",
  },
});

// 发现其他 Hub
bonjour.find({ type: "agentlink" }, (service) => {
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
    · 每个成员用自己的密钥解密
    · 发送方对每个接收方分别加密 payload (或用群组密钥)
    · v1: 逐个加密 (简单，群成员少时可行)
    · v2: MLS 群组密钥 (高效，支持大群)
```

### 创建群聊

1. Hub A 调用 `POST /api/rooms` 创建房间
2. 获取 `roomId`
3. 通过 `POST /api/rooms/:id/invite` 邀请 Hub B、Hub C
4. Relay 通知被邀请的 Hub
5. 各 Hub 本地创建 `type: "group"` 会话
6. 本地 `conversation_agents` 映射记录参与的 Agent

### 消息路由

- **发送方** → Relay（`to: "room:xxx"`）
- **Relay** → 查询房间成员 → fan-out 给所有在线成员
- **离线成员** → 存入 offline store，上线后推送
- **P2P 群聊** → 发送方逐个 unicast 给局域网内的成员

## 8. 安全

| 层面 | 措施 |
|------|------|
| 传输层 | WSS (TLS) 用于 Relay 连接 |
| 消息层 | End-to-End 加密 (libsodium crypto_box) |
| 身份层 | Ed25519 签名验证 |
| 防重放 | nonce + 5 分钟时间窗口 |
| 防篡改 | envelope signature 覆盖所有字段 |
| Relay 隔离 | Relay 只看到 ciphertext + 元数据 |
| 速率限制 | Relay 限制每 Hub 100 msg/s |
| 注册控制 | 可选 invite code 防止滥用 |

## 9. 任务拆解

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
// agentlink.config.ts 新增字段
export default {
  // ... 现有配置
  hub: {
    enabled: true,
    displayName: "子涵的 Hub",
    // Relay 配置
    relay: {
      url: "wss://relay.agentlink.app/ws",  // 官方 Relay
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

### 13.2 群聊加密：群成员公钥分发（已修订 §7）

**问题**：发送方需要所有群成员的公钥才能逐个加密。

**方案**：
- 创建/加入房间时，Relay 返回所有成员的 Hub ID + 公钥
- 发送方缓存群成员公钥列表，定期刷新
- v1 逐个加密（群成员 ≤ 50 时可行）
- v2 引入 MLS 群组密钥（支持大群）

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
| §5 mDNS TXT | 只带 Hub ID + displayName，不带公钥（公钥通过 Relay 获取） |
| §4 REST API | 新增 `DELETE /api/hubs/:id` — Hub 注销，清除公钥和离线消息 |
| §8 速率限制 | 分级：direct 50/s, group 20/s, broadcast 5/s |
| §4 离线 TTL | 做成环境变量 `RELAY_OFFLINE_TTL_DAYS`，默认 7 天 |
| §5 P2P 端口 | 支持配置端口范围，被封时回退到 Relay |

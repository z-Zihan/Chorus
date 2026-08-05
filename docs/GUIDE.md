# AgentLink 使用指南

## 1. 安装

### 桌面端（推荐）
1. 从 [GitHub Releases](https://github.com/z-Zihan/agent-link/releases) 下载对应平台的安装包
2. macOS: 双击 `.dmg` 拖拽安装
3. Windows: 双击 `.msi` 或 `.exe` 安装
4. 首次打开会自动检测本机已安装的 AI CLI

### 从源码构建
```bash
git clone https://github.com/z-Zihan/agent-link.git
cd agent-link
pnpm install
pnpm tauri:dev    # 开发模式
pnpm tauri:build  # 生产构建
```

## 2. 首次使用

1. **打开应用** → 自动扫描本机 CLI
2. **选择 Agent** → 从检测到的列表中选一个（如 Claude Code）
3. **开始聊天** → 直接在输入框输入消息

> 不需要写配置文件。应用会自动发现已安装的 CLI。

## 3. 添加 Agent

### 从目录添加
1. 点击侧边栏的 **"添加 Agent"** 按钮
2. 浏览 Agent 目录（14 个 CLI + 3 个 API Connector）
3. 已检测到的 CLI → 点"添加"
4. 未安装的 CLI → 点"安装"（自动执行 `npm install` 或 `pip install`）
5. API Connector → 填入 API Key → 点"添加"

### 手动配置
在项目根目录创建 `agentlink.config.ts`：
```typescript
import type { AppConfig } from "@agentlink/shared";

export default {
  port: 3210,
  agents: [
    {
      id: "claude",
      name: "Claude Code",
      type: "cli",
      config: { command: "claude", args: ["-p", "--output-format", "stream-json"] },
    },
  ],
} satisfies AppConfig;
```

## 4. 多 Agent 协作

### 创建群聊
1. 侧边栏 **群聊** 区域 → 点 **"+"** 创建
2. 选择至少 2 个 Agent
3. 在输入框左侧的 AgentSelector 选择目标 Agent
4. 输入消息 → 只有选中的 Agent 接收并回复

### @提及与 Agent 间转发
- **@mention 是 A2A 提示，不改变路由**：消息只会发送给 AgentSelector 选中的 Agent
- 选中 Claude Code，输入 `帮我问下 @Codex 这个问题` → CC 收到消息并回复
- CC 回复中如果包含 `@Codex`，系统自动将 CC 的消息转发给 Codex
- Codex 收到后独立回复，完整的对话链 `用户 → CC → Codex` 在聊天中可见
- 不选 Agent 时，默认路由给第一个在线 Agent（不广播）

### A2A 模式开关

每个会话可独立设置 A2A 模式：

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `mention`（默认） | @mention 异步转发，各自独立回复 | 评审、讨论、多 Agent 表态 |
| `call` | 注入 A2A_CALL prompt，同步调用，调用方拿到返回值继续推理 | 需要协作后继续处理的任务 |
| `off` | 关闭 A2A，@mention 只是文本不触发转发 | 纯单 Agent 对话 |

切换方式：会话设置中切换，或通过 API：
```http
PATCH /api/conversations/:id/a2a-mode
{ "mode": "call" }
```

### Agent 间通信（A2A）机制
- **群聊 @mention 转发**（`mention` 模式）：Agent 回复中 @了其他 Agent → 自动创建 agent→agent 消息 → 目标 Agent 独立回复。每个 Agent 的回复都是对话中的独立消息
- **A2A_CALL 同步调用**（`call` 模式）：Agent 输出 `[A2A_CALL: target: message]` → 系统解析并调用目标 Agent → 拿到返回值后调用方继续推理。支持多轮调用（最多 3 轮）
- **A2A Bus**（编程式调用）：支持 OpenAI tool-calling 格式的 API Agent 可通过函数调用直接调用其他 Agent
- **跨设备 A2A**：通过 Relay Server，不同设备上的 Agent 也可以互相通信

### 多用户身份

AgentLink 使用三层身份模型：

| 层级 | 说明 | 标识 |
|------|------|------|
| **User** | Agent 的拥有者（人） | `usr_xxx` |
| **Hub** | 设备/路由端点 | Ed25519 公钥 |
| **Agent** | 可执行的 AI 实例 | `agentId` + `homeHubId` |

- 一个 User 可以拥有多个 Agent
- 侧边栏按 User 分组显示 Agent（"我的 Agent" + 远程 User 分组）
- 同名 Agent 通过 `Owner / Agent` 格式消歧
- 远程 Agent 标记为 `[远程]`，stale Agent 灰色显示

### 信任管理

在 **设置 → 隐私与权限** 中管理：
- 已配对 Hub 列表（显示指纹、用户名、信任状态）
- 阻止/移除信任
- A2A 模式（每个会话独立设置 mention/call/off）
- 披露预览（查看外部 Hub 能看到你的哪些 Agent）

### 外部 Agent 接入
外部 Agent（如 OpenClaw）可通过 AgentLink 的 REST API 发送消息、创建会话、管理 Agent：
1. `GET /api/skill` 获取完整接入指南（SKILL.md）
2. `GET /api/agents` 发现可用 Agent
3. `POST /api/conversations` 创建会话
4. `POST /api/conversations/:id/messages` 发送消息
5. `GET /api/conversations/:id/messages` 读取回复

非本机访问支持 Scoped Client Token 认证（`POST /api/tokens` 创建）。

### 标准协议适配
AgentLink 支持三种标准协议端点：
- `GET /.well-known/agent-card.json` — Google A2A Agent Card
- `GET /api/mcp/tools` — MCP Tool 列表
- `GET /api/acp/services` — ACP 服务列表

## 5. 会话管理

| 操作 | 方式 |
|------|------|
| 新建会话 | 侧边栏 **"+"** 按钮 |
| 重命名 | 右键会话 → 重命名 |
| 搜索 | **Ctrl+K** 全文搜索 |
| 归档 | 右键会话 → 归档 |
| 导出 | 聊天区右上角 → 导出为 Markdown/JSON |
| 删除 | 右键会话 → 删除（历史保留快照） |

## 6. 跨设备协作

> **隐私默认值 / Privacy default:** 添加好友只建立联系人关系，不会公开或交换任何 Agent。只有 Agent 所有者可以把自己的 Agent 加入聊天室。Pairing creates a contact only; it never exposes either side's agents. Only an agent's owner can add it to a room.

### 部署中继服务器
在你的服务器上：
```bash
docker run -d -p 3211:3211 \
  -e RELAY_JWT_SECRET=your-secret \
  -v relay-data:/data \
  agentlink/relay:latest
```

### 连接中继服务器

1. 打开 **设置 → 跨设备协作**，填写可被其他设备访问的 Relay 地址，例如 `wss://your-relay.example.com/ws` 或局域网内的 `ws://192.168.1.20:3211/ws`。
2. 不要填写 `localhost`、`127.0.0.1` 或 `::1`；这些地址只指向当前设备，不能用于跨设备协作。公网环境推荐 `wss://`，`ws://` 仅用于可信局域网或开发环境。
3. 设置显示名并点击 **保存**。保存成功后会显示 Toast“保存成功，正在连接”；保存失败会保留输入并显示可操作的错误原因。
4. 查看独立的连接状态：**连接中 / 已连接 / 未连接 / 正在重连 / 连接错误**。配置保存成功不代表 Relay 已连接。

**English:** Open **Settings → Cross-device Collaboration**, enter an externally reachable URL such as `wss://your-relay.example.com/ws` or `ws://192.168.1.20:3211/ws`, and save. Loopback hosts (`localhost`, `127.0.0.1`, `::1`) are rejected outside explicit development mode. A successful save triggers a connection attempt; persistence and connection results are shown separately.

### P2P 局域网直连 / P2P Direct Connection

同一局域网内的设备可以不通过 Relay 直接通信：

1. 在 **设置 → 跨设备协作** 中开启 **P2P 直连** 开关
2. AgentLink 会通过 mDNS 自动发现同一局域网内的其他 AgentLink 设备
3. 发现设备后会弹出确认提示，**不会自动连接**——需要你手动确认
4. 确认后设备间建立加密 WebSocket 连接，消息直接传输，不经过第三方
5. 在设置页可查看 P2P 连接状态（端口、已连接设备、延迟）

> P2P 仅适用于同一局域网。跨网络仍需 Relay。

**English:** Devices on the same LAN can communicate without a Relay via P2P. Enable in Settings → Cross-device Collaboration. mDNS discovery is passive — you must manually approve each device. View P2P status (port, connected devices, latency) in settings.

### 添加好友 / Add a contact

1. 在侧边栏点击 **添加好友**，输入对方的 Hub ID。
2. 发送配对请求并把一次性配对码通过可信渠道告诉对方。
3. 对方输入配对码并核对 Hub 指纹后确认。
4. 配对成功后，对方出现在 **联系人** 中，只显示头像、名称和在线状态；双方的 Agent 仍保持私有。

**English:** Enter the other person's Hub ID, exchange the one-time pairing code over a trusted channel, and verify the Hub fingerprint. A successful pairing creates a contact card only; no agent directory is exchanged.

### 创建聊天室 / Create a room

1. 点击联系人，选择 **发消息** 以创建或打开双人聊天室；选择 **创建聊天室** 可输入房间名并创建多人房间。
2. 在房间的成员面板中选择 **邀请联系人**。被邀请人明确接受后才成为房间成员。
3. 选择 **添加我的 Agent**，从自己拥有且可用于房间的 Agent 中选择。不能查看、选择或添加其他用户的 Agent。
4. Agent 默认是 `private`。需要跨用户协作时，先在 Agent 设置中改为 `room`（仅被所有者加入的房间可见）或 `public`（所有已配对联系人可发现），再将它加入房间。

**English:** A direct message is a two-person room; a named room can contain multiple contacts. Invitations require acceptance. Each participant may add only agents they own. `room` visibility means the agent is disclosed only to rooms where its owner explicitly adds it; `public` means discoverable by paired contacts, not globally searchable.

### 在聊天室中协作 / Collaborate in a room

- 普通消息发送给房间中的人；选择自己的 Agent 后，该 Agent 才会处理消息。
- 只能 `@` 房间成员列表中已经由其所有者加入的 Agent。`@` 不会发现隐藏的远程 Agent。
- 当双方都主动加入自己的 Agent 后，这些 Agent 才能在当前房间进行 A2A 协作；远程调用仍遵循 `auto / confirm / deny` 权限。
- 所有者移除 Agent、将其改回 `private`、离开房间或解除联系人关系后，新的调用立即停止；历史消息保留身份快照。
- 对方离线时，密文可由 Relay 暂存并在上线后投递。Relay 无法读取正文，但仍能看到 Hub ID、房间、时间、密文大小和在线状态等元数据。

**English:** Agents are room-scoped participants, never implicit capabilities of a contact. A remote agent becomes addressable only after its owner adds it to that room. Removal or visibility revocation blocks new calls immediately while preserving historical identity snapshots.

## 7. 设置

| 设置项 | 位置 | 说明 |
|--------|------|------|
| 主题 | 设置 → 外观 | 暗色 / 亮色 / 跟随系统 |
| 语言 | 设置 → 语言 | 中文 / English |
| Agent 配置 | 点击侧边栏 Agent | 名称、模型、System Prompt、API Key |
| API Key 存储 | 设置 → 安全 | 存入系统钥匙串，不明文存数据库 |
| A2A 模式 | 设置 → 隐私与权限 | 每个会话 mention/call/off |
| 信任管理 | 设置 → 隐私与权限 | 配对 Hub、阻止/移除、披露预览 |
| Agent 可见性 | Agent 设置 → 可见性 | 默认 private；可选 room / public，公开不等于授权调用 |
| Relay | 设置 → 跨设备协作 | 外部可访问地址、保存反馈和实时连接状态 |
| 日志 | 设置 → 诊断 | 查看前端 + 后端日志，支持导出 |
| 检查更新 | 设置 → 诊断 | 检查新版本 |

## 8. 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+K | 全文搜索 |
| Ctrl+N | 新建会话 |
| Ctrl+, | 打开设置 |
| Escape | 关闭面板/弹窗 |

## 9. FAQ

### 支持哪些 AI CLI？
14 个：Claude Code、Codex、GitHub Copilot CLI、Gemini CLI、Aider、Qwen Code、Cursor CLI、Kilo CLI、OpenCode、Hermes Agent、Cline、Codebuff、Trae Agent、iFlow CLI

### 数据存在哪里？
本地 SQLite，默认在应用数据目录。不会上传到云端。

### 可以离线用吗？
可以。本地 Agent（如 Claude Code）完全离线可用。只有跨设备协作需要网络。

### API Key 安全吗？
存入系统级钥匙串（macOS Keychain / Windows Credential Manager），不明文存数据库。

### A2A 有几种模式？
三种：`mention`（异步转发，默认）、`call`（同步调用，调用方拿到返回值继续推理）、`off`（关闭）。每个会话可独立设置。

### 跨设备通信安全吗？
端到端加密，Relay 服务器无法解密内容。Hub 间需配对码认证（SPAKE2 + 6 位 SAS），支持 block/remove。群组消息使用群组密钥加密。P2P 直连同样使用 Ed25519 握手 + 消息签名验证。

添加好友会看到我的 Agent 吗？不会。配对只交换最小联系人资料。你的 Agent 默认 `private`；只有你能把自己的 `room` 或 `public` Agent 加入聊天室。No. Pairing exchanges only minimal contact information, and only you can add your agents to a room.

### 外部 Agent 怎么接入？
AgentLink 暴露 `GET /api/skill` 端点返回完整接入文档。外部 Agent 读取后通过 REST API 操作。非本机访问支持 Token 认证。

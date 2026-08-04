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
- A2A 权限模式（每个会话独立设置 auto/confirm/deny）
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
| 批量删除 | 侧边栏选择模式 → 勾选 → 删除 |

## 6. 跨设备协作

### 部署中继服务器
在你的服务器上：
```bash
docker run -d -p 3211:3211 \
  -e RELAY_JWT_SECRET=your-secret \
  -v relay-data:/data \
  agentlink/relay:latest
```

### 连接中继服务器
1. 设置 → **跨设备协作** → 填入中继地址（如 `wss://relay.example.com/ws`）
2. 设置你的显示名
3. 点"连接"
4. 连接成功后，你的 Agent 可以和其他设备上的 Agent 通信

### 跨设备 Agent 通信
- **私聊**：直接 @对方的 Agent，消息加密转发
- **群聊**：创建跨设备群聊房间，邀请其他 Hub 加入
- **P2P 直连**：同一局域网自动走 P2P（零延迟），不同网络走中继
- **离线消息**：对方不在线时，消息加密存储在中继，上线后自动推送

> 所有消息端到端加密，中继服务器无法解密内容。

## 7. 设置

| 设置项 | 位置 | 说明 |
|--------|------|------|
| 主题 | 设置 → 外观 | 暗色 / 亮色 / 跟随系统 |
| 语言 | 设置 → 语言 | 中文 / English |
| Agent 配置 | 点击侧边栏 Agent | 名称、模型、System Prompt、API Key |
| API Key 存储 | 设置 → 安全 | 存入系统钥匙串，不明文存数据库 |
| A2A 权限 | 设置 → 隐私与权限 | 每个会话 auto/confirm/deny |
| 信任管理 | 设置 → 隐私与权限 | 配对 Hub、阻止/移除、披露预览 |
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
端到端加密，Relay 服务器无法解密内容。Hub 间需配对码认证，支持 block/remove。群组消息使用群组密钥加密。

### 外部 Agent 怎么接入？
AgentLink 暴露 `GET /api/skill` 端点返回完整接入文档。外部 Agent 读取后通过 REST API 操作。非本机访问支持 Token 认证。

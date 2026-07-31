# AgentLink

> 本地部署的、Agent 原生的即时通讯工具，支持人机对话（A2H）和 Agent 间通信（A2A）。

## 为什么需要 AgentLink？

| 痛点 | 现状 | AgentLink 方案 |
|------|------|---------------|
| 第三方 IM 限流 | 飞书 5条/秒，频繁通知被拒 | 本地部署，无频率限制 |
| Agent 之间无法直接通信 | 各 Agent 孤立，靠人转发 | 内置 A2A 消息总线 |
| Agent 接入分散 | 每个平台各自对接 | 统一 adapter 协议，即插即用 |
| 对话过程不透明 | Agent 调用链不可见 | A2A 对话线程可视化 |

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | React 19 + Tailwind CSS 4 + Zustand 5 | 深色主题，Linear/Vercel 风格 |
| 后端 | Node.js 22 + Fastify 5 + WebSocket | 高性能，内置 TS 支持 |
| 数据库 | SQLite (better-sqlite3) + Drizzle ORM | 零配置，类型安全 |
| 构建 | Vite 6 + pnpm workspace | Monorepo 前后端统一管理 |
| 语言 | TypeScript 5.5 | 全栈类型安全 |

## 快速开始

### 环境要求

- Node.js ≥ 22 LTS
- pnpm ≥ 9
- Rust ≥ 1.75（Tauri 2.x 需要）
- macOS / Windows / Linux

### 安装 & 运行

```bash
# 克隆仓库
git clone https://github.com/z-Zihan/agent-link.git
cd agent-link

# 安装依赖
pnpm install

# 方式一：Tauri 桌面客户端开发（推荐）
pnpm tauri:dev    # 启动 Tauri 桌面端 + Node.js 后端 + 前端热更新

# 方式二：纯 Web 开发（仅用于浏览器调试，正式分发走 Tauri）
pnpm dev           # 前端 5173 + 后端 3210
```

### 生产构建

```bash
# 构建 Tauri 桌面客户端安装包
pnpm tauri:build   # 生成 .dmg (macOS) / .msi (Windows) / .AppImage (Linux)

# 或仅构建 Web 版本（调试用）
pnpm build         # 构建前端 + 编译后端
pnpm start         # 启动服务，前端由后端静态托管
```

## 项目结构

```
agentlink/
├── docs/
│   ├── PRD.md              # 产品需求文档
│   └── TECH.md             # 技术设计文档
├── packages/
│   ├── shared/             # 前后端共享类型和工具
│   ├── server/             # 后端服务 (Fastify + WS + SQLite)
│   │   ├── src/
│   │   │   ├── routes/         # REST API
│   │   │   ├── ws/             # WebSocket 处理
│   │   │   ├── agent/          # Agent 运行时 + 适配器
│   │   │   │   ├── adapter.ts     # 适配器接口
│   │   │   │   ├── registry.ts    # Agent 注册中心
│   │   │   │   ├── a2a-bus.ts     # A2A 消息总线
│   │   │   │   └── adapters/      # 具体适配器
│   │   │   │       ├── openai.ts
│   │   │   │       ├── openclaw.ts
│   │   │   │       ├── dify.ts
│   │   │   │       └── mock.ts
│   │   │   ├── db/             # Drizzle ORM + SQLite
│   │   │   └── config.ts       # 配置
│   │   └── package.json
│   └── web/                # 前端 (React + Vite)
│       ├── src/
│       │   ├── components/
│       │   │   ├── layout/       # 布局 (Sidebar, ChatArea, InputBar)
│       │   │   ├── message/      # 消息 (Bubble, List, A2AThread, Typing)
│       │   │   └── agent/        # Agent (Avatar, Card)
│       │   ├── store/            # Zustand (chatStore, agentStore)
│       │   ├── hooks/            # useWebSocket
│       │   ├── services/         # API 封装
│       │   └── styles/           # 全局样式
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
├── src-tauri/               # Tauri 桌面端（Rust）
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── src/
│   │   ├── main.rs           # Tauri 入口
│   │   └── lib.rs            # Tauri commands + Node.js sidecar 管理
│   ├── capabilities/
│   └── icons/
├── scripts/
│   └── gen-placeholder-icons.py  # 图标生成
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

## 配置说明

在项目根目录创建 `agentlink.config.ts`：

```typescript
import type { AgentConfig } from "@agentlink/shared";

export default {
  port: 3210,
  agents: [
    {
      id: "gpt4",
      name: "GPT-4o",
      type: "openai",
      config: {
        apiKey: "sk-xxx",
        model: "gpt-4o",
        systemPrompt: "你是通用助手",
      },
    },
    {
      id: "glm",
      name: "GLM-5.2",
      type: "openai",
      config: {
        apiKey: "xxx",
        model: "glm-5.2",
        endpoint: "https://open.bigmodel.cn/api/paas/v4",
        systemPrompt: "你是智谱 AI 助手",
      },
    },
  ],
};
```

### 配置项

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | number | 3210 | 后端服务端口 |
| `dbPath` | string | `./data/agentlink.db` | SQLite 数据库路径 |
| `cors.origin` | string[] | `["http://localhost:5173"]` | CORS 白名单 |
| `auth.enabled` | boolean | false | 是否启用 Bearer Token 认证 |
| `agents` | AgentConfig[] | [] | 预配置 Agent 列表 |

## Agent 适配器

AgentLink 通过统一的 Adapter 接口接入各种 Agent 后端，即插即用。

### 支持的适配器类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `openai` | OpenAI 兼容 API | GPT-4o, GLM, DeepSeek |
| `openclaw` | OpenClaw Agent | OpenClaw session API |
| `dify` | Dify Chat API | Dify 应用 |
| `cli` | 本地 CLI 工具 | Claude Code, Codex |
| `custom` | 自定义 HTTP 服务 | 任意 HTTP Agent |
| `mock` | 测试用 Mock | 开发调试 |

### 适配器接口

```typescript
interface AgentAdapter {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  init(config: Record<string, unknown>): Promise<void>;

  handleMessage(
    message: string,
    context: ConversationContext
  ): AsyncGenerator<StreamChunk, void, unknown>;

  handleA2ACall?(
    from: string,
    message: string,
    context: ConversationContext
  ): AsyncGenerator<StreamChunk, void, unknown>;

  getStatus(): AgentStatus;
  destroy?(): void;
}
```

### 接入示例

```typescript
// 1. 裸 LLM API (最简单)
{
  id: "gpt4",
  name: "GPT-4o",
  type: "openai",
  config: { apiKey: "sk-xxx", model: "gpt-4o" }
}

// 2. OpenClaw Agent
{
  id: "openclaw",
  name: "OpenClaw",
  type: "openclaw",
  config: { endpoint: "http://localhost:18789", sessionKey: "agent:main" }
}

// 3. CLI Agent (Claude Code)
{
  id: "claude-cli",
  name: "Claude CLI",
  type: "cli",
  config: { command: "claude", args: ["-p"], cwd: "/path/to/project" }
}

// 4. Dify Agent
{
  id: "dify-bot",
  name: "Dify Bot",
  type: "dify",
  config: { apiKey: "app-xxx", endpoint: "https://api.dify.ai/v1" }
}
```

## 开发指南

### 开发命令

```bash
pnpm dev              # 同时启动前后端开发服务
pnpm --filter @agentlink/web dev      # 仅启动前端
pnpm --filter @agentlink/server dev   # 仅启动后端
pnpm build            # 构建所有包
pnpm lint             # 代码检查
pnpm typecheck        # 类型检查
```

### 前端开发

前端使用 Vite + React 19 + Tailwind CSS 4，端口 5173。

- **状态管理**: Zustand store（`chatStore` 管理消息和会话，`agentStore` 管理 Agent 列表）
- **实时通信**: WebSocket hook（`useWebSocket`）处理连接、重连、心跳和事件分发
- **消息渲染**: `react-markdown` + `remark-gfm` 渲染 Markdown 和代码块
- **深色主题**: Linear/Vercel/Raycast 风格，bg-gray-900/950 + text-gray-100

### 后端开发

后端使用 Fastify 5 + WebSocket，端口 3210。

- **REST API**: `/api/agents`, `/api/conversations`, `/api/messages`
- **WebSocket**: `/ws` 实时消息推送
- **数据库**: SQLite + Drizzle ORM，WAL 模式
- **Agent 运行时**: Adapter 注册中心 + A2A 消息总线

### WebSocket 事件

```typescript
// 客户端 → 服务端
{ type: "message", conversationId, content }
{ type: "subscribe", conversationId }
{ type: "cancel", messageId }
{ type: "ping" }

// 服务端 → 客户端
{ type: "message", message }
{ type: "stream", messageId, chunk }
{ type: "a2a_call", from, to, message, threadId }
{ type: "agent_status", agentId, status }
{ type: "pong" }
```

### 断线重连

- 指数退避重连（1s → 2s → 4s → ... → 30s 上限）
- 30s 心跳，10s 无 pong 则主动断开
- 重连后通过 `lastEventId` 补发遗漏消息

## 里程碑

| 版本 | 目标 | 状态 |
|------|------|------|
| v0.1 | MVP：单 Agent 流式聊天 + mock A2A 可视化 | 🚧 开发中 |
| v0.2 | 多 Agent + tool-calling A2A + 私聊主场模式 | 📋 规划中 |
| v0.3 | Agent 适配器完善 + 群聊 + 消息搜索 | 📋 规划中 |
| v1.0 | 完整版：插件系统 + 桥接 + 文档 | 📋 规划中 |

## License

MIT


## 部署 / Deployment

### Tauri 桌面客户端（推荐）

```bash
pnpm tauri:build
```

生成平台对应安装包：
- macOS: `.dmg` / `.app`
- Windows: `.msi` / `.exe`
- Linux: `.AppImage` / `.deb`

桌面客户端内置 Node.js 后端（sidecar），用户无需额外安装 Node.js。

### Web 版本（仅用于服务器部署调试，正式分发走 Tauri 桌面客户端）

```bash
pnpm build && pnpm start
```

通过浏览器访问 `http://localhost:3210`，适合服务器部署场景。

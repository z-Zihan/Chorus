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
| 前端 | React 19 + Tailwind CSS 4 + Zustand 5 | 暗色主题，Linear/Vercel 风格 |
| 后端 | Node.js 22 + Fastify 5 + WebSocket | 高性能，内置 TS 支持 |
| 数据库 | SQLite (better-sqlite3) + Drizzle ORM | 零配置，类型安全 |
| 构建 | Vite 6 + pnpm workspace | Monorepo 前后端统一管理 |
| 桌面端 | Tauri 2.x (Rust) | 跨平台，内置 Node.js sidecar |
| 测试 | Vitest + Supertest | 单元测试 + API 集成测试 |
| 语言 | TypeScript 5.5 | 全栈类型安全 |

## 快速开始

### 环境要求

- Node.js ≥ 22 LTS
- pnpm ≥ 9
- Rust ≥ 1.75（Tauri 2.x 需要，仅桌面端构建）

### 安装 & 运行

```bash
git clone https://github.com/z-Zihan/agent-link.git
cd agent-link
pnpm install

# 方式一：Tauri 桌面客户端开发（推荐）
pnpm tauri:dev    # 启动 Tauri 桌面端 + Node.js 后端 + 前端热更新

# 方式二：纯 Web 开发（浏览器调试用）
pnpm dev           # 前端 5173 + 后端 3210
```

### 生产构建

```bash
# macOS: 生成 .dmg / .app
pnpm tauri:build

# Windows: 生成 .msi / .exe (需在 Windows 上执行)
pnpm tauri:build --bundles msi,nsis

# 仅构建 Web 版本（调试用）
pnpm build && pnpm start
```

> Windows 构建详细指南见 [docs/WINDOWS_BUILD.md](docs/WINDOWS_BUILD.md)

## 项目结构

```
agentlink/
├── .github/workflows/
│   └── build.yml            # CI: macOS + Windows 自动构建
├── docs/
│   ├── PRD.md               # 产品需求文档
│   ├── TECH.md              # 技术设计文档
│   ├── DESIGN.md            # 设计规范
│   └── WINDOWS_BUILD.md     # Windows 构建指南
├── packages/
│   ├── shared/              # 前后端共享类型和工具
│   ├── server/              # 后端 (Fastify + WS + SQLite)
│   │   └── src/
│   │       ├── routes/          # REST API + 集成测试
│   │       ├── ws/              # WebSocket 处理
│   │       ├── agent/           # Agent 运行时 + 适配器
│   │       │   ├── adapter.ts   # 适配器接口
│   │       │   ├── registry.ts  # Agent 注册中心
│   │       │   ├── a2a-bus.ts   # A2A 消息总线
│   │       │   └── adapters/    # openai, cli, mock(测试用)
│   │       ├── db/              # Drizzle ORM + SQLite
│   │       └── config.ts        # 配置
│   └── web/                # 前端 (React + Vite)
│       └── src/
│           ├── components/
│           │   ├── layout/      # Sidebar, ChatArea, InputBar
│           │   ├── message/     # MessageBubble, MessageList, A2AThread
│           │   ├── agent/       # AgentAvatar, AgentCard, AgentSettingsPanel
│           │   └── common/      # ErrorBoundary, ToastContainer, ConfirmDialog, PasswordInput
│           ├── store/           # chatStore, agentStore, uiStore
│           ├── hooks/           # useWebSocket
│           ├── services/        # API 封装
│           ├── constants/       # 共享常量
│           └── styles/          # 全局样式
├── src-tauri/              # Tauri 桌面端（Rust）
│   ├── Cargo.toml
│   ├── tauri.conf.json     # 含系统托盘 + bundle 配置
│   ├── src/
│   │   ├── main.rs         # Tauri 入口
│   │   └── lib.rs          # Tauri commands + sidecar + 系统托盘
│   ├── capabilities/       # 权限配置
│   └── icons/              # PNG + ICO + SVG
├── agentlink.config.ts     # Agent 配置
├── DEV_PLAN.md             # 开发计划
└── package.json
```

## 配置说明

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
      config: {
        model: "claude-sonnet-4-20250514",
        command: "claude",
        args: ["-p", "--output-format", "stream-json"],
      },
    },
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
  ],
} satisfies AppConfig;
```

### 配置项

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | number | 3210 | 后端服务端口 |
| `dbPath` | string | `./data/agentlink.db` | SQLite 数据库路径 |
| `cors.origin` | string[] | `["http://localhost:5173"]` | CORS 白名单 |
| `auth.enabled` | boolean | false | 是否启用 Bearer Token 认证 |
| `history.maxMessages` | number | 20 | 上下文历史最大条数 |
| `history.maxTokens` | number | 8000 | 上下文历史最大 token 数 |
| `agents` | AgentConfig[] | [] | 预配置 Agent 列表 |

## Agent 适配器

通过统一的 Adapter 接口接入各种 Agent 后端，即插即用。

### 支持的适配器类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `openai` | OpenAI 兼容 API | GPT-4o, GLM, DeepSeek |
| `cli` | 本地 CLI 工具 | Claude Code, Codex |
| `openclaw` | OpenClaw Agent | OpenClaw session API（规划中） |
| `dify` | Dify Chat API | Dify 应用（规划中） |
| `custom` | 自定义 HTTP 服务 | 任意 HTTP Agent |
| `mock` | 测试用 Mock | 仅用于单元测试 |

## 开发指南

### 开发命令

```bash
pnpm dev              # 同时启动前后端开发服务
pnpm build            # 构建所有包
pnpm test             # 运行测试 (17 tests)
pnpm tauri:dev        # Tauri 桌面端开发
pnpm tauri:build      # Tauri 桌面端生产构建
pnpm typecheck        # 类型检查
```

### 前端开发

- **状态管理**: Zustand（chatStore 管理消息和会话，agentStore 管理 Agent，uiStore 管理 UI 状态）
- **实时通信**: WebSocket hook（心跳、重连、lastEventId 补发）
- **消息渲染**: `react-markdown` + `remark-gfm`，代码块带语言标签 + 复制按钮
- **错误处理**: ErrorBoundary + Toast 通知 + 离线检测
- **响应式**: 移动端侧栏 overlay + 汉堡菜单

### 后端开发

- **REST API**: `/api/agents`, `/api/conversations`, `/api/messages`
- **WebSocket**: `/ws` 实时消息推送
- **数据库**: SQLite + Drizzle ORM，WAL 模式
- **Agent 运行时**: Adapter 注册中心 + A2A 消息总线（环检测 + 并发控制 + 超时）
- **测试**: Vitest + Supertest，内存 SQLite 集成测试

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
{ type: "a2a_response", threadId, chunk }
{ type: "agent_status", agentId, status }
{ type: "typing", agentId, conversationId, isTyping }
{ type: "pong" }
```

## 里程碑

| 版本 | 目标 | 状态 |
|------|------|------|
| v0.1 | MVP：单 Agent 流式聊天 + A2A 可视化 + Tauri 桌面端 + 测试 | ✅ 已完成 |
| v1.1 | 基础设施：i18n + 暗色模式 + 日志 + 埋点 + 多环境 + 端内更新 | 📋 规划中 |
| v0.2 | 多 Agent + tool-calling A2A + 私聊主场模式 | 📋 规划中 |
| v0.3 | Agent 适配器完善 + 群聊 + 消息搜索 | 📋 规划中 |
| v1.0 | 完整版：插件系统 + 桥接 + 文档 | 📋 规划中 |

## 部署

### Tauri 桌面客户端（推荐）

```bash
pnpm tauri:build
```

生成平台对应安装包：
- macOS: `.dmg` / `.app`
- Windows: `.msi` / `.exe` (NSIS)
- Linux: `.AppImage` / `.deb`

桌面客户端内置 Node.js 后端（sidecar），用户无需额外安装 Node.js。关闭窗口最小化到系统托盘。

### CI 自动构建

项目配置了 GitHub Actions（`.github/workflows/build.yml`）：
- Push tag `v*` 自动触发 macOS + Windows 构建
- 也可在 Actions 页面手动触发
- 构建产物上传为 artifact 供下载

## License

MIT

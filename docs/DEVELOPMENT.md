# Chorus — 开发者指南

> 面向贡献者的项目结构、启动方式和开发注意事项。

## 快速启动

### 环境要求

- Node.js ≥ 22 LTS
- pnpm ≥ 9
- Rust ≥ 1.75（仅 Tauri 桌面端构建需要）

### 安装与运行

```bash
git clone https://github.com/z-Zihan/Chorus.git
cd Chorus
pnpm install

# Web 开发模式（浏览器调试）
pnpm dev

# Tauri 桌面端开发模式（原生窗口）
pnpm tauri:dev

# 生产构建
pnpm build           # 构建所有包
pnpm tauri:build     # 构建桌面端安装包
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 同时启动前端 (5173) + 后端 (3210) |
| `pnpm build` | 构建所有包（shared → relay → server → web） |
| `pnpm test` | 运行测试（39 个） |
| `pnpm lint` | ESLint 检查 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm db:studio` | Drizzle Studio 可视化数据库 |
| `pnpm db:migrate` | 执行数据库迁移 |

## 项目结构

```
Chorus/
├── packages/
│   ├── shared/              # 前后端共享类型和工具
│   ├── server/              # 后端服务（Node.js + Fastify）
│   ├── web/                 # 前端（React + Vite）
│   └── relay/               # 中继服务器（独立部署）
├── src-tauri/               # Tauri 桌面端（Rust）
├── docs/                    # 文档
├── chorus.config.ts      # Agent 配置（可选，零配置也能用）
└── .env.example             # 环境变量示例
```

### packages/shared — 共享类型

前后端共用的 TypeScript 类型定义，确保类型安全。

```
shared/src/
├── types/
│   ├── agent.ts          # Agent、AgentConfig、AgentAdapter 接口
│   ├── conversation.ts   # Conversation、Message 类型
│   ├── hub.ts            # HubEnvelope、HubPayload、RoomMember（跨设备通信）
│   ├── relay.ts          # RelayClientMessage、RelayServerMessage
│   ├── events.ts         # WebSocket 事件类型（ServerEvent、ClientEvent）
│   └── config.ts         # AppConfig、HubConfig 配置类型
└── utils/
    └── history.ts        # truncateHistory、parseMentions 工具函数
```

### packages/server — 后端服务

Node.js + Fastify + WebSocket + SQLite。核心业务逻辑全在这里。

```
server/src/
├── index.ts              # 入口：启动 Fastify + WS + Agent 运行时
├── config.ts             # 配置加载（文件 + 环境变量）
├── config-watcher.ts     # 配置文件热加载
│
├── agent/                # Agent 运行时
│   ├── adapter.ts        # AgentAdapter 接口定义
│   ├── registry.ts       # Agent 注册中心（内存 + DB 持久化）
│   ├── runtime.ts        # Agent 执行运行时（消息路由、流式输出）
│   ├── a2a-bus.ts        # A2A 消息总线（环检测、并发控制、超时）
│   ├── persistence.ts    # Agent 配置持久化（DB 读写）
│   ├── permissions.ts    # A2A 权限系统（auto/confirm/deny）
│   ├── metrics.ts        # Agent 调用指标（次数、延迟、错误率）
│   ├── chorus-skill.ts # 注入 Agent 的平台使用指南
│   └── adapters/         # 具体适配器
│       ├── openai.ts     # OpenAI API（支持 tool-calling A2A）
│       ├── cli.ts        # CLI 工具（Claude Code、Codex 等，支持 prompt-based A2A）
│       ├── custom.ts     # 通用 HTTP API
│       ├── dify.ts       # Dify Chat API
│       ├── openclaw.ts   # OpenClaw
│       ├── langchain.ts  # LangChain Runnable
│       └── mock.ts       # 测试用 Mock（仅测试）
│
├── cli-detector/         # CLI 自动检测
│   ├── descriptors.ts    # 14 个 CLI 的描述符定义
│   ├── detector.ts       # 检测编排器（缓存、并发控制）
│   ├── path-scanner.ts   # PATH 扫描 + 平台目录发现
│   ├── probe.ts          # 安全版本探测（无副作用命令）
│   └── utils.ts          # 共享工具函数
│
├── catalog/              # Agent 目录与安装
│   ├── schema.ts         # CatalogEntry 类型定义
│   ├── default-catalog.ts # 17 个内置条目
│   ├── index.ts          # CatalogService（列表、已安装状态）
│   └── installer.ts      # 安装执行器（brew/npm/pip/winget）
│
├── hub/                  # 跨设备通信（Hub Client）
│   ├── identity.ts       # Ed25519 密钥对管理
│   ├── crypto.ts         # E2E 加密（libsodium crypto_box）
│   ├── relay-client.ts   # Relay Server WebSocket 客户端
│   ├── message-router.ts # 跨 Hub 消息路由（加解密 + 签名验证）
│   ├── connection-manager.ts # 混合模式（P2P 优先 + Relay 兜底）
│   ├── p2p-discovery.ts  # mDNS 局域网发现
│   ├── p2p-listener.ts   # P2P WebSocket 监听 + 健康检查
│   └── p2p-handshake.ts  # Ed25519 双向认证握手
│
├── credential-store.ts   # 系统级密钥存储（Keychain/Credential Manager/libsecret）
├── analytics.ts          # 埋点框架
├── scheduler/            # 定时任务（cron）
├── mcp/                  # MCP 协议客户端
├── plugins/              # 插件系统（加载器 + manifest 验证）
│
├── db/                   # 数据库
│   ├── schema.ts         # Drizzle ORM schema
│   ├── index.ts          # SQLite 实例 + 自动迁移
│   ├── repository.ts     # 数据访问层
│   └── search.ts         # FTS5 全文搜索
│
├── routes/               # REST API 路由
│   ├── agents.ts         # /api/agents
│   ├── conversations.ts  # /api/conversations
│   ├── catalog.ts        # /api/catalog + /api/installations
│   ├── detections.ts     # /api/cli/detections
│   ├── onboarding.ts     # /api/onboarding
│   ├── hub.ts            # /api/hub/*
│   ├── scheduler.ts      # /api/scheduler/tasks
│   ├── plugins.ts        # /api/plugins
│   ├── metrics.ts        # /api/agents/:id/metrics
│   └── index.ts          # 路由注册汇总
│
├── ws/                   # WebSocket
│   ├── handler.ts        # 连接处理 + 事件分发
│   └── events.ts         # EventHub（订阅/广播）
│
└── middleware/
    └── auth.ts           # Bearer Token 认证中间件
```

### packages/web — 前端

React 19 + Tailwind CSS 4 + Zustand 5 + Vite 6。

```
web/src/
├── App.tsx               # 应用入口（Onboarding + 主界面 + 设置面板）
├── main.tsx              # React 挂载
├── i18n.ts               # i18next 初始化
│
├── components/
│   ├── ui/               # 基础 UI 组件（Radix 封装）
│   │   ├── button.tsx    # Button（cva 变体：primary/secondary/ghost/danger）
│   │   ├── dialog.tsx    # Dialog（Radix）
│   │   ├── input.tsx     # Input
│   │   ├── dropdown-menu.tsx
│   │   ├── select.tsx
│   │   ├── switch.tsx
│   │   └── tooltip.tsx
│   ├── common/           # 业务通用组件
│   │   ├── ErrorBoundary.tsx
│   │   ├── ToastContainer.tsx
│   │   ├── ConfirmDialog.tsx
│   │   ├── PasswordInput.tsx
│   │   ├── SettingsPanel.tsx    # 全局设置（主题/语言/安全/Hub/日志/插件/定时任务）
│   │   ├── LogViewer.tsx
│   │   └── UpdateBanner.tsx
│   ├── layout/           # 布局组件
│   │   ├── Sidebar.tsx          # 侧边栏（会话列表 + Agent 列表 + 添加 Agent）
│   │   ├── ChatArea.tsx         # 聊天主区域
│   │   └── InputBar.tsx         # 输入框（AgentSelector + 发送/取消）
│   ├── message/          # 消息相关
│   │   ├── MessageList.tsx      # 消息列表（分组渲染 + 滚动锚定）
│   │   ├── MessageBubble.tsx    # 消息气泡（Markdown + 代码块 + 折叠）
│   │   ├── TypingIndicator.tsx  # 正在输入指示器
│   │   ├── A2AThread.tsx        # A2A 调用线程（历史消息）
│   │   └── TaskTrackingCard.tsx # 任务追踪卡片（实时 A2A）
│   ├── agent/            # Agent 相关
│   │   ├── AgentAvatar.tsx
│   │   ├── AgentHealthBadge.tsx
│   │   └── AgentSettingsPanel.tsx
│   ├── catalog/          # Agent 目录
│   │   ├── CatalogModal.tsx     # 目录弹窗（浏览/安装/添加）
│   │   └── AgentManager.tsx     # 已安装 Agent 管理
│   ├── chat/             # 聊天功能
│   │   ├── AgentSelector.tsx    # @Agent 选择器
│   │   └── GroupMemberList.tsx  # 群聊成员列表
│   ├── onboarding/       # 首次启动
│   │   └── OnboardingFlow.tsx
│   ├── search/           # 搜索
│   │   └── SearchPanel.tsx      # Ctrl+K 全文搜索
│   └── hub/              # 跨设备状态
│       └── ConnectionStatus.tsx
│
├── store/                # Zustand 状态管理
│   ├── chatStore.ts      # 会话 + 消息 + 发送 + 流式
│   ├── streamManager.ts  # 流式超时 + AbortController
│   ├── agentStore.ts     # Agent 列表 + 选择 + 健康状态
│   ├── uiStore.ts        # Toast + 离线状态
│   ├── onboardingStore.ts
│   ├── catalogStore.ts
│   ├── searchStore.ts
│   ├── hubStore.ts
│   ├── schedulerStore.ts
│   └── pluginStore.ts
│
├── hooks/                # React Hooks
│   ├── useWebSocket.ts   # WS 连接 + 心跳 + 重连 + 事件分发
│   ├── useHotkey.ts      # 全局快捷键
│   └── useAgentSettings.ts # Agent 表单状态
│
├── services/             # API 封装
│   ├── api.ts            # 所有 REST API 调用
│   ├── theme.ts          # 主题管理
│   ├── updater.ts        # Tauri 更新
│   ├── terminal.ts       # 打开终端
│   └── env.ts            # 环境检测
│
├── styles/
│   ├── globals.css       # 全局样式 + 动画
│   └── themes.css        # CSS 变量（暗色/亮色）
│
├── locales/              # i18n 翻译文件
│   ├── zh-CN/            # 中文（common/sidebar/chat/settings/errors）
│   └── en/               # 英文
│
├── lib/
│   ├── cn.ts             # clsx + tailwind-merge
│   └── date.ts           # date-fns 封装
│
├── constants/
│   └── agent.ts          # Agent 状态颜色/标签常量
│
└── utils/
    ├── logger.ts         # 前端日志（ring buffer）
    └── analytics.ts      # 埋点
```

### packages/relay — 中继服务器

独立部署的 Relay Server，用于跨设备消息转发。

```
relay/src/
├── index.ts              # Fastify 入口
├── hub-registry.ts       # Hub 注册与认证
├── message-router.ts     # 消息路由（按 Hub ID）
├── offline-store.ts      # 离线消息存储（SQLite, TTL 7天）
├── room-manager.ts       # 群聊房间管理
├── auth.ts               # HMAC-SHA256 Token
├── socket.ts             # WebSocket 封装
├── routes/index.ts       # REST API
├── ws/handler.ts         # WS 连接处理
├── db/                   # SQLite + Drizzle
└── utils/logger.ts       # pino 日志
```

### src-tauri/ — 桌面端

Rust + Tauri 2.x，管理 Node.js sidecar 和系统集成。

```
src-tauri/
├── src/
│   ├── main.rs           # Tauri 入口
│   └── lib.rs            # Tauri commands + sidecar + 系统托盘
├── Cargo.toml            # Rust 依赖
├── tauri.conf.json       # Tauri 配置（窗口、托盘、bundle、updater）
├── capabilities/         # 权限配置
└── icons/                # 应用图标（PNG + ICO + SVG）
```

## 开发注意事项

### 代码风格
- TypeScript 严格模式，所有函数必须有返回类型
- 使用 `import` 不使用 `require`
- 文件命名：kebab-case（`a2a-bus.ts`），组件命名：PascalCase（`AgentAvatar.tsx`）
- CSS 用变量（`var(--bg-surface)`），不用硬编码颜色
- 所有用户可见文案走 i18n（`t('key')`），不硬编码中文

### 状态管理
- Zustand store 按职责拆分（chatStore、agentStore、uiStore 等）
- 使用 selector 订问（`useStore((s) => s.field)`），不要解构整个 store
- 异步操作在 store action 里处理，组件只负责渲染

### 新增 Agent 适配器
1. 在 `packages/server/src/agent/adapters/` 创建新文件
2. 实现 `AgentAdapter` 接口（`init`、`handleMessage`、`getStatus`）
3. 在 `registry.ts` 的 `createAdapter()` 注册
4. 在 `cli-detector/descriptors.ts` 添加描述符（如果是 CLI）
5. 在 `catalog/default-catalog.ts` 添加目录条目

### 新增 CLI 支持
1. 在 `descriptors.ts` 添加 CliDescriptor
2. 在 `default-catalog.ts` 添加 CatalogEntry
3. 更新 `__tests__/detector.test.ts` 的预期数量
4. 如果输出格式特殊，在 `cli.ts` 的 `formatJsonLine` 或 `parseCodexJson` 加解析逻辑

### 数据库变更
1. 修改 `db/schema.ts`
2. 运行 `pnpm db:generate` 生成迁移文件
3. 迁移文件在 `packages/server/drizzle/` 目录
4. 启动时自动执行（`db/index.ts` 的 `migrate()` 调用）

### 环境变量
- 前端：`VITE_*` 前缀（Vite 自动注入）
- 后端：`SERVER_*` 前缀
- `.env` 开发用，`.env.production` 生产用
- 不要提交 `.env.local`

### 测试
- 测试文件放在 `__tests__/` 目录，文件名 `*.test.ts`
- 后端集成测试用内存 SQLite（`:memory:`）
- 运行：`pnpm test`

### Git 提交
- husky pre-commit 自动运行 lint-staged
- commit message 用 conventional commits（`feat:`、`fix:`、`docs:` 等）
- 不要提交 `data/`、`node_modules/`、`dist/`、`target/`

## 环境变量参考

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_API_BASE_URL` | `/api` | 前端 API 基础路径 |
| `VITE_WS_BASE_URL` | `ws://localhost:3210/ws` | WebSocket 地址 |
| `VITE_DEFAULT_THEME` | `dark` | 默认主题 |
| `VITE_DEFAULT_LANG` | `zh-CN` | 默认语言 |
| `SERVER_PORT` | `3210` | 后端端口 |
| `SERVER_LOG_LEVEL` | `info` | 后端日志级别 |
| `SERVER_DB_PATH` | 应用数据目录 | SQLite 路径 |
| `RELAY_PORT` | `3211` | Relay 端口 |
| `RELAY_JWT_SECRET` | — | Relay JWT 密钥 |
| `RELAY_OFFLINE_TTL_DAYS` | `7` | 离线消息保留天数 |

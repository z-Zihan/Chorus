# AgentLink

> 把你电脑里的 AI CLI 放进同一个聊天窗口。<br>
> A local-first IM workspace for AI CLI agents.

AgentLink 是面向 Claude Code、Codex、GitHub Copilot CLI 等 AI 命令行工具的本地桌面工作台。它让用户像打开即时通讯软件一样发现、安装、配置和使用 Agent；既能一对一聊天，也能让多个 Agent 在群聊中协作，而不必在多个终端、历史记录和配置文件之间来回切换。

> [!IMPORTANT]
> 当前仓库是 **v0.1 开发者预览版**。单 Agent 流式聊天、CLI/OpenAI 适配器、本地历史、A2A 调用链展示和 Relay 服务端已经可运行；**CLI 自动检测、真正的零配置首启、端内 Agent 安装和群聊 UI 尚未完成**。因此当前版本仍需要开发者准备 `agentlink.config.ts`，不能把它描述为面向普通用户的“打开即用”版本。

## 为什么做 AgentLink

AI CLI 很强，但日常体验仍然碎片化：每个工具有自己的命令、会话、配置和输出格式；切换 Agent 等于切换终端；协作时还要由人复制粘贴上下文。

AgentLink 要解决的不是“再做一个聊天机器人”，而是把本机已有的 AI CLI 变成可发现、可管理、可对话、可协作的本地 Agent：

- **CLI 管理工具**：自动发现已安装的 AI CLI，并用统一界面聊天和管理。
- **应用内安装**：像安装应用一样浏览、安装、验证和卸载 Agent。
- **Agent 群聊**：让多个 Agent 在同一房间交流，保留可查看的协作过程。
- **单人也有价值**：即使不用群聊，也能获得更好的 CLI 会话、历史和配置体验。
- **低认知负担**：首次打开自动检测，给出明确下一步，默认不要求用户编辑文件。

完整的现状判断与证据见 [产品审计](docs/PRODUCT_AUDIT.md)。

## 适合谁

- 同时使用 Claude Code、Codex、Copilot CLI 等多个工具的开发者。
- 想保留本地数据和本地执行能力，又希望获得现代聊天体验的 CLI 用户。
- 需要让代码、测试、安全、构建等不同 Agent 协作的个人或团队。
- 正在开发 Agent，希望用统一适配器和可视化调用链调试工作流的工程团队。

如果你只需要一个云端通用问答机器人，AgentLink 不是更简单的选择。

## 功能

### 当前可用（v0.1 开发者预览）

| 能力 | 用户能得到什么 | 当前限制 |
|------|----------------|----------|
| CLI / OpenAI 适配器 | 在统一聊天界面使用已配置的 Agent | CLI 必须手动写入配置，未自动发现 |
| 流式聊天 | Markdown、代码块、停止生成、错误与离线状态 | 每个会话当前实际只路由给一个主 Agent |
| 本地会话历史 | SQLite 持久化、创建和删除会话 | 暂无搜索、重命名、导出和归档 |
| Agent 设置 | 在界面修改已有 Agent 的名称、模型和部分参数 | 不能从 UI 创建或安装 Agent |
| A2A 基础与可视化 | 展开查看 Agent 间调用线程 | 主要是底层能力，未形成完整群聊体验 |
| 桌面端 | Tauri 桌面窗口、系统托盘、macOS/Windows 构建 | 首启仍依赖开发配置 |
| Relay 服务端 | Hub 注册、消息转发、离线消息、房间 API | 桌面端 Hub Client 尚未接通，终端用户暂不可直接使用跨设备群聊 |

### 近期计划

- **P0 — CLI 自动检测**：扫描有效 PATH 和常见安装目录，识别 Claude Code、Codex、Copilot CLI 等，并安全验证版本。
- **P0 — 零配置首启**：没有配置文件也能创建应用数据目录、发现 Agent、建立首个会话并发送消息。
- **P0 — 首次运行引导**：把“已安装但未登录”“没有发现 CLI”“检测失败”变成可恢复的产品路径。
- **P1 — Agent 目录与安装 UI**：浏览本地目录、查看来源与权限、安装/启用/卸载 Agent。
- **P1 — 完整历史管理**：搜索、重命名、归档、导出和清理会话。
- **P1 — 本地群聊**：创建群聊、选择多个 Agent、`@` 路由并展示真实的多 Agent 协作。
- **后续 — 跨设备协作**：桌面 Hub Client 接入 Relay/P2P，支持团队与远程 Agent 群聊。

## 快速开始

### 目标体验：零配置（v0.2）

面向最终用户的正确流程应该只有三步：

```text
安装并打开 AgentLink
        ↓
自动发现本机 AI CLI，并显示“可用 / 需要登录 / 未安装”
        ↓
选择一个 Agent，直接发送第一条消息
```

这条路径是当前最高优先级，**尚未在 v0.1 实现**。

### 当前开发版

环境要求：Node.js 22 LTS、pnpm 9；构建桌面端还需要 Rust 1.75+。

```bash
git clone https://github.com/z-Zihan/agent-link.git
cd agent-link
pnpm install

# 推荐：桌面端开发模式
pnpm tauri:dev

# 或浏览器开发模式：Web 5173 + Server 3210
pnpm dev
```

仓库自带的 `agentlink.config.ts` 预设了 Claude Code。运行前需要确保 `claude` 已安装、已登录并能被启动进程的 PATH 找到，否则 Agent 会不可用。

生产构建：

```bash
pnpm build
pnpm tauri:build
```

Windows 打包说明见 [Windows 构建指南](docs/WINDOWS_BUILD.md)。

### 自带配置（高级用户）

自动检测完成后，配置文件仍会作为高级覆盖入口保留，而不是普通用户的必经步骤。在当前开发版中，可编辑项目根目录的 `agentlink.config.ts`：

```typescript
import type { AppConfig } from "@agentlink/shared";

export default {
  port: 3210,
  dbPath: "./data/agentlink.db",
  agents: [
    {
      id: "claude",
      name: "Claude Code",
      type: "cli",
      config: {
        command: "claude",
        args: ["-p", "--output-format", "stream-json", "--verbose"],
        input: "argument",
        output: "jsonl",
      },
    },
    {
      id: "codex",
      name: "Codex",
      type: "cli",
      config: {
        command: "codex",
        args: ["exec", "--json"],
        input: "argument",
        output: "codex-json",
      },
    },
  ],
} satisfies AppConfig;
```

不要把真实 API Key 提交到 Git。当前版本尚未完成系统钥匙串集成，敏感配置只适合本地开发使用。

## 工作原理

```text
你
│  像使用 IM 一样聊天、查历史、切换 Agent
▼
AgentLink 桌面端
│  自动发现 / 安装 / 配置（目标）
│  统一消息、会话和 A2A 调用链
▼
本地 Agent Hub
├── Claude Code CLI
├── Codex CLI
├── Copilot CLI
├── OpenAI-compatible API
└── 其他 Adapter

可选：本地 Hub ── 加密消息 ── 自托管 Relay ── 其他人的 Hub
```

聊天记录默认存储在本机 SQLite；CLI 在本机以当前用户权限执行。AgentLink 不提供模型本身，联网范围取决于所使用的 CLI、模型供应商和可选 Relay。

## 路线图

| 版本 | 交付结果 | 状态 |
|------|----------|------|
| v0.1 | 开发者预览：单 Agent 流式聊天、本地历史、CLI/OpenAI Adapter、A2A 基础、桌面打包、Relay Server | ✅ 当前 |
| v0.2 | CLI 驾驶舱：自动检测、零配置首启、登录恢复、首次消息闭环 | 🔴 下一步 |
| v0.3 | 管理体验：Agent 目录与端内安装、完整历史管理、本地多 Agent 群聊 | 📋 规划中 |
| v0.4 | 协作体验：稳定的 tool-calling A2A、权限确认、任务追踪和群聊路由 | 📋 规划中 |
| v1.0 | 团队版：桌面 Hub Client、Relay/P2P、跨设备群聊和端到端加密 | 📋 规划中 |

路线图以用户结果排序。i18n、主题、日志等基础设施必须服务于上述结果，不能再次排在自动检测和首启闭环之前。

## 自托管 Relay

Relay 用于跨网络的 Hub 消息转发、离线消息和房间管理。服务端代码与 Docker 配置已经在 `packages/relay` 中；**当前桌面客户端尚未接入 Hub Client，因此部署 Relay 不会自动解锁桌面端跨设备聊天**。

```bash
cp packages/relay/.env.example packages/relay/.env
# 编辑 packages/relay/.env，务必替换 RELAY_JWT_SECRET

docker compose \
  --env-file packages/relay/.env \
  -f packages/relay/docker-compose.yml \
  up -d --build

curl http://localhost:3211/api/health
```

生产环境还必须：

- 使用足够长的随机 `RELAY_JWT_SECRET`，不要保留 `change-me` 或开发默认值。
- 把 `/data` 挂载到持久卷并备份 SQLite。
- 通过 Nginx/Caddy 提供 TLS，外部只暴露 HTTPS/WSS。
- 限制来源、端口和日志访问；当前镜像更适合测试与早期自托管，不应直接裸露到公网。

环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RELAY_PORT` | `3211` | Relay HTTP/WebSocket 端口 |
| `RELAY_JWT_SECRET` | 开发默认值 | 生产环境必填 |
| `RELAY_OFFLINE_TTL_DAYS` | `7` | 离线消息保留天数 |
| `RELAY_MAX_HUBS` | `1000` | 单实例 Hub 上限 |
| `RELAY_DB_PATH` | `./data/relay.db` | SQLite 路径 |
| `RELAY_LOG_LEVEL` | `info` | 日志级别 |

协议与部署设计见 [Relay 设计文档](docs/RELAY_DESIGN.md)。

## 常用开发命令

```bash
pnpm dev          # Web + Server 开发
pnpm tauri:dev    # 桌面端开发
pnpm build        # 构建 shared、relay、server、web
pnpm typecheck    # 全仓类型检查
pnpm test         # 单元与 API 集成测试
pnpm lint         # ESLint
```

技术细节见 [技术设计](docs/TECH.md)，产品范围见 [PRD](docs/PRD.md)，交付顺序见 [开发计划](DEV_PLAN.md)。

## FAQ

### 我的数据是私密的吗？

聊天记录默认保存在本机 SQLite，不会因为使用 AgentLink 自动上传到 AgentLink 云端。但你使用的 AI CLI 或模型 API 可能把提示词发送给其供应商；CLI 也继承当前系统用户权限。隐私边界取决于所选 Agent。当前敏感配置尚未接入系统钥匙串，不要把密钥提交到仓库。

### 可以完全离线使用吗？

AgentLink 的界面、服务端和历史记录可以本地运行。某个 Agent 是否离线可用取决于它本身：本地模型可以离线，Claude Code、Codex 等通常仍需要登录和网络。群聊不是离线使用的前提。

### 它和 ChatGPT 有什么不同？

ChatGPT 是模型与云端助手产品；AgentLink 是本机 Agent 的管理和通信层。它不提供一个新的基础模型，而是统一已有 CLI、会话、配置和多 Agent 协作。

### 现在能自动发现 Claude Code 或 Codex 吗？

不能。v0.1 只能运行配置中声明的 CLI。自动检测是 v0.2 的第一优先级和发布门槛。

### 现在能从界面安装 Agent 吗？

不能。后端已有注册 API，但没有面向用户的目录、权限确认、安装、验证和卸载闭环；把 API 存在当成“可安装”会误导用户。

### 群聊现在可用吗？

还不可作为完整用户功能使用。仓库已有 A2A Bus、线程展示、`group` 数据字段和 Relay 房间基础，但缺少本地群聊创建、成员管理、多 Agent 路由和桌面 Hub Client。

## License

MIT

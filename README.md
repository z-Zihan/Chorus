# AgentLink

> 把你电脑里的 AI CLI 放进同一个聊天窗口——一个本地优先的 AI Agent 桌面工作台。

## 产品介绍

AgentLink 的核心是 **Agent 间通信（A2A）**——让不同的 AI Agent 能够直接对话、协作完成任务。

想象一下：你在写代码时遇到一个前端布局问题，Claude Code 自己解决不了，它可以**主动调用** Codex 来帮忙，两个 Agent 像同事一样讨论方案，整个过程你能看到、能插话、能叫停。这不是你在多个工具间复制粘贴，而是 Agent 自己知道该找谁、怎么问。

为了让 A2A 真正有用，AgentLink 还做了这些：

- **统一管理 AI CLI**：自动发现本机已安装的 Claude Code、Codex、Gemini CLI 等工具，一个界面全搞定。
- **群聊协作**：把多个 Agent 拉进同一个会话，@谁谁就回复，不@就所有人一起讨论。
- **跨设备通信**：通过自托管 Relay 服务器，你的 Agent 可以和同事电脑上的 Agent 通信——端到端加密，数据不经第三方。
- **本地优先**：所有数据默认存在本机 SQLite，不依赖云端，离线也能用。

管理 CLI 只是手段，**让 Agent 之间能交流、能协作、能跨设备跨人协作**才是 AgentLink 要做的事。

## 愿景

AI CLI 已经能完成复杂的编码与自动化任务，但使用体验仍然分散：不同工具有不同的命令、会话、配置和输出格式；切换 Agent 往往意味着切换终端，协作则依赖人工复制上下文。

AgentLink 希望成为本地 AI Agent 的统一入口。它自动发现电脑中已有的 CLI，用一致的聊天界面连接 Agent、管理会话和查看运行状态，让一个 CLI 也更好用，让多个 Agent 也能自然协作。

AgentLink 坚持 local-first：聊天记录默认保存在本机，CLI 在本机运行，用户可以自由选择模型供应商，并在需要远程协作时部署自己的 Relay。它不是一个新的模型，而是连接用户、AI CLI 与 Agent 工作流的通信层。

## 核心功能

### 现在可用

- 🔍 **自动发现 CLI**：扫描本机环境，识别已安装的 AI CLI 及其可用状态。
- 💬 **统一流式聊天**：在一个界面中使用不同 Agent，支持 Markdown、代码块、停止生成和错误提示。
- 🧩 **Agent 目录**：添加本机 CLI，或配置 OpenAI-compatible API Connector。
- 🗂️ **本地会话历史**：使用 SQLite 保存聊天记录，支持创建、切换和删除会话。
- 🔗 **A2A 调用链**：展示 Agent 之间的调用过程，帮助理解和调试协作任务。
- 🖥️ **跨平台桌面端**：基于 Tauri，面向 macOS 与 Windows 提供原生桌面体验。
- 🏠 **可自托管 Relay**：提供 Hub 注册、消息转发、离线消息与房间管理能力。

### 开发中

- 🚀 **完整的零配置首启体验**：更顺畅地处理未安装、未登录与不兼容等状态。
- 👥 **多 Agent 群聊**：在同一会话中选择多个 Agent，通过 `@` 提及进行协作。
- 🔎 **增强的历史管理**：会话搜索、重命名、归档、导出与清理。
- 🌐 **跨设备协作**：桌面端连接自托管 Relay，在不同设备和团队之间通信。
- 🔐 **系统级密钥存储**：使用操作系统钥匙串保护 API 凭据。

## 产品预览

<!-- Screenshots and product preview will be added here. -->

## 快速开始

准备 Node.js 22 LTS、pnpm 9，以及至少一个已安装并登录的受支持 AI CLI。

```bash
git clone https://github.com/z-Zihan/agent-link.git
cd agent-link
pnpm install
pnpm tauri:dev
```

AgentLink 启动后会自动扫描本机 CLI。选择检测到的 Agent，即可开始对话，无需先编写配置文件。

也可以只启动 Web 界面与本地服务：

```bash
pnpm dev
```

构建桌面应用需要 Rust 工具链：

```bash
pnpm build
pnpm tauri:build
```

Windows 打包细节见 [Windows 构建指南](docs/WINDOWS_BUILD.md)。

## 工作原理

```text
                           可选：远程协作
                              ┌──────────────┐
                              │ 自托管 Relay │
                              └──────▲───────┘
                                     │
┌────────┐     ┌─────────────────────┴──────┐
│  用户  │ ──▶ │ AgentLink 桌面端 / 本地 Hub │
└────────┘     └──────────────┬─────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
     本机 AI CLI         API Connector       本地 SQLite
   Claude / Codex…     OpenAI / GLM…        会话与配置
```

AgentLink 统一不同 Agent 的消息格式、流式输出与状态管理。CLI 以当前系统用户权限在本机执行；模型请求是否联网以及数据如何处理，取决于所选择的 CLI 或 API 服务商。

## 支持的 AI CLI

| 类型 | 名称 | 接入方式 |
|------|------|----------|
| CLI | Claude Code | 本机自动检测 |
| CLI | Codex | 本机自动检测 |
| CLI | GitHub Copilot CLI | 本机自动检测 |
| CLI | Gemini CLI | 本机自动检测 |
| CLI | Aider | 本机自动检测 |
| CLI | Qwen Code | 本机自动检测 |
| CLI | Cursor CLI | 本机自动检测 |
| CLI | Kilo CLI | 本机自动检测 |
| CLI | OpenCode | 本机自动检测 |
| API Connector | OpenAI API | OpenAI-compatible API |
| API Connector | DeepSeek API | OpenAI-compatible API |
| API Connector | GLM API | OpenAI-compatible API |

AgentLink 不包含上述工具或模型本身。使用前请根据对应服务商的要求完成安装、登录或 API 凭据配置。

## 自托管 Relay

Relay 用于跨网络消息转发、离线消息和房间管理。桌面端跨设备接入仍在开发中；当前可独立部署 Relay 服务：

```bash
cp packages/relay/.env.example packages/relay/.env
# 编辑 .env，并设置安全的 RELAY_JWT_SECRET

docker compose \
  --env-file packages/relay/.env \
  -f packages/relay/docker-compose.yml \
  up -d --build

curl http://localhost:3211/api/health
```

生产环境请持久化 `/data`、定期备份数据库，并通过 Nginx 或 Caddy 提供 HTTPS/WSS。不要使用示例密钥，也不要将 Relay 直接裸露在公网。

## 配置

自动发现可以满足大多数场景。需要手动指定命令或参数时，可在项目根目录使用 `agentlink.config.ts`：

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
  ],
} satisfies AppConfig;
```

不要将 API Key 或其他敏感信息提交到 Git。系统钥匙串集成仍在开发中。

## FAQ

### AgentLink 会上传我的聊天记录吗？

聊天记录默认保存在本机 SQLite，AgentLink 不会因为本地使用而自动将记录上传到自己的云端。但你选择的 AI CLI 或 API 可能会把提示词发送给其服务商，请同时阅读对应服务的隐私政策。

### 可以完全离线使用吗？

AgentLink 的界面、本地服务和历史记录可以离线运行。具体 Agent 能否离线工作取决于它自身；本地模型可以离线，云端 CLI 与 API 通常需要网络连接。

### AgentLink 和 ChatGPT 有什么不同？

ChatGPT 是模型与云端助手产品；AgentLink 是本机 Agent 的管理和通信层。它不提供新的基础模型，而是统一已有 CLI、API Connector、会话和协作体验。

### 使用 AgentLink 还需要安装 AI CLI 吗？

需要。AgentLink 会发现并连接本机已有的 CLI，但不包含这些工具本身。也可以不安装 CLI，直接配置支持的 API Connector。

### CLI 能访问我的文件吗？

CLI 以当前系统用户权限运行，其文件与命令权限由 CLI 自身和系统环境决定。添加 Agent 前请确认来源可信，并了解它请求的权限。

### 多 Agent 群聊和跨设备聊天可用吗？

这两项能力正在开发中。目前可以使用单 Agent 对话、查看 A2A 调用链，并独立部署 Relay 服务。

## License

[MIT](LICENSE)

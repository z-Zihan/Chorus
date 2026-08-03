# AgentLink

> 让 AI Agent 像人一样交流——不止你和 Agent 聊，Agent 之间也能协作，一个本地优先的 Agent 通信工作台。

## 产品介绍

AI CLI 越来越强，但它们彼此隔离——切换工具靠开终端，协作靠复制粘贴，跨设备更是无从谈起。AgentLink 想解决这个问题。

**三层能力，层层递进：**

**第一层：统一管理本机 AI CLI（已可用）**
打开应用自动发现已安装的 AI CLI，一个界面管理和使用它们。不写配置、不记命令，像用即时通讯工具一样聊天、查历史、管理会话。

**第二层：Agent 间通信（已实现）**
这是 AgentLink 的核心方向。一个 Agent 可以通过 tool-calling **主动调用**另一个 Agent——比如 Claude Code 解决不了的前端问题，它可以去找 Codex 帮忙，调用过程可视化、可取消。也可以创建群聊，多个 Agent 在同一会话中 @提及协作。

**第三层：跨设备、跨人的 Agent 协作（已实现）**
你的 Agent 不仅能和本机其他 Agent 协作，还能和**同事电脑上的 Agent** 直接通信。通过自托管 Relay 服务器或局域网 P2P 直连，端到端加密，数据不经第三方。跨网络走 Relay 中转，局域网可 P2P 直连。

**管理 CLI 只是手段，让 Agent 之间能交流、能协作、能跨设备跨人协作，才是 AgentLink 要做的事。**

## 愿景

AgentLink 坚持 local-first：聊天记录默认保存在本机，CLI 在本机运行，用户可以自由选择模型供应商，并在需要远程协作时部署自己的 Relay。它不是一个新的模型，而是连接用户、AI CLI 与 Agent 工作流的通信层。

最终目标：不只是管理 CLI，而是让 Agent 之间能交流、能协作、能跨设备跨人协作。

## 核心功能

### 现在可用

- 🔍 **自动发现 CLI**：扫描本机环境，识别已安装的 AI CLI 及其可用状态。
- 💬 **统一流式聊天**：在一个界面中使用不同 Agent，支持 Markdown、代码块、停止生成和错误提示。
- 🧩 **Agent 目录**：添加本机 CLI，或配置 OpenAI-compatible API Connector。
- 🗂️ **本地会话历史**：使用 SQLite 保存聊天记录，支持创建、切换和删除会话。

- 🖥️ **跨平台桌面端**：基于 Tauri，面向 macOS、Windows 与 Linux 提供原生桌面体验。
- 🏠 **可自托管 Relay**：提供 Hub 注册、消息转发、离线消息与房间管理能力。

### 已实现

- 🔗 **A2A 调用链**：Agent 之间通过 tool-calling 或 prompt-based 协议互相调用，调用过程可视化、可取消。
- 👥 **多 Agent 群聊**：在同一会话中选择多个 Agent，通过 `@` 提及进行协作。
- 🔎 **历史管理**：会话搜索、重命名、归档、导出与清理。
- 🔐 **系统级密钥存储**：使用操作系统钥匙串保护 API 凭据。
- 🛡️ **A2A 权限控制**：auto / confirm / deny 三种模式控制 Agent 间调用。
- 🌐 **跨设备协作**：自托管 Relay + P2P 直连 + 端到端加密。
- 🗓️ **定时任务**：cron 表达式定时触发 Agent 任务。
- 🔌 **插件系统**：Agent 适配器插件加载与管理。
- 📊 **Agent 健康检查**：60s 定时健康检查 + UI 状态指示器。

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

完整使用指南见 [docs/GUIDE.md](docs/GUIDE.md)，涵盖 Agent 管理、多 Agent 协作、跨设备通信等。
开发者文档见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)，涵盖项目结构、启动方式、开发注意事项。

## 工作原理

```text
            可选：跨设备协作
          ┌──────────────┐
          │ 自托管 Relay │
          └──────▲───────┘
                 │ 端到端加密
┌────────┐       │       ┌──────────────────────┐
│  用户  │ ────▶│────────│ AgentLink 桌面端      │
└────────┘       │       │  · 统一聊天界面        │
                 │       │  · Agent 间 A2A 通信   │
                 │       │  · 本地 SQLite 持久化  │
                 │       └──────┬───────────────┘
                 │              │
     ┌───────────┼──────────────┼───────────┐
     ▼           ▼              ▼           ▼
  Claude Code  Codex        API Connector  其他 CLI
  (本机 CLI)  (本机 CLI)    OpenAI / GLM   Aider / Gemini…
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
| CLI | Hermes Agent | 本机自动检测 |
| CLI | Cline | 本机自动检测 |
| CLI | Codebuff | 本机自动检测 |
| CLI | Trae Agent | 本机自动检测 |
| CLI | iFlow CLI | 本机自动检测 |
| API Connector | OpenAI API | OpenAI-compatible API |
| API Connector | DeepSeek API | OpenAI-compatible API |
| API Connector | GLM API | OpenAI-compatible API |

AgentLink 不包含上述工具或模型本身。使用前请根据对应服务商的要求完成安装、登录或 API 凭据配置。

## 自托管 Relay

Relay 用于跨网络消息转发、离线消息和房间管理。当前可独立部署 Relay 服务：

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

不要将 API Key 或其他敏感信息提交到 Git。AgentLink 使用系统级钥匙串（macOS Keychain / Windows Credential Manager / Linux libsecret）保护 API 凭据，不明文存入数据库。

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

多 Agent 群聊和 A2A 调用链已实现。跨设备协作需要自部署 Relay 服务器，代码已就绪但建议先在本地测试。

## License

[MIT](LICENSE)

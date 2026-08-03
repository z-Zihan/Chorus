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
3. 输入消息 → 所有在线 Agent 都会收到

### @提及路由
- `@codex 帮我 review` → 只有 Codex 回复
- 不 @ → 第一个在线 Agent 回复（不广播，避免成本失控）
- 选择 **"All"** → 显式广播给所有在线 Agent

### Agent 间 A2A 调用
- **API Agent（OpenAI 等）**：通过 tool-calling 自动调用其他 Agent
- **CLI Agent（Claude Code 等）**：通过 prompt-based 协议，Agent 输出 `[A2A_CALL: target: message]` 发起调用
- 调用过程实时可视化，可随时取消

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

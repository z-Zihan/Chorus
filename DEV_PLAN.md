# AgentLink — 开发状态

> 最后更新：2026-08-03

## 已完成

### 核心功能
- **CLI 自动检测**：14 个 AI CLI（Claude Code、Codex、Copilot、Gemini CLI、Aider、Qwen Code、Cursor CLI、Kilo CLI、OpenCode、Hermes Agent、Cline、Codebuff、Trae Agent、iFlow CLI）
- **Agent Catalog**：17 个条目（14 CLI + 3 API Connector），应用内安装与添加
- **零配置 Onboarding**：自动扫描 → 选择 Agent → 首条消息，TTFM 7s
- **单 Agent 聊天**：流式输出、Markdown 渲染、代码块复制、消息持久化
- **多 Agent 群聊**：@提及路由、群聊创建、成员管理、消息分组
- **A2A 协作**：OpenAI tool-calling + CLI prompt-based A2A（`[A2A_CALL: target: message]`）
- **会话管理**：重命名、归档、置顶、全文搜索（FTS5）、导出（Markdown/JSON）、批量删除
- **Agent 持久化**：重启恢复、启用/禁用/删除、历史快照保留

### 跨设备通信
- **Relay Server**：Hub 注册、消息路由、离线存储（TTL 7天）、房间管理、Docker 部署
- **Hub Client**：Ed25519 身份、E2E 加密（libsodium）、WSS 连接、心跳重连
- **P2P 发现**：mDNS 广播、WebSocket 直连、Ed25519 双向握手
- **混合模式**：P2P 优先 + Relay 兜底、30s 健康检查、延迟监控
- **跨 Hub 群聊**：Relay 房间 fan-out、远程 Agent 注册、跨设备 A2A

### 基础设施
- **i18n**：中英文双语，5 个命名空间，语言切换
- **暗色/亮色主题**：CSS 变量体系、teal 主题（Hallmark 去 AI 味）、系统跟随
- **日志系统**：前端 ring buffer + 后端 pino + 端内 LogViewer
- **埋点框架**：AnalyticsProvider 接口 + 7 个关键事件
- **安全存储**：macOS Keychain / Windows Credential Manager / Linux libsecret + AES-256-GCM 文件兜底
- **A2A 权限**：auto/confirm/deny 三模式 + 30s 超时
- **端内更新**：Tauri Updater + stable/beta 渠道
- **DB 迁移**：Drizzle Kit + 自动迁移
- **代码规范**：ESLint 9 + Prettier + husky + commitlint
- **插件系统**：manifest 验证 + 加载器 + 前端面板
- **MCP 协议**：JSON-RPC stdio client + MCPToolAdapter
- **多用户认证**：Bearer Token + WS token 验证
- **定时任务**：cron 表达式 + 前端管理面板
- **Agent 健康检查**：60s 定时 + UI 状态指示器
- **键盘快捷键**：Ctrl+K 搜索、Ctrl+N 新建、Ctrl+, 设置

### 桌面端
- **Tauri 2.x**：macOS DMG + Windows MSI/NSIS + Linux AppImage
- **系统托盘**：显示窗口/退出菜单 + 关闭最小化到托盘
- **Node.js sidecar**：用户无需安装 Node.js

### 测试
- 39 个测试通过（单元 + 集成）
- ESLint 0 errors
- 干净环境首启验证通过

## 未完成

| 项目 | 说明 | 优先级 |
|------|------|--------|
| 官方 Relay 实例 | 需要公网服务器部署 | P2 |
| 跨设备 E2E 测试 | 需要两台机器 + Relay 服务器 | P1 |
| Tauri 生产构建验证 | sidecar 打包后完整功能验证 | P1 |

## 已知限制

- CLI Agent 的 A2A 通过 prompt-based 协议，不如 OpenAI tool-calling 精准
- 跨设备通信代码已完成但未端到端实测
- 群聊加密为逐个加密（v1），大群性能待优化

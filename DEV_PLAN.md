# AgentLink — 开发状态

> 最后更新：2026-08-04

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
- **API 访问认证基础**：Bearer Token + WS token 验证（仅认证 API client，尚未建立 User 实体或 token scope）
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
| 多用户身份与 owner 迁移 | User/Hub/Agent 三层身份、现有 Agent owner 回填 | P0 |
| 远程 User/Agent 目录 | 签名 manifest、自动注册、撤销和过期 | P0 |
| 跨用户权限闭环 | 信任建立、远程默认 confirm、操作级审批和审计 | P0 |
| Owner-aware UI/API | 按用户分组、同名消歧、能力/状态查询 | P1 |
| 官方 Relay 实例 | 需要公网服务器部署 | P2 |
| 跨设备 E2E 测试 | 需要两台机器 + Relay 服务器 | P1 |
| Tauri 生产构建验证 | sidecar 打包后完整功能验证 | P1 |

## 已知限制

- CLI Agent 的 A2A 通过 prompt-based 协议，不如 OpenAI tool-calling 精准
- 跨设备通信代码已完成但未端到端实测
- 群聊加密为逐个加密（v1），大群性能待优化

## 下一里程碑：多用户身份与外部 Agent 协议 / Next Milestone

设计文档已在 2026-08-04 完成；以下均为待实现任务，不能因 Relay/Hub 基础代码存在而标记为完成。

### P0 — 身份、数据一致性与安全基线

| ID | 任务 | 交付物与验收 | 依赖 | 状态 | Review |
|----|------|--------------|------|------|--------|
| ID-01 | User schema + migration | Drizzle `users`；本机 User 初始化；现有 Agent 回填 `ownerId/ownerType`；升级/回滚测试 | — | ✅ done | ✅ code-review skill |
| ID-02 | User/Hub cryptographic binding | User key 存钥匙串；稳定 userId；UserHubBinding 双签名与指纹 UI | ID-01 | ✅ done | ✅ code-review skill |
| ID-03 | Agent owner model | Agent API 返回 owner；`system` CLI 仍关联本机 User；远程 config/credential 永不落库 | ID-01 | ✅ done | ✅ code-review skill |
| ID-04 | Conversation migration | `dm/group/cross_hub`；`channel→group`；成员保存 Owner/Agent/Hub 快照 | ID-01, ID-03 | ✅ done | ✅ code-review skill |
| PROTO-01 | HubPayload v2 | 新增 `fromUserId/fromUserName/toUserId`、from/to Agent；v1 兼容读；协议版本拒绝策略 | ID-02 | ✅ done | ✅ code-review skill |
| DISC-01 | Signed directory | request/announce/revoke；visibility 过滤；版本、TTL、签名和最小披露 | PROTO-01 | ✅ done | ✅ code-review skill |
| DISC-02 | Remote registration | 单事务 upsert remote User 后 Agent；确定性远程 ID；revoke/stale；重名测试 | DISC-01, ID-03 | ⏳ todo | — |
| SEC-01 | Trust store | 邀请/配对码、User/Hub 指纹、pending/trusted/blocked、公钥变化重配对 | ID-02 | ⏳ todo | — |
| SEC-02 | Inbound authorization | API scope → trust → visibility → Agent policy → conversation mode → action approval；own auto / trusted confirm / unknown deny | SEC-01, DISC-02 | ⏳ todo | — |
| SEC-03 | Offline delivery semantics | queued/delivered/accepted/denied/done；ack 后删除；TTL expired；幂等和顺序测试 | PROTO-01 | ⏳ todo | — |

### P1 — 产品闭环与外部接入

| ID | 任务 | 交付物与验收 | 依赖 |
|----|------|--------------|------|
| API-01 | Owner-aware discovery API | `/api/users`、按 owner/scope 查询 Agent、capabilities/status；分页与 stale 字段 | DISC-02 |
| API-02 | Scoped client tokens | token hash、clientId/userId、scope、expiry、撤销；WS 短期 ticket；默认 loopback | ID-01 |
| UI-01 | User-grouped directory | “我的 Agent”+远程 User 分组；`Owner / Agent` 消歧；本地/远程/离线/待确认状态 | API-01 |
| UI-02 | Cross-hub conversation | remote DM、`cross_hub` 群聊、Owner 身份、路由路径和离线状态展示 | ID-04, SEC-03, UI-01 |
| UI-03 | Privacy & permission settings | User/Agent 可见性、auto/confirm/deny、trust revoke、披露预览 | SEC-02 |
| EXT-01 | External Agent contract | 以 `skills/agentlink-platform/SKILL.md` 为契约补齐 discovery/send/stream/error API conformance tests | API-01, API-02 |
| TEST-01 | Two-device E2E matrix | 在线/离线、重名、重放、撤销、密钥变化、权限拒绝、Relay/P2P fallback | SEC-03, UI-02 |

### P2 — 规模化与互操作

| ID | 任务 | 交付物与验收 | 依赖 |
|----|------|--------------|------|
| SCALE-01 | Multi-device User | `user_hubs`、设备撤销、同一 User 多 Hub Agent 聚合 | P1 完成 |
| SCALE-02 | MLS group crypto | 替代逐成员加密，支持大群 rekey 和成员撤销 | TEST-01 |
| STD-01 | Standard adapters | 将 AgentLink identity/capability 映射到 Google A2A/MCP/ACP | EXT-01 |
| OPS-01 | Relay metadata hardening | retention、size padding 评估、滥用检测、自托管运维基线 | TEST-01 |

### 发布门槛 / Exit Criteria

- 迁移后所有 Agent 都有有效 owner，历史会话仍可读；同名 Agent 误路由为 0。
- 未信任 Hub 看不到私有目录，可信远程调用默认需要确认；撤销在 60 秒内生效。
- 外部 Agent 能按 Skill 完成本地发现、同步/流式发送、A2A 确认、远程投递和离线状态处理。
- 两台真实设备分别通过 Relay 与 P2P 完成 E2E 矩阵，失败不产生半注册 User/Agent 或重复执行。

**English summary:** P0 establishes identity and authorization, P1 delivers owner-aware UX/API and external-agent conformance, and P2 adds scale and standards interoperability.

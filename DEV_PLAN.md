# AgentLink — 开发计划 (DEV_PLAN)

> 版本: v1.1 | 日期: 2026-08-01 | 基于 PRD v1.1 + TECH v1.0

---

## 版本路线图

```
v0.1 (MVP) ✅ 已完成    v0.2 (多 Agent + A2A)       v0.3 (群聊 + 搜索 + 生态)
  ──────────             🔲  待开发                   🔲  待开发
  · 单 Agent 流式聊天      · 多 Agent 在线切换         · Agent 适配器完善
  · OpenAI/CLI 适配器     · @提及 + tool-calling A2A  · 群聊会话
  · A2A 调用链可视化       · 私聊主场模式              · 消息全文搜索
  · SQLite 持久化         · Agent 加好友              · 插件系统基础
  · Tauri 桌面客户端打包   · 共享上下文传递            · MCP 协议基础
  · Markdown 渲染         · 定时任务编排              · 多用户认证
  · 系统托盘 + DMG/MSI    · OpenClaw/Dify 适配器     · LangChain/CLI 适配器
```

---

## 一、v0.1 收尾 ✅ 已完成 (2026-08-01)

> 全部 18 个任务完成，17 个测试通过，macOS DMG 构建验证通过。

| ID | 标题 | 状态 | 备注 |
|:---|------|:---:|------|
| **0.1** | **稳定性 & 错误处理** | | |
| P1-01 | React Error Boundary | ✅ | ErrorBoundary 组件包裹 Sidebar + ChatArea |
| P1-02 | WebSocket 心跳 & 断线重连 | ✅ | 30s ping/pong + 指数退避重连 + lastEventId 补发 |
| P1-03 | API 请求错误统一处理 | ✅ | Toast 通知系统 + 离线 banner + 5s 去重 |
| P1-04 | Agent 离线/超时优雅降级 | ✅ | 发送前状态检查 + 60s 流式超时 + AbortController |
| **0.2** | **UI 细节打磨** | | |
| P1-05 | 空状态 & 加载骨架屏 | ✅ | 骨架屏 + 空状态引导 + 创建会话按钮 |
| P1-06 | 长消息折叠 & 滚动锚定 | ✅ | 2000 字折叠 + 底部锚定 + 新消息按钮 |
| P1-07 | Markdown 增强 | ✅ | CodeBlock 语言标签 + 复制按钮 + 外链新窗口 |
| P1-08 | 删除会话确认 | ✅ | ConfirmDialog + hover 删除按钮 + 自动切换 |
| P1-09 | 响应式布局微调 | ✅ | 移动端 overlay 侧栏 + 汉堡菜单 + 遮罩 |
| **0.3** | **Agent 配置 UI** | | |
| P1-10 | Agent 设置面板 | ✅ | 右侧滑出 drawer + 编辑 name/desc/model/systemPrompt |
| P1-11 | API Key 安全输入 | ✅ | PasswordInput + show/hide + 空值不覆盖 |
| **0.4** | **基础测试** | | |
| P1-12 | 共享类型单元测试 | ✅ | 7 tests: truncateHistory + parseMentions |
| P1-13 | API 路由集成测试 | ✅ | 7 tests: health + agents + conversations CRUD |
| P1-14 | Mock Adapter 行为测试 | ✅ | 3 tests: 流式输出 + cancel signal + A2A |
| **0.5** | **Tauri 桌面客户端打包** | | |
| P1-15 | Tauri 开发环境验证 | ✅ | beforeDevCommand + devUrl + sidecar 配置 |
| P1-16 | Tauri 生产构建 | ✅ | macOS DMG 构建通过 + bundle.resources 打包 server |
| P1-17 | 系统托盘实现 | ✅ | 显示窗口/退出菜单 + 左键显示 + 关闭到托盘 |
| P1-18 | 应用图标设计 | ✅ | SVG lettermark + PNG + ICO (Windows) |

### v0.1 额外完成项

- ✅ Toast 通知去重（5s 节流）
- ✅ 共享状态常量提取（`constants/agent.ts`）
- ✅ 消息加载竞态保护（`messagesRequestId`）
- ✅ 会话删除后自动切换相邻会话
- ✅ Windows 构建支持（MSI + NSIS + ICO 图标）
- ✅ GitHub Actions CI（push tag 自动构建 macOS + Windows）
- ✅ Windows 构建文档（`docs/WINDOWS_BUILD.md`）
- ✅ Cargo 国内镜像配置（rsproxy.cn）

---

## 二、v0.2 开发计划 (预估 3 周)

> 核心目标：多 Agent 在线 + @提及 + tool-calling A2A + 私聊主场模式。

### 2.1 多 Agent 基础设施

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| M1-01 | 多 Agent 注册 & 在线管理 | Registry 支持多 Agent 同时 online；启动时从 config 批量 init；Agent 状态推送至前端 | 2h | — | 🔴 P0 |
| M1-02 | Agent 列表 UI 升级 | Sidebar 顶部展示在线 Agent 列表（头像 + 状态灯 + 名称），支持点击切换当前活跃 Agent | 2h | M1-01 | 🔴 P0 |
| M1-03 | 会话多 Agent 绑定 | `conversation_agents` 表启用：创建会话时可指定多个 Agent 参与；`ChatArea` 顶部显示参与 Agent 头像列表 | 2h | M1-01 | 🔴 P0 |
| M1-04 | Agent 选择器组件 | 输入框左侧添加 `@` 按钮，弹出 Agent 列表搜索弹窗，支持键盘导航 + 回车选择 | 1.5h | M1-02 | 🔴 P0 |

### 2.2 @提及 & tool-calling A2A

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| M2-01 | @提及解析器升级 | `parseMentions` 支持 `@agent-name` + `@agent-id` 两种格式，返回结构化对象；前端输入框高亮 @提及 | 1.5h | — | 🔴 P0 |
| M2-02 | OpenAI Adapter tool-calling | `OpenAIAdapter.handleMessage` 注入 tools 定义（call_agent），解析 LLM 返回的 `tool_calls`，触发 A2A Bus 调用 | 3h | — | 🔴 P0 |
| M2-03 | A2A 事件流升级 | 新增 `tool_call_start` / `tool_call_result` / `tool_call_error` 事件类型；WebSocket 透传至前端 | 1.5h | M2-02 | 🔴 P0 |
| M2-04 | A2A 调用链实时 UI | `A2AThread` 组件支持实时流式更新（而非等全部完成后渲染）；tool_call_start → running 动画 → tool_call_result 更新 | 2h | M2-03 | 🔴 P0 |
| M2-05 | A2A 取消 & 超时处理 | 用户点击"取消"时级联 abort 所有子调用；单个 A2A 调用 60s 超时自动降级 | 1.5h | M2-03 | 🟡 P1 |

### 2.3 私聊主场模式

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| M3-01 | 会话模型扩展 (dm/group) | `conversations` 表 type 字段生效：dm 为用户-Agent 私聊，group 为群聊；API 区分 dm/group 列表 | 1.5h | — | 🔴 P0 |
| M3-02 | 私聊主场布局 | Sidebar 分两个区域：**私聊**（我的 Agent）置顶 + **群聊**折叠在下；用户始终先看到私聊 | 2h | M3-01 | 🔴 P0 |
| M3-03 | 任务追踪卡片组件 | 私聊中嵌入可折叠卡片（`TaskTrackingCard`），展示群聊 A2A 任务进度、状态、耗时；支持点击跳转群聊原文 | 2.5h | M2-04, M3-02 | 🟡 P1 |
| M3-04 | Agent 代你出击流程 | 用户说"去找谁/去群里" → Agent 识别意图 → 发起 A2A 到目标 Agent → 结果以卡片回传私聊 | 2h | M2-02, M3-03 | 🟡 P1 |

### 2.4 Agent 适配器

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| M4-01 | 裸 LLM API 适配器 | `BaseAdapter` 子类，支持 OpenAI-compatible 以外的任意 HTTP API（自定义 endpoint + headers + body 模板） | 2h | — | 🟡 P1 |
| M4-02 | CLI 子进程适配器 | 通过 `child_process.spawn` 调用本地 CLI 工具作为 Agent，stdin/stdout JSON 协议通信 | 2h | — | 🟡 P1 |
| M4-03 | OpenClaw 适配器 | 对接 OpenClaw API，支持 workspace 上下文传入 | 2h | — | 🟢 P2 |
| M4-04 | Dify 适配器 | 对接 Dify 工作流 API，支持 conversation_id 传递 + 流式输出 | 2h | — | 🟢 P2 |

### 2.5 Agent 协作

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| M5-01 | Agent 加好友 | 两个 Agent 建立好友关系（需用户确认），好友间可通过私有上下文通道持续协作 | 2h | M1-01 | 🟡 P1 |
| M5-02 | 共享上下文传递 | Agent 调用其他 Agent 时自动携带上游摘要（对话历史压缩 + 任务描述），避免上下文膨胀 | 2h | M2-02 | 🟡 P1 |
| M5-03 | 定时任务编排 | Scheduler 模块：支持 cron 表达式定时触发 Agent 任务；任务结果推送至私聊 | 3h | M1-01 | 🟢 P2 |

---

## 三、v0.3 开发计划 (预估 3 周)

> 核心目标：Agent 适配器完善 + 群聊 + 消息搜索 + 生态基础。

### 3.1 Agent 适配器完善

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| A1-01 | LangChain 适配器 | 通过 `@langchain/core` 的 Runnable 接口封装，支持 LCEL chain/agent 作为 AgentLink Agent | 2.5h | — | 🟡 P1 |
| A1-02 | 适配器热加载 | Agent 配置文件变更后自动重载适配器，无需重启 Server | 1.5h | — | 🟡 P1 |
| A1-03 | 适配器健康检查 | 每个适配器暴露 `healthCheck(): Promise<boolean>`，Server 定时轮询并更新状态 | 1h | — | 🟡 P1 |
| A1-04 | 适配器日志 & 指标 | 每个适配器记录调用次数、平均延迟、错误率；Agent 详情页展示指标面板 | 2h | A1-03 | 🟢 P2 |

### 3.2 群聊

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| A2-01 | 群聊创建 & 成员管理 | REST API: `POST /api/conversations` 支持 `type: group` + `participants`；群聊详情页展示成员列表 | 2h | M3-01 | 🔴 P0 |
| A2-02 | 群聊 UI | 群聊消息展示发送者头像 + 名称；@提及高亮；消息路由（@特定 Agent / 广播所有 Agent） | 2.5h | A2-01 | 🔴 P0 |
| A2-03 | 群聊消息路由策略 | @agentA → 仅路由给 agentA；无 @ → 路由给群内所有在线 Agent（各自独立回复）；用户消息广播给所有群成员 | 2h | M2-01, A2-01 | 🔴 P0 |

### 3.3 消息搜索

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| A3-01 | SQLite FTS 全文索引 | 为 messages.content 建立 FTS5 虚拟表；消息写入时同步更新 FTS 索引 | 1.5h | — | 🔴 P0 |
| A3-02 | 搜索 API | `GET /api/messages/search?q=xxx&conversation_id=xxx`，返回匹配消息 + 前后上下文片段 | 1.5h | A3-01 | 🔴 P0 |
| A3-03 | 搜索 UI | 顶部搜索栏（Ctrl+K 唤起），输入关键词实时搜索，结果按会话分组展示，点击跳转到对应消息位置 | 2.5h | A3-02 | 🔴 P0 |

### 3.4 生态基础

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 |
|:---|------|------|:---:|------|:---:|
| A4-01 | 插件系统基础 | 定义插件 manifest 格式（`plugin.json`），插件发现 & 加载生命周期；首个插件类型：Agent 适配器插件 | 3h | — | 🟡 P1 |
| A4-02 | MCP 协议基础支持 | 实现 MCP Client，通过 `StdioClientTransport` 连接本地 MCP Server，将 MCP tools 映射为 Agent tools | 3h | — | 🟢 P2 |
| A4-03 | 多用户认证 | Bearer Token 鉴权中间件；`agentlink.config.ts` 中配置 tokens 映射；WebSocket 连接携带 token | 2h | — | 🟢 P2 |

---

## 四、依赖关系图

```
v0.1 收尾 ✅
─────────────────────────────────────────────────
P1-01~P1-18 全部完成

v0.2 多 Agent + A2A
─────────────────────────────────────────────────
M1-01 ──→ M1-02 ──→ M1-04
   └──→ M1-03
   └──→ M5-01  M5-03

M2-01 ──→ M2-02 ──→ M2-03 ──→ M2-04
                         └──→ M2-05
                         └──→ M5-02

M3-01 ──→ M3-02 ──→ M3-03 ──→ M3-04

M4-01  M4-02  M4-03  M4-04  (独立)

v0.3 群聊 + 搜索 + 生态
─────────────────────────────────────────────────
A1-01  A1-02  A1-03 ──→ A1-04  (独立/依赖 A1-03)

A2-01 ──→ A2-02 ──→ A2-03

A3-01 ──→ A3-02 ──→ A3-03

A4-01  A4-02  A4-03  (独立)
```

---

## 五、任务统计

| 版本 | 任务数 | 预估总工时 | P0 | P1 | P2 | 状态 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| v0.1 收尾 | 18 | 28.5h | 5 | 8 | 5 | ✅ 已完成 |
| v0.2 开发 | 17 | 35.5h | 9 | 6 | 2 | 🔲 待开发 |
| v0.3 开发 | 13 | 27.5h | 6 | 5 | 2 | 🔲 待开发 |
| **合计** | **48** | **91.5h** | **20** | **19** | **9** | |

> v0.1 实际耗时约 4 小时（使用 Codex + Claude Code 辅助编码）。
> v0.2 + v0.3 预估约 63h，按每天有效工作 5h 计算约 13 个工作日（~3 周）。

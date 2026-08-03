# AgentLink — 开发计划 (DEV_PLAN)

> 版本: v2.0 | 日期: 2026-08-01 | 基于 PRD v2.0 + TECH v1.2
>
> 产品决策：版本号曾出现 `v1.1 基建` 排在 `v0.2` 前的倒挂。为避免现有任务 ID 失效，下文暂保留旧工作流名称；对外发布按 v0.2 → v0.3 → v0.4 → v1.0 排序。

---

## 版本路线图

```text
v0.1 开发者预览 ✅
  ↓
零、产品缺口修复 🔴 发布门槛
  · P0 CLI 自动检测
  · P0 零配置首启 + Onboarding + 首条消息
  · P1 Agent Catalog / 端内安装 + 历史管理
  ↓
v0.2 CLI 驾驶舱 → v0.3 管理与本地群聊 → v0.4 A2A 协作 → v1.0 跨设备

基建工作按需并入各产品版本，不再作为自动检测之前的独立阻断阶段。
```

---

## 零、产品缺口修复（先于 v1.1，预估 51h）

> 目标：把“服务能启动”变成“新用户无需编辑配置即可发出首条消息”。<br>
> **G0 CLI 自动检测是全项目第一 P0。G0/G1/G3 未完成前，不得用主题、动画、新协议或更多 Adapter 替代发布门槛。**

### 0.1 CLI 自动检测（第一 P0，11h）

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| G0-01 | CLI Descriptor 清单 | 为 Claude Code、Codex、Copilot CLI 定义命令别名、平台、最低版本、安全探测参数和 Adapter 模板 | 1.5h | — | 🔴 P0 | ✅ |
| G0-02 | 跨平台可执行文件解析 | 扫描进程 PATH、GUI 登录 shell PATH、常见安装目录；处理 Windows PATHEXT/别名；去重并解析真实路径 | 3h | G0-01 | 🔴 P0 | ✅ |
| G0-03 | 安全版本/能力探测 | 只执行 Descriptor 白名单中的 `--version` 等无副作用命令；2s 超时；输出 `ready/needs_auth/unsupported/error` | 2h | G0-02 | 🔴 P0 | ✅ |
| G0-04 | Detection Service + API | `GET /api/cli/detections`、`POST /api/cli/detections/scan`；缓存结果、进度事件、手动重扫 | 2h | G0-03 | 🔴 P0 | ✅ |
| G0-05 | 检测结果 UI | 显示名称、版本、路径、状态和唯一主行动；支持忽略、重扫、自选路径 | 1.5h | G0-04 | 🔴 P0 | ✅ |
| G0-06 | 检测契约测试 | macOS/Windows/Linux fixture；覆盖 PATH 缺失、重复安装、超时、无权限和版本不兼容 | 1h | G0-04 | 🔴 P0 | ✅ |

**验收：** 受支持 CLI 检测召回率 ≥ 95%、准确率 ≥ 99%、冷启扫描 p95 ≤ 3s；终端可运行但 GUI PATH 缺失时也有恢复方案。

### 0.2 零配置启动（9h）

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| G1-01 | 应用数据目录 | 无 `agentlink.config.ts` 时使用 Tauri/OS app-data 存储 DB、缓存和日志；不依赖 CWD | 2h | — | 🔴 P0 | ✅ |
| G1-02 | Registry 持久恢复 | 启动时合并显式配置、DB 中用户确认项和新检测候选；UI 添加项重启不丢失 | 2.5h | G1-01, G0-04 | 🔴 P0 | ✅ |
| G1-03 | 配置优先级与来源 | Agent 记录增加 `source/managed/customized`；显式配置 > UI 确认 > 新检测 > Catalog 默认 | 1.5h | G1-02 | 🔴 P0 | ✅ |
| G1-04 | 首个有效会话 | 只在存在 ready Agent 时创建默认会话；无 Agent 时禁止创建死路会话 | 1h | G1-02 | 🔴 P0 | ✅ |
| G1-05 | 旧配置无损迁移 | 现有 `agentlink.config.ts` 继续可用；首次导入、冲突提示和回滚有测试 | 2h | G1-03 | 🔴 P0 | ✅ |

### 0.3 Agent Catalog 与端内安装（16h）

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| G2-01 | 本地 Catalog Schema | 内置版本化 JSON：发布者、来源、平台、版本、权限、安装/卸载方式、Adapter 模板 | 2h | G0-01 | 🟡 P1 | ✅ |
| G2-02 | Catalog API | 列表、详情、兼容性、已安装状态；不直接信任远程命令 | 2h | G2-01 | 🟡 P1 | ✅ |
| G2-03 | 安装执行器 | 展示确切命令后二次确认；进度、超时、完整性校验、健康检查、取消和回滚 | 5h | G2-02 | 🔴 P0 | 🟡 |
| G2-04 | Agent 目录 UI | 浏览/搜索/筛选；区分“添加已安装 CLI”“安装 CLI”“配置 API Connector” | 3h | G2-02 | 🟡 P1 | ✅ |
| G2-05 | 安装生命周期 | 安装后注册、建会话；禁用/启用/卸载；保留历史身份快照 | 4h | G1-02, G2-03 | 🟡 P1 | ✅ |

### 0.4 零配置 Onboarding（7h）

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| G3-01 | 首启状态机 | `scanning → ready / needs_auth / none_found / error → completed`；可中断并恢复 | 2h | G0-04, G1-02 | 🔴 P0 | ✅ |
| G3-02 | 首启界面 | 逐步显示检测结果；每个状态只有一个主行动；不询问端口/DB/输出格式 | 2.5h | G3-01 | 🔴 P0 | ✅ |
| G3-03 | 登录与错误恢复 | 工具特定登录指引、打开终端、完成后重扫；把 ENOENT/权限/版本错误翻译成用户语言 | 2.5h | G3-02 | 🔴 P0 | ✅ |

**验收：** TTFM p50 ≤ 60s、p90 ≤ 180s；零配置激活率 ≥ 80%；无 CLI 和未登录都不能出现死路空状态。

### 0.5 会话历史管理（8h）

> 当前已有创建、查看和删除；本节不重复造轮子，只补齐长期使用的管理闭环。

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| G4-01 | 重命名/归档/固定 | 会话列表完整管理操作，保留删除确认 | 2h | — | 🟡 P1 | ✅ |
| G4-02 | 全文搜索与筛选 | SQLite FTS5；按 Agent、项目、日期筛选；跳转命中消息 | 4h | — | 🟡 P1 | ✅ |
| G4-03 | 导出与清理 | Markdown/JSON 导出；批量删除显示范围与不可逆警告 | 2h | G4-01 | 🟡 P1 | ✅ |

### 产品门槛与顺序

1. G0 → G1 → G3 是 v0.2 发布主链路。
2. G2 可在 G0-01/G1-02 后并行，但不得延误首条消息闭环。
3. G4 和本地群聊进入 v0.3，优先于跨 Hub 扩展。
4. 每个任务必须同时提供正常路径、空状态、错误恢复和产品埋点；“API 已完成”不等于任务完成。

---

## 一、v0.1 收尾 ✅ 已完成 (2026-08-01)

> 全部 18 个任务完成，17 个测试通过，macOS DMG 构建验证通过。

| ID | 标题 | 状态 | 备注 |
|:---|------|:---:|------|
| **0.1** | **稳定性 & 错误处理** | | |
| P1-01 | React Error Boundary | ✅ | ErrorBoundary 组件包裹 Sidebar + ChatArea | ✅ |
| P1-02 | WebSocket 心跳 & 断线重连 | ✅ | 30s ping/pong + 指数退避重连 + lastEventId 补发 | ✅ |
| P1-03 | API 请求错误统一处理 | ✅ | Toast 通知系统 + 离线 banner + 5s 去重 | ✅ |
| P1-04 | Agent 离线/超时优雅降级 | ✅ | 发送前状态检查 + 60s 流式超时 + AbortController | ✅ |
| **0.2** | **UI 细节打磨** | | |
| P1-05 | 空状态 & 加载骨架屏 | ✅ | 骨架屏 + 空状态引导 + 创建会话按钮 | ✅ |
| P1-06 | 长消息折叠 & 滚动锚定 | ✅ | 2000 字折叠 + 底部锚定 + 新消息按钮 | ✅ |
| P1-07 | Markdown 增强 | ✅ | CodeBlock 语言标签 + 复制按钮 + 外链新窗口 | ✅ |
| P1-08 | 删除会话确认 | ✅ | ConfirmDialog + hover 删除按钮 + 自动切换 | ✅ |
| P1-09 | 响应式布局微调 | ✅ | 移动端 overlay 侧栏 + 汉堡菜单 + 遮罩 | ✅ |
| **0.3** | **Agent 配置 UI** | | |
| P1-10 | Agent 设置面板 | ✅ | 右侧滑出 drawer + 编辑 name/desc/model/systemPrompt | ✅ |
| P1-11 | API Key 安全输入 | ✅ | PasswordInput + show/hide + 空值不覆盖 | ✅ |
| **0.4** | **基础测试** | | |
| P1-12 | 共享类型单元测试 | ✅ | 7 tests: truncateHistory + parseMentions | ✅ |
| P1-13 | API 路由集成测试 | ✅ | 7 tests: health + agents + conversations CRUD | ✅ |
| P1-14 | Mock Adapter 行为测试 | ✅ | 3 tests: 流式输出 + cancel signal + A2A | ✅ |
| **0.5** | **Tauri 桌面客户端打包** | | |
| P1-15 | Tauri 开发环境验证 | ✅ | beforeDevCommand + devUrl + sidecar 配置 | ✅ |
| P1-16 | Tauri 生产构建 | ✅ | macOS DMG 构建通过 + bundle.resources 打包 server | ✅ |
| P1-17 | 系统托盘实现 | ✅ | 显示窗口/退出菜单 + 左键显示 + 关闭到托盘 | ✅ |
| P1-18 | 应用图标设计 | ✅ | SVG lettermark + PNG + ICO (Windows) | ✅ |

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

## 二、v1.1 基础设施 (预估 1.5 周)

> 定位调整：这是基建工作流，不再是 v0.2 之前的整体门槛。只优先实施直接支撑 G0/G1/G3 的配置、日志、数据迁移、a11y 和更新安全项；主题、动画、库替换等不阻塞零配置发布。
> 原则：每一项基建必须指向明确的用户结果，不为“技术完整”单独排期。

### 2.0 多语言适配 (i18n)

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| I0-01 | i18n 框架搭建 | 安装 `react-i18next` + `i18next`；创建 `packages/web/src/locales/` 目录；初始化 i18next 实例 + Suspense loader；语言检测（浏览器/Tauri 系统语言） | 1.5h | — | 🔴 P0 | ✅ |
| I0-02 | 中英文翻译文件 | 创建 `zh-CN/` 和 `en/` 两个语言包目录；按模块分块：`common.json`、`sidebar.json`、`chat.json`、`settings.json`、`errors.json`；提取所有现有硬编码中文到翻译 key | 2h | I0-01 | 🔴 P0 | ✅ |
| I0-03 | useTranslation 接入 | 全局替换硬编码文案为 `t('key')`；`Trans` 组件处理带变量的文案；后端错误消息也走 i18n（错误 code → 前端翻译） | 2h | I0-02 | 🔴 P0 | ✅ |
| I0-04 | 语言切换 UI | Settings 面板加语言选择器；持久化到 localStorage；Tauri 端跟随系统语言（可覆盖） | 1h | I0-03 | 🟡 P1 | ✅ |
| I0-05 | i18n 开发规范 | 文档：新增文案必须走 i18n key，PR review 检查；ESLint 规则：禁止 JSX 中直接写中文文案（`react/jsx-no-literals`） | 0.5h | I0-03 | 🟡 P1 | 🟡 |

### 2.1 暗色模式 / 主题系统

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| I1-01 | 主题架构 | 定义 CSS 变量体系（`--color-bg-primary` 等）；创建 `packages/web/src/styles/themes.css` 包含 `:root` (dark) 和 `:root[data-theme="light"]` 两套变量；Tailwind 配置 `darkMode: 'class'` | 1.5h | — | 🔴 P0 | ✅ |
| I1-02 | 现有组件适配暗色 | 全局替换硬编码颜色值（`bg-gray-900` → `bg-[var(--color-bg-primary)]` 或 Tailwind dark: variant）；确保所有组件在暗色/亮色下都正确渲染 | 2h | I1-01 | 🔴 P0 | ✅ |
| I1-03 | 主题切换 UI | Settings 面板加主题选择（暗色/亮色/跟随系统）；持久化到 localStorage；监听系统 `prefers-color-scheme` 变化 | 1h | I1-02 | 🟡 P1 | ✅ |
| I1-04 | Tauri 系统主题同步 | macOS 跟随系统外观变化时自动切换；`window.__TAURI__` 获取系统主题 | 0.5h | I1-03 | 🟢 P2 | 🟡 |

### 2.2 UI 库 + 第三方库整合

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| I2-01 | UI 库选型与集成 | 评估 Radix UI / shadcn/ui（headless + Tailwind 友好）；集成基础组件：Button、Input、Dialog、Dropdown、Tooltip、Toast（替换现有手写组件） | 2.5h | — | 🟡 P1 | ✅ |
| I2-02 | 图标库 | 安装 `lucide-react`（SVG 图标，tree-shakeable）；替换现有内联 SVG | 1h | — | 🟡 P1 | ✅ |
| I2-03 | 工具库整合 | `clsx` + `tailwind-merge` → `cn()` 工具函数；`date-fns` 替换 `toLocaleString`；`lodash-es` 按需引入 | 1h | — | 🟡 P1 | ✅ |
| I2-04 | 动画库 | 评估 `framer-motion` 用于过渡动画（drawer 滑入、消息进入、主题切换）；或用 Tailwind `transition` + CSS keyframes 轻量实现 | 1h | — | 🟢 P2 | 🟡 |

### 2.3 日志系统

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| I3-01 | 前端日志模块 | 创建 `packages/web/src/utils/logger.ts`；多级别（debug/info/warn/error）；开发环境 console 输出 + 生产环境内存环形缓冲（最近 500 条）；API 可拉取日志 | 1.5h | — | 🔴 P0 | ✅ |
| I3-02 | 后端结构化日志 | Server 端用 `pino`（Fastify 内置）结构化 JSON 日志；日志级别可配置；日志文件轮转写入 `data/logs/` | 1.5h | — | 🔴 P0 | ✅ |
| I3-03 | 端内日志查看 | 设置面板加"查看日志"按钮，展示最近日志（前端 + 后端）；支持按级别过滤、关键词搜索、导出为文件 | 2h | I3-01, I3-02 | 🟡 P1 | ✅ |
| I3-04 | Tauri 原生日志 | Rust 层用 `tracing` + `tracing-subscriber`；日志写入 `app_log_dir/agentlink.log`；与 Node.js sidecar 日志分离 | 1h | — | 🟡 P1 | 🟡 |

### 2.4 埋点框架

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| I4-01 | 埋点框架 | 创建 `packages/web/src/utils/analytics.ts` + `packages/server/src/analytics.ts`；定义事件接口（name/props/timestamp）；默认 no-op 实现；内存队列缓存 | 1.5h | — | 🟡 P1 | ✅ |
| I4-02 | 埋点接入点 | 关键事件：会话创建/删除、消息发送/接收、Agent 在线/离线、A2A 调用、错误发生、设置变更；在代码中预留 `track()` 调用点 | 1.5h | I4-01 | 🟡 P1 | ✅ |
| I4-03 | 第三方接入预留 | 预留 provider 接口（`AnalyticsProvider`）；后续可接入 Sentry、PostHog、Umami 等；配置文件选择 provider | 1h | I4-01 | 🟢 P2 | 🟡 |

### 2.5 多环境配置

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| I5-01 | 环境变量体系 | `.env`、`.env.local`、`.env.development`、`.env.production`；Vite `import.meta.env.VITE_*`；Server `process.env` + 配置文件覆盖优先级 | 1.5h | — | 🔴 P0 | ✅ |
| I5-02 | 环境检测工具 | `packages/shared/src/utils/env.ts`：`isDev`/`isProd`/`isTest`/`isTauri`；各环境默认值（端口、CORS、日志级别）；后端 `loadConfig()` 支持 env 覆盖 | 1h | I5-01 | 🔴 P0 | ✅ |
| I5-03 | .env.example | 完整的环境变量示例文件 + 文档说明每个变量的作用 | 0.5h | I5-01 | 🟡 P1 | ✅ |

### 2.6 端内更新

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| I6-01 | Tauri Updater 插件 | 集成 `@tauri-apps/plugin-updater`；配置 `tauri.conf.json` updater endpoint；签名密钥生成与保管说明 | 2h | — | 🟡 P1 | ✅ |
| I6-02 | 更新检查 UI | 启动时检查更新 → 有更新时显示横幅"新版本可用"；设置面板手动检查更新；下载进度条；安装重启 | 2h | I6-01 | 🟡 P1 | ✅ |
| I6-03 | 灰度发布机制 | 更新 endpoint 支持 `channel` 参数（stable/beta）；按用户 ID hash 分组灰度；`tauri.conf.json` 配置 channel | 2h | I6-01 | 🟢 P2 | 🟡 |
| I6-04 | CI 自动发布 | GitHub Actions：tag push → 构建 macOS + Windows → 生成签名 → 上传到 release endpoint；更新 manifest JSON | 2h | I6-01 | 🟡 P1 | 🟡 |

### 2.7 代码规范

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| I7-01 | ESLint + Prettier | 安装 ESLint 9 (flat config) + Prettier；`@typescript-eslint` + `eslint-plugin-react` + `eslint-plugin-react-hooks`；Prettier 配置统一格式 | 1.5h | — | 🔴 P0 | ✅ |
| I7-02 | husky + lint-staged | git pre-commit hook：lint + typecheck；`lint-staged` 只检查暂存文件；commit message 规范（commitlint + conventional commits） | 1h | I7-01 | 🟡 P1 | ✅ |
| I7-03 | CI 检查 | GitHub Actions PR 检查：lint + typecheck + test；阻止不合规 PR 合入 | 0.5h | I7-01 | 🟡 P1 | ✅ |

### 2.8 数据库迁移

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| I8-01 | Drizzle 迁移体系 | 安装 `drizzle-kit`；初始化 `drizzle.config.ts`；将现有 `CREATE TABLE IF NOT EXISTS` 迁移为正式 migration 文件；`pnpm db:migrate` 脚本 | 1.5h | — | 🔴 P0 | ✅ |
| I8-02 | 迁移脚本 | `pnpm db:generate`（生成迁移）+ `pnpm db:migrate`（执行）+ `pnpm db:studio`（Drizzle Studio 可视化）；启动时自动执行 pending 迁移 | 1h | I8-01 | 🟡 P1 | ✅ |

### 2.9 其他基建

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| I9-01 | 键盘快捷键系统 | `useHotkey` hook 全局快捷键注册；默认快捷键：`Ctrl+K`（搜索）、`Ctrl+N`（新建会话）、`Ctrl+,`（设置）、`Escape`（关闭面板）；快捷键设置面板 | 2h | — | 🟡 P1 | ✅ |
| I9-02 | 可访问性 (a11y) | 审查所有组件 aria 标签；焦点陷阱（Dialog/Drawer）；`Focus visible` 样式；键盘导航（Tab/Arrow）；屏幕阅读器测试 | 2h | — | 🟡 P1 | 🟡 |
| I9-03 | 错误监控预留 | 前端 `window.onerror` + `unhandledrejection` 捕获 → 调用 logger + analytics；预留 Sentry 接入点；后端 `process.on('uncaughtException')` | 1h | I3-01 | 🟡 P1 | ✅ |

---

## 三、v0.2 开发计划 (预估 3 周)

> 核心目标：多 Agent 在线 + @提及 + tool-calling A2A + 私聊主场模式。

### 3.1 多 Agent 基础设施

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| M1-01 | 多 Agent 注册 & 在线管理 | Registry 支持多 Agent 同时 online；启动时从 config 批量 init；Agent 状态推送至前端 | 2h | — | 🔴 P0 | ✅ |
| M1-02 | Agent 列表 UI 升级 | Sidebar 顶部展示在线 Agent 列表（头像 + 状态灯 + 名称），支持点击切换当前活跃 Agent | 2h | M1-01 | 🔴 P0 | ✅ |
| M1-03 | 会话多 Agent 绑定 | `conversation_agents` 表启用：创建会话时可指定多个 Agent 参与；`ChatArea` 顶部显示参与 Agent 头像列表 | 2h | M1-01 | 🔴 P0 | ✅ |
| M1-04 | Agent 选择器组件 | 输入框左侧添加 `@` 按钮，弹出 Agent 列表搜索弹窗，支持键盘导航 + 回车选择 | 1.5h | M1-02 | 🔴 P0 | ✅ |

### 3.2 @提及 & tool-calling A2A

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| M2-01 | @提及解析器升级 | `parseMentions` 支持 `@agent-name` + `@agent-id` 两种格式，返回结构化对象；前端输入框高亮 @提及 | 1.5h | — | 🔴 P0 | ✅ |
| M2-02 | OpenAI Adapter tool-calling | `OpenAIAdapter.handleMessage` 注入 tools 定义（call_agent），解析 LLM 返回的 `tool_calls`，触发 A2A Bus 调用 | 3h | — | 🔴 P0 | 🟡 |
| M2-03 | A2A 事件流升级 | 新增 `tool_call_start` / `tool_call_result` / `tool_call_error` 事件类型；WebSocket 透传至前端 | 1.5h | M2-02 | 🔴 P0 | ✅ |
| M2-04 | A2A 调用链实时 UI | `A2AThread` 组件支持实时流式更新（而非等全部完成后渲染）；tool_call_start → running 动画 → tool_call_result 更新 | 2h | M2-03 | 🔴 P0 | 🟡 |
| M2-05 | A2A 取消 & 超时处理 | 用户点击"取消"时级联 abort 所有子调用；单个 A2A 调用 60s 超时自动降级 | 1.5h | M2-03 | 🟡 P1 | ✅ |

### 3.3 私聊主场模式

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| M3-01 | 会话模型扩展 (dm/group) | `conversations` 表 type 字段生效：dm 为用户-Agent 私聊，group 为群聊；API 区分 dm/group 列表 | 1.5h | — | 🔴 P0 | ✅ |
| M3-02 | 私聊主场布局 | Sidebar 分两个区域：**私聊**（我的 Agent）置顶 + **群聊**折叠在下；用户始终先看到私聊 | 2h | M3-01 | 🔴 P0 | ✅ |
| M3-03 | 任务追踪卡片组件 | 私聊中嵌入可折叠卡片（`TaskTrackingCard`），展示群聊 A2A 任务进度、状态、耗时；支持点击跳转群聊原文 | 2.5h | M2-04, M3-02 | 🟡 P1 | 🟡 |
| M3-04 | Agent 代你出击流程 | 用户说"去找谁/去群里" → Agent 识别意图 → 发起 A2A 到目标 Agent → 结果以卡片回传私聊 | 2h | M2-02, M3-03 | 🟡 P1 | 🟡 |

### 3.4 Agent 适配器

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| M4-01 | 裸 LLM API 适配器 | `BaseAdapter` 子类，支持 OpenAI-compatible 以外的任意 HTTP API（自定义 endpoint + headers + body 模板） | 2h | — | 🟡 P1 | ✅ |
| M4-02 | CLI Adapter 兼容性矩阵 | 基于已实现的 `CliAdapter` 补齐 Claude/Codex/Copilot 结构化输出映射、退出码、stderr 诊断和版本兼容测试 | 2h | G0-01 | 🟡 P1 | 🟡 |
| M4-03 | OpenClaw 适配器 | 对接 OpenClaw API，支持 workspace 上下文传入 | 2h | — | 🟢 P2 | 🟡 |
| M4-04 | Dify 适配器 | 对接 Dify 工作流 API，支持 conversation_id 传递 + 流式输出 | 2h | — | 🟢 P2 | 🟡 |

### 3.5 Agent 协作

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| M5-01 | Agent 加好友 | 两个 Agent 建立好友关系（需用户确认），好友间可通过私有上下文通道持续协作 | 2h | M1-01 | 🟡 P1 | ✅ |
| M5-02 | 共享上下文传递 | Agent 调用其他 Agent 时自动携带上游摘要（对话历史压缩 + 任务描述），避免上下文膨胀 | 2h | M2-02 | 🟡 P1 | ✅ |
| M5-03 | 定时任务编排 | Scheduler 模块：支持 cron 表达式定时触发 Agent 任务；任务结果推送至私聊 | 3h | M1-01 | 🟢 P2 | ✅ |

---

## 四、v0.3 开发计划 (预估 3 周)

> 核心目标：Agent 适配器完善 + 群聊 + 消息搜索 + 生态基础。

### 4.1 Agent 适配器完善

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| A1-01 | LangChain 适配器 | 通过 `@langchain/core` 的 Runnable 接口封装，支持 LCEL chain/agent 作为 AgentLink Agent | 2.5h | — | 🟡 P1 | 🟡 |
| A1-02 | 适配器热加载 | Agent 配置文件变更后自动重载适配器，无需重启 Server | 1.5h | — | 🟡 P1 | ✅ |
| A1-03 | 适配器健康检查 | 每个适配器暴露 `healthCheck(): Promise<boolean>`，Server 定时轮询并更新状态 | 1h | — | 🟡 P1 | ✅ |
| A1-04 | 适配器日志 & 指标 | 每个适配器记录调用次数、平均延迟、错误率；Agent 详情页展示指标面板 | 2h | A1-03 | 🟢 P2 | ✅ |

### 4.2 群聊

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| A2-01 | 群聊创建 & 成员管理 | REST API: `POST /api/conversations` 支持 `type: group` + `participants`；群聊详情页展示成员列表 | 2h | M3-01 | 🔴 P0 | ✅ |
| A2-02 | 群聊 UI | 群聊消息展示发送者头像 + 名称；@提及高亮；消息路由（@特定 Agent / 广播所有 Agent） | 2.5h | A2-01 | 🔴 P0 | ✅ |
| A2-03 | 群聊消息路由策略 | @agentA → 仅路由给 agentA；无 @ → 路由给群内所有在线 Agent（各自独立回复）；用户消息广播给所有群成员 | 2h | M2-01, A2-01 | 🔴 P0 | ✅ |

### 4.3 消息搜索

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| A3-01 | SQLite FTS 全文索引 | 为 messages.content 建立 FTS5 虚拟表；消息写入时同步更新 FTS 索引 | 1.5h | — | 🔴 P0 | ✅ |
| A3-02 | 搜索 API | `GET /api/messages/search?q=xxx&conversation_id=xxx`，返回匹配消息 + 前后上下文片段 | 1.5h | A3-01 | 🔴 P0 | ✅ |
| A3-03 | 搜索 UI | 顶部搜索栏（Ctrl+K 唤起），输入关键词实时搜索，结果按会话分组展示，点击跳转到对应消息位置 | 2.5h | A3-02 | 🔴 P0 | ✅ |

### 4.4 生态基础

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| A4-01 | 插件系统基础 | 定义插件 manifest 格式（`plugin.json`），插件发现 & 加载生命周期；首个插件类型：Agent 适配器插件 | 3h | — | 🟡 P1 | 🟡 |
| A4-02 | MCP 协议基础支持 | 实现 MCP Client，通过 `StdioClientTransport` 连接本地 MCP Server，将 MCP tools 映射为 Agent tools | 3h | — | 🟢 P2 | 🟡 |
| A4-03 | 多用户认证 | Bearer Token 鉴权中间件；`agentlink.config.ts` 中配置 tokens 映射；WebSocket 连接携带 token | 2h | — | 🟢 P2 | ✅ |

---

## 五、依赖关系图

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

## 六、v1.0 跨用户通信 (预估 4-5 周)

> 核心目标：实现跨 Hub 通信，支持公网 Relay / 内网 P2P / 混合模式。
> 详细设计见 [docs/RELAY_DESIGN.md](docs/RELAY_DESIGN.md)

### 6.1 Relay Server MVP

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| R1-01 | Relay 包初始化 | 创建 `packages/relay/`，Fastify + WS + SQLite，健康检查 | 2h | — | 🔴 P0 | ✅ |
| R1-02 | Hub 注册与认证 | Ed25519 公钥注册 + JWT + WebSocket 认证 | 3h | R1-01 | 🔴 P0 | ✅ |
| R1-03 | 消息路由 | 按 Hub ID 路由，在线 WS 投递 | 2h | R1-02 | 🔴 P0 | ✅ |
| R1-04 | 离线消息存储 | SQLite offline_messages + TTL 7天 + 上线推送 | 2h | R1-03 | 🔴 P0 | ✅ |
| R1-05 | Presence 管理 | Hub 上下线广播 + 在线状态查询 | 1.5h | R1-02 | 🟡 P1 | ✅ |
| R1-06 | Docker 部署 | Dockerfile + docker-compose + 环境变量 | 1.5h | R1-04 | 🟡 P1 | ✅ |

### 6.2 Hub Client

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| R2-01 | 密钥对管理 | Ed25519 生成 + 存储 + 加载 | 1.5h | — | 🔴 P0 | ✅ |
| R2-02 | Relay 客户端 | WS 连接 + 认证 + 心跳 + 重连 | 3h | R2-01, R1-02 | 🔴 P0 | 🟡 |
| R2-03 | 消息加解密 | libsodium crypto_box + 签名/验证 | 2h | R2-01 | 🔴 P0 | ✅ |
| R2-04 | Hub 消息路由 | 接收跨 Hub 消息 → 路由到 Agent → 回复 | 3h | R2-02, R2-03 | 🔴 P0 | 🟡 |
| R2-05 | 跨 Hub 会话 UI | 连接状态 + Hub 联系人 + 添加好友 | 3h | R2-04 | 🟡 P1 | 🔴 |

### 6.3 P2P 发现

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| R3-01 | mDNS 广播与发现 | bonjour-service 发布 + 发现 + TXT | 2h | R2-01 | 🟡 P1 | 🔴 |
| R3-02 | P2P WebSocket 监听 | 独立端口 3212 接收直连 | 2h | R3-01 | 🟡 P1 | 🔴 |
| R3-03 | P2P 认证握手 | Ed25519 签名挑战 + 加密通道 | 2h | R3-02, R2-03 | 🟡 P1 | 🔴 |
| R3-04 | P2P 消息路由 | 直连通道收发，与 Relay 格式一致 | 1.5h | R3-03 | 🟡 P1 | 🔴 |

### 6.4 混合模式

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| R4-01 | 连接管理器 | P2P 优先 + Relay 兜底 + 路径选择 | 3h | R2-04, R3-04 | 🟡 P1 | 🔴 |
| R4-02 | 路径健康检查 | 30s ping + 延迟监控 + 自动降级 | 1.5h | R4-01 | 🟡 P1 | 🔴 |
| R4-03 | 连接状态 UI | 前端展示模式 (P2P/Relay/离线) + 延迟 | 1.5h | R4-01 | 🟢 P2 | 🔴 |

### 6.5 群聊

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| R5-01 | Relay 房间管理 | 创建/加入/离开/邀请 + 成员 + presence | 3h | R1-05 | 🔴 P0 | 🟡 |
| R5-02 | 群聊消息扇出 | `to: "room:xxx"` → fan-out 在线成员 | 2h | R5-01 | 🔴 P0 | 🟡 |
| R5-03 | 本地群聊会话 | Hub 端 group 类型会话 + conversation_agents | 2h | R5-01 | 🔴 P0 | ✅ |
| R5-04 | 群聊 UI | 群消息 + 成员列表 + 邀请 + @跨Hub Agent | 3h | R5-03 | 🟡 P1 | ✅ |
| R5-05 | 跨 Hub A2A | 群聊 @对方 Agent → 跨 Hub A2A 调用 | 2h | R5-02, R2-04 | 🟡 P1 | ✅ |

### 6.6 部署与文档

| ID | 标题 | 描述 | 预估 | 依赖 | 优先级 | 状态 |
|:---|------|------|:---:|------|:---:|
| R6-01 | Docker 镜像 | Relay Dockerfile + 多阶段构建 + Docker Hub | 1.5h | R1-06 | 🟡 P1 | ✅ |
| R6-02 | 自部署指南 | Docker + Nginx 反代 + TLS 配置文档 | 1h | R6-01 | 🟡 P1 | ✅ |
| R6-03 | Hub 配置 UI | 设置面板: Relay 地址 + P2P 开关 + Hub ID | 1.5h | R2-05 | 🟡 P1 | ✅ |
| R6-04 | 官方 Relay | 部署一个官方 Relay 实例 | 1h | R6-01 | 🟢 P2 | 🔴 |

---


## ⚠️ 未排期但 PRD 要求的任务

| ID | 标题 | 描述 | 优先级 | 状态 |
|:---|------|------|:---:|:---:|
| U-01 | 系统级密钥存储 | macOS Keychain + Windows Credential Manager + Linux libsecret + AES-256-GCM 文件兜底。credential-store.ts 400+ 行。 | 🔴 P0 | ✅ 已验证 |
| U-02 | A2A 权限确认 UI | auto/confirm/deny 三模式 + 30s 超时 + 弹窗确认 + 3 个 API 端点 | 🟡 P1 | ✅ 已验证 |
| U-03 | 群聊路由语义统一 | 无@→首个在线 Agent（不再广播）；显式 All→广播；AgentSelector 多选 | 🔴 P0 | ✅ 已验证 |
| U-04 | E2E 验证冲刺 | 干净环境首启 ✅ + TTFM 7s ✅ + CLI adapter 修复 ✅ + WS lastEventId 修复 ✅ + Codex JSON 解析 ✅ + Catalog detected ✅ | 🔴 P0 | ✅ 已验证 |
| U-05 | Prompt-based A2A for CLI adapters | CLI adapter 通过 [A2A_CALL: target: message] 协议支持 A2A。OpenAI adapter 用 tool-calling | 🟡 P1 | ✅ 已验证 |

## 验证冲刺（优先于所有新功能开发）

> 以下 5 项验证必须在干净环境中完成，不能在开发者已有的 agentlink.config.ts 上测试。

1. **干净环境首启**：删除 config 文件 + DB → 启动 → 自动扫描 → 选择 Agent → 发送第一条消息（macOS/Windows/Linux）
2. **TTFM 度量**：从打开应用到收到第一条有效回复，目标 p50 ≤ 60s
3. **A2A tool-calling 端到端**：两个 OpenAI API Agent → 发消息 → Agent A 调用 Agent B → 验证调用链可视化 → 取消 → 超时
4. **跨 Hub 通信端到端**：启动 Relay → 两个 Hub Client 连接 → 发消息 → 验证 E2E 加密 → 离线消息
5. **群聊完整流程**：创建群聊 → 添加 Agent → @提及路由 → 无@广播 → A2A 调用 → 成员管理

## 七、任务统计

| 版本 | 任务数 | 预估总工时 | P0 | P1 | P2 | 状态 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| 版本 | 任务数 | ✅ 已验证 | 🟡 已写未验证 | 🔴 未开始 |
|------|:---:|:---:|:---:|:---:|
| v0.1 收尾 | 18 | 18 | 0 | 0 |
| 产品缺口修复 (G0-G4) | 22 | 22 | 0 | 0 |
| v1.1 基建 | 35 | 27 | 8 | 0 |
| v0.2 多 Agent (M1-M5) | 17 | 12 | 5 | 0 |
| v0.3 群聊+生态 (A1-A4) | 13 | 10 | 3 | 0 |
| v1.0 跨用户 (R1-R6) | 29 | 24 | 4 | 1 |
| 未排期 (U-01~05) | 5 | 5 | 0 | 0 |
| **合计** | **139** | **118** | **19** | **2** |

> ✅ 已验证 = 代码存在 + 单元/集成测试通过
> 🟡 已写未验证 = 代码存在但无 E2E 验证或 PRD 验收测试
> 🔴 未开始 = 无代码
> ⚠️ 需确认 = 代码与 PRD 语义不一致，需确认正确行为

> **下一步优先级**：验证冲刺 > U-03 群聊路由语义统一 > U-01 系统级密钥存储 > 继续开发



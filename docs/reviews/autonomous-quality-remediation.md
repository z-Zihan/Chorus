# Chorus 自主质量整改任务：自动化测试、UI 校验、Bug 修复与文档同步

> 参考 Evir 的自动化质量整改方法，但以 Chorus 的 conversation-first、跨设备信任、Room 授权和 Tauri sidecar 架构为准；不得复制 Evir 的 Provider、工作区 Agent 或模式设计。

## 1. 任务目标

暂停新增功能，持续执行“检查 → 复现 → 修复 → 回归 → 记录”闭环，直到仓库内可验证门禁全部通过，并把真实设备、签名和跨平台等外部门槛明确留在未完成列表中。

本任务必须同时覆盖：

1. 自动化测试：Shared、Relay、Server、Web、Rust、构建和格式门禁。
2. UI 校验：核心页面、低频弹窗、状态矩阵、响应式、主题、语言、键盘和无障碍。
3. Bug 修复：优先 P0/P1；修复必须有可重复的回归证据。
4. 文档同步：README、开发指南、产品/协议文档、开发计划和本报告不得与实现冲突。
5. 证据分级：确定性 fixture、浏览器渲染、原生窗口、物理双设备和签名安装互不替代。

## 2. 产品主路径

质量整改围绕以下任务，而不是按组件数量计算完成度：

1. 首次启动 → 发现/添加 Agent → 创建会话 → 发送第一条消息。
2. 单聊发送 → 流式/停止 → 失败保留 → 重试/恢复。
3. 创建群聊 → 选择参与 Agent → 查看 A2A 模式、路由、执行和失败。
4. 配对两个 Hub → 双方核验/批准 → 只建立联系人，不泄露 Agent。
5. 邀请联系人加入 Room → 明确接受/拒绝 → 所有者添加自己的 Agent。
6. 管理会话、Agent、可信设备、凭据、任务、诊断、导出和更新。

## 3. 证据等级

| 等级 | 证据 | 可以证明 | 不能证明 |
| --- | --- | --- | --- |
| E1 | 单元/集成测试、fixture、静态检查 | 状态机、权限、错误分支、协议不变量 | UI 可用、真实网络、原生运行 |
| E2 | 真实浏览器渲染与交互 | Web 布局、语义、键盘、响应式、前后端联调 | Tauri/WebView、系统权限、物理设备 |
| E3 | 本机 Tauri 原生窗口和未签名包 | 当前 macOS 架构启动、sidecar、WebView 基础交互 | 签名安装、Windows、干净机器 |
| E4 | 两台物理设备与真实网络 | 配对、Room、重连、Relay/P2P 真实链路 | 签名和分发 |
| E5 | 签名、公证、干净机安装/升级 | 发布产物可安装和升级 | 其他平台自动成立 |

报告中必须写明实际达到的等级。不得用 E1/E2 冒充 E3–E5。

## 4. 仓库安全与基线

执行前：

- 记录分支、Commit、系统、Node/pnpm/Rust 版本和工作区状态。
- 保留用户已有修改；禁止 `reset --hard`、`checkout --`、`clean`。
- 扫描新增文件中的明显密钥、私钥、数据库和运行数据。
- 测试使用确定性 Mock/fixture；不得记录真实凭据。
- 不提交 `.DS_Store`、数据库、Hub 私钥、sidecar runtime 或签名材料。

## 5. 自动化门禁

仓库内最终门禁按以下顺序执行：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
```

要求：

- 每个命令退出码为 0；测试数量和跳过原因写入报告。
- Web E2E 使用隔离临时数据目录和确定性 Agent，不污染用户数据库。
- E2E 失败必须保留可诊断的 trace/screenshot，成功产物可以清理。
- `pnpm test` 与 Web E2E 分开，避免浏览器测试被 Vitest 误收集。
- production build 记录主入口、总 JavaScript/CSS gzip 和构建告警。

初始性能预算：

- 主 Web 入口 minified ≤ 300 KB。
- 全部 Web JavaScript gzip ≤ 350 KB。
- Web CSS gzip ≤ 15 KB。
- 不允许通过提高 Vite warning 阈值隐藏回归。

## 6. Web E2E 最低覆盖

仓库内必须存在可重复执行的 Web E2E，至少覆盖：

1. 应用启动和核心 landmark：skip link、`main`、会话 `h1`、Composer 名称。
2. 移动侧栏：打开/关闭、搜索、新建、建群、配对、设置。
3. 设置 Dialog：八个页面可达；方向键/Home/End；Escape 和焦点返回。
4. 低频 Dialog：配对、建群、Agent 目录、Agent 设置、日志、危险确认。
5. 群聊：成员菜单、添加/移除入口、A2A 状态和导出菜单。
6. 响应式：375×812、800×600、1440×900；页面无横向溢出。
7. 语义/触控：可见交互控件有稳定名称；移动有效命中区不小于 44×44px。

无法稳定自动化的系统级行为必须进入人工门槛，不得伪造测试通过。

## 7. UI 人工/浏览器矩阵

| 维度 | 最低矩阵 |
| --- | --- |
| 尺寸 | 320×812、375×812、800×600、1280×800、1440×900、400×300 极短视口 |
| 缩放 | 真实 Chrome 200% |
| 主题/语言 | Light/Dark × zh-CN/en |
| 输入 | 鼠标、仅键盘、Tab/Shift+Tab、Enter/Space、方向键、Home/End、Escape |
| 状态 | loading、empty、success、error、offline、timeout、partial、duplicate/pending |
| 页面 | Onboarding、主会话、侧栏、搜索、群聊、配对、设置八页、目录、日志、确认框 |

逐页检查：

- 无页面级横向滚动；内容和末端动作可达。
- 弹窗有标题/描述、焦点循环和关闭后焦点返回。
- 禁用原因可见或可访问；失败靠近触发点并提供恢复动作。
- Light/Dark 使用语义 Token；状态不能只依赖颜色。
- 移动触控目标 ≥44px；桌面可以保持紧凑密度。
- 图标来自统一的 Lucide/Chorus 资产，不用 emoji 充当结构图标。

## 8. 协议、安全与数据门禁

必须有确定性回归覆盖：

- 默认 loopback；显式非 loopback 且无认证时失败关闭。
- Relay 注册挑战、Token 过期/续期/撤销和 Room 成员/创建者授权。
- 配对秘密替换、错 Hub、回放、过期、取消和单边批准不授信。
- Room 邀请 pending/accept/decline/revoke/expire；接受前不可收消息。
- Agent owner proof；联系人不会自动暴露或导入远程 Agent。
- receipt 与业务 ack 分离；签名 receipt 前离线密文不删除。
- 危险操作默认取消，pending 时不可重复，失败不丢数据。

## 9. Bug 分级与修复循环

| 等级 | 定义 | 处理 |
| --- | --- | --- |
| P0 | 数据/权限/密钥风险，或核心任务完全阻断 | 立即修复；未关闭不得继续发布工作 |
| P1 | 核心任务明显受损且无合理替代路径 | 本轮必须修复并补回归 |
| P2 | 局部状态、响应式、无障碍或一致性问题 | 尽量本轮修复；否则登记责任和证据 |
| P3 | 非阻断优化 | 进入计划，不冒充缺陷关闭 |

每个问题都记录：位置、触发条件、用户影响、等级、根因、修改、回归证据和剩余风险。修复后必须重新执行最窄相关测试，再执行最终全量门禁。

## 10. 文档同步清单

- `README.md`：能力边界、启动、测试和发布状态。
- `docs/DEVELOPMENT.md`：真实脚本、测试结构、数量口径和调试方法。
- `docs/GUIDE.md`：用户可见流程和失败恢复。
- `docs/PRD.md`、`docs/CROSS_DEVICE_DESIGN.md`、`docs/RELAY_DESIGN.md`：协议与产品承诺一致。
- `DEV_PLAN.md`、`design/development-plan.md`：确定性完成与外部门槛分离。
- `docs/reviews/automated-quality-report.md`：本次运行环境、结果、Bug、性能、证据和未关闭项。

## 11. 完成标准

仓库内整改完成必须同时满足：

- 自动化门禁全部通过，Web E2E 可在全新进程中复跑。
- P0/P1 Bug 为 0；P2 有明确登记。
- 核心 UI 与低频状态完成响应式、语义、键盘和错误恢复验证。
- 文档中的命令、状态和测试口径与代码一致。
- 报告明确列出 E4/E5 等尚未验证的发布门槛。

以下项目即使仓库门禁全绿，也仍阻断“发布就绪”：

- 两台真实物理设备的配对、Room 消息和断网重连矩阵。
- P2P receipt/state parity。
- 人工屏幕阅读器验收。
- Windows 原生构建与 UI。
- macOS/Windows 签名、公证、干净机安装/升级/卸载。
- 真实历史数据库迁移。

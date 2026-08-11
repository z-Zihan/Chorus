# Chorus 开发计划与发布门禁

本文把产品审计转为可执行工程计划。状态只使用：`已实现`、`确定性验证通过`、`真实环境验证通过`、`阻断`；源码存在或单元测试通过不等同于产品闭环。

## 当前基线（2026-08-12）

- 已实现：API 默认绑定 `127.0.0.1`；无认证时禁止显式绑定非 loopback 地址。
- 已实现：Quiet Signal 明暗 Token、系统字体、焦点与 reduced-motion 基线。
- 已实现：会话优先侧栏、可行动空状态、响应式设置导航、新品牌图形及桌面/Web 图标。
- 已实现：配对入口明确标为“部分可用”，不再把生成挑战描述为完成配对。
- 确定性验证通过：Shared 9 项、Relay 18 项、Server 144 项测试；18 项 Playwright Web E2E；format、lint、所有 workspace 类型检查、Web production build 和 Cargo test/check。
- 浏览器验证通过：1280×720 基础中文界面、Light/Dark 切换、会话列表无横向溢出、配对部分可用状态可读；Room 邀请中心在 1280×800 与 375×812 中文暗色下可见，真实拒绝交互通过。会话、消息、Agent、搜索、设置/隐私与 Agent 目录加载失败在 1280×800/375×812、Light/Dark、中文/English 下显示就地恢复并可重试。
- 已实现：Relay Room HTTP 身份认证与成员/创建者授权；pending Room invitation 的接受、拒绝、撤回、过期和旧库补表；接受前不是成员且不能读取 Room/发送 Room 消息。
- 已实现：PR CI 执行 format → lint → typecheck → 171 项单元/集成测试 → 18 项 Playwright E2E → build。主 Web 入口 268.25kB、总 JavaScript gzip 约 272.26kB、CSS gzip 10.55kB，构建无 chunk warning。
- 已实现：设置中的定时任务具备加载、空、错误保留、创建、启停回滚和删除确认完整状态；诊断页只读展示服务启动时已加载的插件，不再把插件加载器描述成 UI 管理器。Scheduler API CRUD 与无效 Cron/缺失 Agent 共 2 项新增回归测试通过；桌面与 375×812 浏览器交互通过。
- 已实现：群聊成员、联系人和 A2A 模式加载失败均与空/默认状态分离；群聊 Tooltip Provider 崩溃已关闭；跨 Hub Room Agent 添加/移除使用 owner-proof 路径。桌面故障恢复与成员增删确认、375×812 Header/44px/无横向溢出已通过。
- 已实现：Onboarding 的未知/加载/网络失败、扫描、认证、未发现、采用和领域错误均可恢复；Updater 区分 Web/未配置/桌面检查，安装与重启失败分离；会话创建、重命名、置顶、归档和删除具备 pending、防竞态、失败保真与近场反馈。新增 Onboarding 路由 3 项测试；上述关键失败态在 375×812 中文暗色真实交互通过。
- 已实现：凭据清除具备确认和失败保真；Hub 保存、主题/语言持久化、会话/日志导出和配对包复制均有准确反馈。375×812 凭据删除故障态及 English + Light 设置状态真实渲染通过。
- 已实现：全局状态色统一为明暗语义 Token；Toast 可点击关闭且移动命中区 44px；失败消息、离线横幅、跨 Hub 与配对状态不再依赖固定 Tailwind 色。中文标题导出使用 RFC 5987 文件名并有回归测试，配对/导出重复错误反馈已去重。
- 浏览器验证通过：320×812、375×812、800×600、1440×900、400×300 极短视口无页面横向溢出；移动端可见主交互目标达到 44px。真实 Chrome 在 1286×768 窗口、地址栏明确显示 200% zoom 时，主会话、侧栏抽屉、设置及配对均可用且无横向溢出；设置标签支持方向键/Home/End 并自动滚动，居中 Dialog 的末端内容可滚动到达。加入 skip link、主内容焦点目标、会话 `h1` 与 Composer 可访问名称；Onboarding、设置、配对 Dialog 的真实模态、初始焦点、双向焦点循环及焦点返回通过。主界面仅键盘顺序与导出菜单 Enter/Space、方向键、Escape 已在真实 Chrome 验证。人工屏幕阅读器仍为发布前门禁。
- 浏览器验证通过：375×812 自动语义/触控矩阵覆盖八个设置页面、配对、全局搜索、创建群聊、Agent 目录、Agent 设置、诊断日志、危险操作确认和群成员菜单；可见有效命中目标均不小于 44px，Dialog 均有稳定名称且无横向溢出。该证据不能替代人工屏幕阅读器验收。
- 浏览器验证通过：Playwright 覆盖六档视口、Light/Dark × zh-CN/en、严重/致命 axe 门禁、Onboarding/会话加载恢复、A2A 与导出键盘菜单；手工浏览器复核覆盖消息状态 fixture、保留历史的加载失败和真实后端不可用的 Onboarding 重试焦点。证据等级为 E2，不等于原生或真实设备验收。
- 已实现：Relay 密文先按目标持久化；目标 Hub 完成处理后返回 Ed25519/JCS 签名 `transport_receipt`，Relay 验签后才删除；加密 `delivery_ack` 独立表达 `accepted/denied/done/error`。A2A UI 分开展示传输与执行，普通消息用 client message ID 精确关联发送失败。
- 阻断：真实两台物理设备的配对与 Room 消息/重连矩阵、P2P 对等回执、Windows 原生包、macOS/Windows 签名/公证、干净机器安装升级、真实历史迁移尚未关闭。

## 发布顺序

### Phase 0 — 安全边界与能力真实性（P0）

目标：任何未完成能力都不会扩大攻击面或向用户显示为已验证。

1. Relay HTTP 认证与授权
   - 从 Bearer Token 验证调用 Hub，不再信任 `createdBy` 请求体。
   - create/get/join/leave/invite/accept/decline 分别校验调用者、成员和管理员权限。
   - CORS 由部署配置控制，生产不使用无条件 `origin: true`。
   - 验收：无 Token、坏 Token、跨 Hub 越权、伪造 creator 的集成测试全部失败关闭。
   - 当前：上述路由授权和负向集成测试已确定性通过；仍需 Token 过期、撤销、续期以及真实部署验证。
2. 产品文案与状态
   - 配对、P2P、Relay、Room 分别显示未配置、已配置、正在连接、已连接、待确认、已验证、部分可用。
   - 文档不再用“已完成”描述仅有接口或模拟测试的功能。
3. 本地 API 边界
   - 已完成 loopback 默认值；补充真实 LAN 负向验证和 Token 正向验证。

退出门禁：不存在未认证的写接口；设置成功不会显示为连接成功；安全负向测试可重复。

### Phase 1 — 本地单聊闭环（P0/P1）

目标：无 Relay、无账号时，用户仍能可靠完成发现 Agent → 创建会话 → 发消息 → 停止/恢复。

1. Onboarding 覆盖扫描中、未发现、需要登录、采用中、失败与重试。
2. 会话加载失败显示页面内错误和重试；创建、重命名、置顶、归档、删除均有 pending 与失败反馈。
3. 消息建立 transport/execution 双层状态：发送中、已入队、流式、完成、部分、停止、超时、失败。
4. Composer 在无可用 Agent、流式中、离线和超长输入时给出明确原因。
5. 为 ChatStore 和关键组件增加状态 fixture 与交互测试。

当前证据：WebSocket 消息携带 client message ID，服务端持久化后使用同一 ID 回推，失败可定位到准确气泡；跨 Hub A2A 已区分 Relay `queued/delivered/failed` 与 E2E `accepted/denied/done/error`。真实 Relay WebSocket 测试证明签名 receipt 前密文不删除。状态 fixture 在 1280 与 375 宽度渲染通过，窄屏无横向溢出。会话/Agent/消息、搜索、设置/隐私和目录加载错误已与空状态分离；Onboarding 与会话创建/重命名/置顶/归档/删除的失败恢复已故障注入验证，重试失败仍保持恢复入口，消息刷新失败保留已有历史。P2P 对等 receipt、超时/重试完整矩阵仍待实现。

退出门禁：新用户 3 个主步骤内发出首条消息；断网/超时/Agent 离线都能恢复；核心失败无 console-only 分支。

### Phase 2 — 多 Agent 与 A2A 闭环（P1）

目标：用户知道消息实际发给谁、Agent 间调用是否需要确认、结果来自哪条链路。

1. 群聊创建区分可选、离线、远程、stale Agent。
2. A2A mention/call/off 的当前模式、路由目标和权限在 Header/Composer 一致呈现。
3. 确认弹窗覆盖允许、拒绝、超时、取消、深度限制和部分失败。
4. 调用链可追溯到源消息，键盘与屏幕阅读器可操作。

退出门禁：广播不会隐式发生；确认拒绝后不执行；调用链的开始、结束、失败和取消可追溯。

### Phase 3 — 真实联系人配对（P0）

目标：两个独立 Hub 通过可信带外渠道完成相互认证，只创建 Contact，不泄露 Agent。

1. 引入有 ID、过期时间和状态的 pairing session。
2. 发起方生成 256 bit 一次性秘密；配对帧使用双方长期 Ed25519 Hub 身份签名并通过 `crypto_box` 加密，transcript 绑定完整 Hub ID、session、nonce 和消息方向。
3. 双向 HMAC key confirmation 与 User Card 签名验证后显示同一 SAS；双方显式确认才进入 trusted。
4. 覆盖取消、过期、错码、错 SAS、key change、回放和并发重复请求。
5. 配对成功只建立联系人；目录同步和 Agent 授权保持独立。

退出门禁：两独立进程和两真实设备均通过正向流程；所有篡改/回放用例失败关闭；配对前后 Agent 泄漏为零。

当前证据：两独立进程正向流程已通过；两端 session 与 SAS 一致，单边批准不授信，双边批准后同时 trusted，Agent 列表保持为空。确定性覆盖秘密替换、错目标、回放、过期与取消。真实两台物理设备仍未关闭。

### Phase 4 — Room 邀请与成员授权（P0）

目标：邀请不会自动入会，接收者拥有明确控制权，每个 Agent 只能由其所有者带入。

1. Relay 持久化 pending invitation，包含 inviter、invitee、Room、创建/过期时间和状态。
2. 被邀请 Hub 获取待处理列表并选择 accept/decline；接受后才写入 `room_members`。
3. 邀请可撤回、过期、去重；接收前不分发 Room 消息或密钥。
4. Agent 加入继续执行 owner proof；管理员只能移除，不能冒充所有者添加。
5. UI 提供邀请中心、状态反馈、拒绝/过期恢复和 Room 成员审核。

当前证据：1–3 与邀请中心的确定性测试已通过；邀请中心桌面/窄屏渲染及拒绝操作已通过。Relay 接受响应已幂等，本地会话创建失败会保留可见恢复项；故障注入和浏览器失败→重试成功已通过。成员审核、真实两设备和断网重连仍未通过。

退出门禁：接受前不可见消息且不是成员；拒绝/过期不留权限；两设备 Relay/P2P 矩阵通过。

### Phase 5 — 原生桌面与发布工程（P0/P1）

目标：目标机器不安装 Node 也能安装、启动、聊天和恢复。

1. 将 Server 构建为受 Tauri 管理的 sidecar/独立可执行，打包运行依赖和迁移。
2. 处理端口冲突、sidecar 崩溃、升级、数据路径、日志和优雅退出。
3. macOS/Windows 完成签名、安装、首次启动、防火墙提示、重启恢复与卸载验证。
4. 保持 lint 0 error，优先清理 Hook warning；按需加载设置、Markdown 和目录，降低首包体积。

当前证据（2026-08-11）：arm64 macOS `.app` 与未签名 `.dmg` 已生成，应用包包含真实 Node sidecar、Server bundle、迁移和 `better-sqlite3` 原生模块；空 HOME 且 `PATH=/nonexistent` 的启动、健康检查、原生窗口交互、退出清理和同目录重启通过。本轮新构建完成启动检查，但不能替代既有原生交互证据。该证据只关闭本机未签名包的进程级门槛，不代表签名/公证、DMG 安装、干净机器或 Windows 已完成。Updater 在真实服务和签名材料配置前保持禁用。

退出门禁：干净机器冷安装通过；无系统 Node；签名验证通过；崩溃有可操作诊断；lint 0 error。

## UI 验收矩阵

每个关键页面至少覆盖：

- 尺寸：375×812、800×600、1280×800、1440×900。
- 主题与语言：Light/Dark × 中文/English。
- 输入：鼠标、仅键盘、Escape、焦点返回、200% zoom。
- 状态：加载、空、成功、失败、无权限、离线、超时、部分成功、重复操作。
- 证据：自动测试结果、渲染截图、原生窗口录像或截图、真实双设备日志分别存档，不互相替代。

## 近期两个迭代

### Iteration A — 可发布的本地核心

- 继续审计原生专属失败；Onboarding、Updater、会话变更、ChatStore/AgentStore、Search、Settings/Privacy、Catalog、Scheduler、Plugin diagnostics、联系人和群成员核心错误及低频 Web 弹窗语义/触控矩阵已关闭。
- 拆分 Sidebar、SettingsPanel、ChatStore，补组件测试和浏览器 E2E。
- 补全消息状态、Composer 禁用原因、设置保存/连接分离。
- 清理 Hook warning，加入 CI：typecheck → test → lint → build。

### Iteration B — 安全的跨设备 Alpha

- 先做 Relay HTTP 认证授权，再做双端 pairing session。
- 再做 pending Room invitation 与 accept/decline。
- 最后执行两进程、两设备、Relay/P2P、断网重连、撤销和回放矩阵。

不得为了演示跳过 Phase 0，也不得在真实双设备证据前把跨设备标为完成。

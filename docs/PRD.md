# Chorus 产品需求文档（PRD）

> 版本：v2.2<br>
> 日期：2026-08-04<br>
> 产品阶段：已实现零配置 CLI 驾驶舱 + 多 Agent 协作 + 跨设备传输基础；联系人—聊天室—所有者授权 Agent 的新协作模型进入设计落地阶段<br>
> Product stage: the local cockpit and transport foundation exist; the new contact → room → owner-authorized agent model is now the target experience.

## 1. 产品定义

### 1.1 一句话定义

Chorus 是一个本地优先的 AI CLI 即时通讯工作台：自动发现并管理属于用户的本机与远程 Agent，让用户在统一界面中聊天、整理历史，并让多个用户的 Agent 安全协作。

### 1.2 产品判断

当前版本已经有 CLI Adapter、流式聊天、本地持久化、A2A Bus 和 Relay Server 等技术基础，但首个用户价值仍被 `chorus.config.ts` 挡住。**下一阶段不应该继续横向增加技术能力，必须先完成自动检测、零配置首启和首次消息闭环。**



### 1.3 要解决的问题

| 用户问题 | 现状 | Chorus 的产品结果 |
|----------|------|----------------------|
| 多个 AI CLI 入口分散 | 每个工具有不同命令、历史和输出格式 | 一个可视化入口统一发现、聊天和管理 |
| 安装与接入门槛高 | 用户要查命令、写配置、理解 Adapter | 像安装应用一样浏览、安装、验证和卸载 Agent |
| Agent 之间彼此隔离 | 人工复制粘贴上下文，协作过程不可见 | 多 Agent 群聊与可展开的 A2A 调用链 |
| Agent 缺少所有者身份 | 只知道 Hub/Agent ID，无法判断“谁的 Agent” | User、Hub、Agent 三层身份和可验证的 owner 信息 |
| 跨设备协作边界不清 | 配对后自动交换 Agent 目录，联系人关系被误当成 Agent 使用授权 | 配对只建立联系人；先建 Room，再由每位所有者加入自己的 Agent |
| 单 CLI 长期使用体验弱 | 历史难管理、状态与错误不直观 | 即使只有一个 Agent，也有完整的会话与配置工作台 |
| 首次使用认知负担高 | PATH、登录、参数、模型、配置都要用户理解 | 打开即检测，问题可解释，下一步唯一且明确 |

## 2. 产品愿景与用户故事

### 2.1 CLI 管理工具

系统自动识别本机已安装的 Claude Code、Codex、GitHub Copilot CLI 等，统一它们的启动、输入输出、状态和会话体验。

用户故事：

- 作为同时使用多个 AI CLI 的开发者，我打开 Chorus 就能看到哪些工具已安装、是否已登录、版本是否兼容。
- 作为 CLI 用户，我不需要记住非交互参数和 JSON 输出格式，也能开始可视化聊天。
- 作为高级用户，我仍可覆盖命令、工作目录、模型和环境变量，但默认设置已经可用。

验收标准：支持清单中的已安装 CLI 能被准确识别；每个检测结果都有状态、版本、路径、来源和明确动作。

### 2.2 应用内安装

Chorus 提供可信的本地 Agent 目录，用户可以从 UI 添加已检测 CLI、安装受支持的 CLI/Connector，或配置 API Agent。

用户故事：

- 作为新用户，我能浏览 Agent 列表并理解每个 Agent 的用途、来源和权限。
- 作为安全敏感用户，我能在安装前看到要执行的命令和数据边界，并能取消或卸载。
- 作为团队管理员，我能通过高级配置固定允许的 Catalog 来源和版本范围。

验收标准：安装必须可解释、可验证、可撤销；失败不能留下半安装状态；UI 安装的 Agent 重启后仍可用。

### 2.3 多 Agent 群聊

用户在一个房间中加入多个 Agent，通过 `@` 精确路由，也可以让主 Agent 使用 tool-calling 请求其他 Agent 协助。调用过程可展开，但默认不淹没主对话。

用户故事：

- 作为开发者，我能把 Codex、代码审查 Agent 和安全 Agent 加入同一房间。
- 作为群聊参与者，我能看懂谁回答、谁调用了谁、任务是否完成。
- 作为 Agent 所有者，我能决定跨 Agent 调用是否自动允许、需要确认或拒绝。

验收标准：创建群聊、成员管理、`@` 路由、并发/超时/取消、权限确认和调用链展示形成完整闭环。

### 2.4 单人模式同样完整

群聊不是前置条件。一个用户、一个 CLI 也应得到明显优于终端的体验。

用户故事：

- 作为单 Agent 用户，我能创建、重命名、搜索、归档、导出和删除会话。
- 作为高频用户，我能快速切换项目目录、模型和 Agent 配置，并看到健康状态。
- 作为离线用户，我能继续访问历史，并使用支持离线运行的本地 Agent。

验收标准：不创建群聊也能完成发现、聊天、历史管理和配置管理的完整路径。

### 2.5 低认知负担

产品默认替用户完成可安全推断的事情，只在需要授权或存在冲突时提问。

用户故事：

- 作为第一次使用的用户，我不编辑配置文件也能发送第一条消息。
- 作为遇到错误的用户，我看到的是“需要登录 Claude Code”，而不是 `spawn ENOENT`。
- 作为没有安装 CLI 的用户，我会被带到 Agent 目录，而不是停在空白界面。

验收标准：首启只有一个主任务；所有空状态可恢复；高级配置不会干扰默认路径。

### 2.6 多用户与跨 Hub 协作 / Multi-user & Cross-hub Collaboration

一个 User 可以拥有多个 Agent；Hub 表示承载和路由这些 Agent 的设备端点，而不是人的身份。跨用户协作必须依次建立三个相互独立的授权关系：**联系人关系**允许邀请与人类消息，**Room 成员关系**允许接收该房间内容，**Room Agent 成员关系**才允许某个 Agent 被发现和寻址。前一层绝不隐式授予后一层。

用户故事：

- 作为拥有多个 CLI 的用户，我能在“我的 Agent”下统一查看本机 Agent，并按用途选择，而不是把每个 CLI 当成独立的人。
- 作为团队成员，我能添加联系人、创建聊天室和邀请联系人，但配对后不会自动看到对方的 Agent。
- 作为 Agent 所有者，只有我能把自己的 Agent 加入 Room；其他成员不能替我发现、添加或调用未入房的 Agent。
- 作为隐私敏感用户，我的 Agent 默认 `private`，并能选择 `room` 或 `public` 可见性；公开范围和实际调用授权是两回事。
- 作为消息接收者，我看到 `小明 / Gemini CLI`，而不是无法辨认的裸 `gemini-cli` ID。

验收标准：配对成功后远端 Agent 数量仍为 0；Room 邀请需接受；只有 `actorUserId === agent.ownerId` 能加入 Agent；Room Agent 授权可撤销并立即阻止新调用；同名 Agent 不会误路由；Relay 无法读取目录或正文。

**English:** One user owns many agents; a Hub is a device endpoint. Pairing grants contact capabilities only. Room membership grants access to room content, and an agent becomes addressable only when its owner explicitly adds it to that room. Every grant is scoped, revocable, and collision-safe.

## 3. 目标用户

### 3.1 多 CLI 独立开发者（核心 Persona）

- 同时使用 2 个以上 AI CLI，在多个代码库工作。
- 看重效率、本地历史和可控性，能理解 CLI，但不想维护重复配置。
- 核心任务：快速选择合适 Agent、保留上下文、找回过去结论。
- 成功信号：Chorus 成为每天打开的 CLI 入口，而不是偶尔演示 A2A 的工具。

### 3.2 Agent 工作流开发者

- 开发 Adapter、Agent、MCP 工具或多 Agent 流程。
- 需要查看流式事件、调用链、错误、耗时和日志。
- 核心任务：低成本接入 Agent，验证路由与协作行为。

### 3.3 AI 协作团队（扩展 Persona）

- 多人拥有不同的本地 Agent，需要跨设备协作和权限边界。
- 核心任务：在群聊中委派任务、异步收取结果、审计敏感操作。
- 进入条件：本地单人体验和本地群聊稳定后，才进入跨 Hub 阶段。

### 3.4 非目标用户

- 只想注册即用一个云端通用聊天模型、不使用本地 CLI 的大众消费者。
- 需要无监督执行高风险系统操作、且不接受权限确认的自动化场景。
- 把 Chorus 当成模型训练、模型托管或企业知识库平台的团队。

## 4. 核心 Jobs to Be Done

1. 当我电脑上已经装了多个 AI CLI 时，我想立即知道哪些可用，并在一个地方开始对话。
2. 当我需要新的 Agent 能力时，我想从可信目录添加它，而不是阅读接入文档和手写配置。
3. 当我需要多个 Agent 协作时，我想在群聊里分配任务并看懂过程，而不是人工搬运上下文。
4. 当我回到过去的工作时，我想快速找到、整理和继续会话。
5. 当 Agent 不工作时，我想知道是未安装、未登录、版本不兼容还是运行失败，并立即修复。
6. 当我与其他用户协作时，我想按“用户 / Agent”定位目标，并确认对方身份、能力、在线状态和权限边界。

## 5. 用户旅程

### 5.1 目标首启流程

```text
打开应用
  ↓
创建本地应用数据目录与数据库（无需配置文件）
  ↓
自动扫描 CLI：PATH + 常见安装目录 + 平台命令别名
  ↓
┌──────────────────┬──────────────────┬──────────────────┐
│ 至少一个 ready    │ 已安装但需登录    │ 未发现支持的 CLI  │
│ 选择推荐 Agent    │ 显示登录命令      │ 打开 Agent 目录    │
│ 自动建首个会话    │ 登录后重新检测    │ 或导入高级配置      │
└──────────────────┴──────────────────┴──────────────────┘
  ↓
发送第一条消息
  ↓
提示历史保存在本地；其余设置延后暴露
```

设计原则：

- 不先问端口、数据库路径、模型名或输出格式。
- 检测过程不阻塞整个界面，先展示逐步出现的结果。
- 自动选择仅发生在唯一且明确可用时；有冲突时让用户选择。
- 用户关闭 onboarding 后，下次从原状态继续，而不是重新开始。

### 5.2 日常单 Agent 流程

```text
打开应用 → 自动恢复最近会话 → 选择 Agent/项目 → 聊天
         → 搜索或新建会话 → 重命名/归档/导出
```

### 5.3 安装 Agent 流程

```text
打开 Agent 目录 → 查看来源/能力/权限/兼容性
→ 选择“添加已安装 CLI”或“安装” → 明确确认
→ 执行并展示进度 → 健康检查 → 创建首个会话
→ 失败则给出原因并回滚
```

### 5.4 群聊流程

```text
创建群聊 → 选择至少两个 Agent → 设置默认路由和权限
→ 发送消息或 @Agent → Agent 回复/调用其他 Agent
→ 折叠查看 A2A 过程 → 取消、重试或继续任务
```

### 5.5 跨用户协作流程 / Cross-user Journey

```text
配置可外部访问的 Relay → 保存成功并自动连接 → 查看连接状态
→ 输入 Hub ID → 交换配对码并核验指纹 → 联系人出现（不交换 Agent）
→ 创建 Room / 打开双人 Room → 邀请联系人并等待接受
→ 每位成员各自加入自己的 room/public Agent → Room 内出现 Owner / Agent
→ 人类消息或选择已入房 Agent → 检查 mention/call/off → 投递与回执
```

失败必须可解释：Relay 地址不可达、配对码错误、邀请待接受、Agent 未入房、等待所有者确认、目标离线、消息过期分别使用不同状态，不统一显示为“发送失败”。

**English:** Configure and connect to a reachable Relay, pair into a contact without exchanging agents, create or open a room, invite contacts, and let each participant bring only their own agents. Delivery and authorization states remain separate and explainable.

## 6. 当前体验审计

| 价值主张 | 状态 | 产品结论 |
|----------|:---:|----------|
| CLI 管理 | ⚠️ | Adapter 与聊天已可用；自动发现和统一接入缺失 |
| 应用内安装 | ❌ | 只有后端注册 API，没有用户安装闭环 |
| 多 Agent 群聊 | ❌ | 有技术基础，没有可完成的用户路径 |
| 单人模式 | ⚠️ | 核心聊天可用，历史与配置管理不完整 |
| 低认知负担 | ❌ | 无配置会进入 0 Agent 死路，无首启引导 |
| 跨设备协作 | ⚠️ | 传输基础存在；保存反馈、连接状态、联系人、Room 所有权与 Agent 隐私模型需要重做 |

“服务能启动”“数据库有字段”“API 能调用”均不等于用户需求已完成。

## 7. 功能优先级

### 7.1 发布阻断项（已满足）

| 功能 | 为什么现在做 | 最小验收结果 |
|------|--------------|--------------|
| CLI 自动检测 | 当前第一体验阻断点 | 支持 Claude Code、Codex、Copilot CLI 的跨平台发现、版本探测、去重和重扫 |
| 零配置启动 | 无配置时目前不可聊天 | 配置文件不存在也能使用应用数据目录、持久化 Agent 并建立首个有效会话 |
| 首次运行引导 | 空状态无修复路径 | 覆盖 ready、needs_auth、none_found、error 四条路径 |
| 检测结果可操作 | “发现”本身没有价值 | 添加/启用、打开登录指引、重新检测、忽略均可完成 |
| Registry 重启恢复 | UI 注册当前无法可靠持久使用 | 配置导入、数据库记录、自动检测结果有明确合并优先级，重启不丢失 |
| 安全与错误翻译 | CLI 继承本机权限 | 只执行允许的探测命令；错误转为用户语言；不记录密钥 |

### 7.2 P1：留存与核心愿景

| 功能 | 用户结果 |
|------|----------|
| Agent Catalog 与安装 UI | 不写配置即可添加、安装、验证和卸载 Agent |
| 历史管理 | 搜索、重命名、归档、导出、批量清理 |
| 多 Agent 会话绑定 | 一个会话可添加、移除和切换多个 Agent |
| 本地群聊 | 创建房间、成员管理、`@` 路由、身份展示 |
| tool-calling A2A | 主 Agent 自主请求其他 Agent，过程可取消和审计 |
| 权限确认 | 跨 Agent、文件、代码修改等敏感动作有明确授权 |

### 7.3 P2：规模化与生态

- User 实体、Agent owner 归属和历史身份快照。
- 联系人和 Room 成为跨用户主入口；不再以远程 Agent 目录作为侧边栏默认入口。
- 仅对 `public` 联系人范围或已明确加入 Room 的 `room/public` Agent 发送最小加密目录声明。
- P2P/mDNS、跨设备离线消息、端到端加密和跨 Hub 群聊。
- 第三方 Catalog、插件签名与发布流程。
- MCP、Google A2A 等标准协议兼容。
- 团队策略、审计和多用户管理。

### 7.4 明确降级

i18n、主题、动画、埋点供应商、更多 UI 基础组件不是当前发布阻断项。已有能力继续维护，但新增基建必须能直接支撑 P0 用户路径；不能再次以“先补基建”为由延后自动检测。

## 8. 详细需求

### 8.1 CLI 检测状态模型

| 状态 | 含义 | 主行动 |
|------|------|--------|
| `ready` | 已安装、版本兼容、可启动 | 添加并开始聊天 |
| `needs_auth` | 已安装，但需要用户登录 | 打开登录指引，完成后重扫 |
| `installed` | 已找到，尚未完成可用性确认 | 验证 |
| `unsupported` | 版本过旧或平台不支持 | 查看升级方式 |
| `not_installed` | 未发现 | 打开安装页 |
| `error` | 探测异常 | 查看原因并重试 |

检测不得修改系统状态，不得自动登录，不得静默安装。

### 8.2 配置优先级

从高到低：

1. 管理员/高级用户显式配置与禁用策略。
2. 用户在 UI 中确认并持久化的 Agent。
3. 本次自动检测出的新候选项。
4. Catalog 默认模板。

自动检测不能覆盖用户自定义参数；配置文件缺失不是错误。首次导入后，UI 变更必须有明确持久化位置。

### 8.3 会话历史

当前已有创建、查看、删除和 SQLite 持久化。P1 必须补齐：

- 重命名、归档、固定和按 Agent/项目筛选。
- 全文搜索与命中上下文。
- Markdown/JSON 导出。
- 清空或批量删除时的范围说明与二次确认。
- Agent 被卸载后，历史仍可读，并显示原 Agent 身份快照。

### 8.4 群聊与路由

- 创建群聊至少选择两个 Agent，也允许之后增删成员。
- 有 `@` 时只路由给被提及的 Agent；无 `@` 默认只交给群主 Agent，不能无提示广播造成成本失控。
- 广播必须由用户明确选择。
- 每条消息展示真实发送者；A2A 子消息默认折叠。
- 调用链限制深度、并发和总超时，并支持级联取消。

### 8.5 用户、所有者与命名 / User, Ownership & Naming

- 首次启动创建一个本机 User；不要求云账号。User 与 Hub 分离，Hub 是设备/传输身份。
- 每个 Agent 必须有 `ownerId`。`ownerType=local` 表示用户显式添加，`remote` 表示从可信远程目录同步，`system` 表示本机自动检测；`system` Agent 仍归本机 User 所有。
- UI 的 Agent 区域只默认展示“我的 Agent”；远程人类显示在独立的“联系人”区域。远程 Agent 只在其所有者加入的 Room 成员面板和该 Room 的选择器中出现。
- Agent 名称只是显示名，不参与唯一寻址。协议路由使用稳定的 `agentId + homeHubId`；UI 在有冲突时显示 `Owner / Agent`，必要时附 Hub 短指纹。
- 远程用户或 Agent 被撤销后，历史保留不可变的 Owner/Agent 名称与头像快照，但不得继续显示为在线目录项。

**English:** The global agent list contains the local user's agents, while remote people live under Contacts. A remote agent appears only inside rooms where its owner has explicitly added it. Stable IDs route messages; display names never authorize or address them.

### 8.6 权限、信任与隐私 / Permission, Trust & Privacy

默认策略：

| 对象 | 默认可见/可调用范围 | 用户可配置项 |
|------|--------------------|--------------|
| User | 仅显示名、头像和公钥指纹；仅对已配对 Hub | 名称/头像是否对房间成员公开 |
| Agent | `private`，不进入任何远程目录；配对本身不改变可见性 | `private` / `room` / `public` |
| A2A 调用 | 自有 Agent 可 `auto`；可信远程调用默认 `confirm`；陌生来源 `deny` | 会话级与 Agent 级 `auto` / `confirm` / `deny` |
| 内容 | 只发送当前消息和明确构造的 ContextPacket | 是否包含文件、路径、历史摘要和工具结果 |

- 信任建立使用邀请/配对码并核验 User 与 Hub 公钥指纹；Relay 登录成功不等于用户之间互信。
- 配对完成只创建 Contact，不触发 `directory_request` 或 `directory_announce`。联系人可以互发人类消息和 Room 邀请，不能据此调用 Agent。
- `room` 表示 Agent 只在**所有者明确将它加入的 Room**中可见；它不会自动出现在所有共同 Room。`public` 表示可向已配对联系人发送最小 Agent Card，但不进入 Relay 全局搜索，也不代表允许调用。
- 添加 Room Agent 时必须同时验证操作者是所有者、Agent 可见性为 `room|public`、操作者是 Room 成员；任何远程成员都不能替所有者添加 Agent。
- 权限判断使用签名后的 `fromUserId`、`fromAgentId` 和会话/房间成员关系，不信任可伪造的显示名。
- Relay 只路由加密信封，但仍能观察 Hub ID、房间、时间、大小和在线状态等元数据；产品必须明确提示这一边界。
- 目录声明必须带版本、过期时间和撤销机制。隐身、删除 Agent 或取消信任后，不等待缓存自然过期。

**English:** Contacts, room members, and room agents are separate grants. Agents default to `private`. `room` disclosure requires an explicit owner-created room membership; `public` is discoverable only by paired contacts and still grants no invocation right. Remote calls default to confirmation.

### 8.7 跨设备交互与状态 / Cross-device Interaction & State

#### Relay 配置 / Relay configuration

- 输入提示固定为 `wss://your-relay.example.com/ws 或 ws://192.168.x.x:3211/ws`。
- 除显式开发模式外，前后端都拒绝 `localhost`、`127.0.0.0/8` 和 `::1`；私网 IP 允许用于局域网协作，公网建议并优先展示 `wss://`。
- 保存是持久化动作：成功 Toast 为“保存成功，正在连接”，失败 Toast 显示验证或存储错误且不清空表单。自动连接是后续异步动作。
- 状态机为 `disconnected → connecting → connected`，网络中断进入 `reconnecting`，重试耗尽进入 `error`；状态、最近错误和“重试”动作始终可见。

**English:** The form rejects loopback Relay hosts outside explicit development mode, acknowledges persistence with a toast, and then attempts connection. Save success and connection success are distinct. The UI exposes disconnected, connecting, connected, reconnecting, and error states.

#### 侧边栏与 Room / Sidebar and rooms

```text
我的 Agent / My Agents
联系人 / Contacts
  └─ Avatar + name + online state
聊天室 / Rooms
  └─ Direct or named room + unread state
```

- 点击联系人提供“发消息”和“创建聊天室”；前者创建/复用 `kind=direct` 的双人 Room，后者创建 `kind=group` 的命名 Room。
- Room 创建者可邀请联系人；受邀者接受后加入。退出、移除成员和解除联系人不删除历史，但会撤销后续投递和 Agent 能力。
- Room 中的人类成员和 Agent 成员必须分栏展示。只有“添加我的 Agent”，不提供浏览或添加他人 Agent 的入口。
- 会话层新增 `type=room` 并关联 `roomId`；旧 `cross_hub` 只作为迁移期读取兼容，不再用于新建流程。

**English:** Contacts and rooms are first-class sidebar sections. DMs are direct rooms, named chats are group rooms, and invitations require acceptance. Human membership and agent membership are separate; the only add-agent action is “Add my agent.” New cross-user conversations use `type=room`.

#### Room 管理员 / Room administrators

- Room 创建者默认为管理员。管理员可以邀请联系人、移除成员、移除任何 Agent，并把其他 Room 成员委派为管理员。
- 管理员不能添加别人的 Agent；Agent 入房始终只能由所有者发起。
- 非管理员只能退出 Room，以及添加或移除自己的 Agent。
- 管理员移除他人的 Agent 时，系统必须通知所有者、写入可审计事件，并立即撤销该 Agent 的后续调用权限。

**English:** The room creator is an administrator by default. Administrators may invite contacts, remove members or any room agent, and delegate the role to another member, but they cannot add someone else's agent. Non-administrators may only leave and manage their own agents. Removing another user's agent must notify its owner, create an audit event, and immediately revoke further invocation rights.

#### 成功与权限验收 / Acceptance

1. 保存有效 Relay URL 后 500 ms 内出现成功 Toast，并开始展示连接状态；无论连接成败，已保存值在重启后保留。
2. 配对完成后，联系人可见，但没有任何远程 Agent 记录因配对自动创建。
3. 非所有者尝试添加 Agent 返回 `403 AGENT_OWNER_REQUIRED`；未入房 Agent 的消息返回 `403 AGENT_NOT_IN_ROOM`。
4. 所有者移除 Agent 或改为 `private` 后，目录撤销在在线链路 60 秒内收敛，后续调用被拒绝。
5. 联系人、Room 和 Agent 撤销分别可审计，且不会误删历史消息。
6. Room 创建者自动获得管理员角色；非管理员邀请/移除他人返回 `403 ROOM_ADMIN_REQUIRED`，管理员移除他人 Agent 会通知所有者并生成审计事件。

**English:** Acceptance covers immediate save feedback, persisted connection settings, zero agent disclosure on pairing, owner-only room agent admission, administrator enforcement, owner notification, fast revocation, and auditable history-preserving removal.

## 9. 成功指标

### 9.1 激活指标

| 指标 | 定义 | 目标 |
|------|------|:---:|
| 首条消息时间 TTFM | 首次打开至成功发出并收到有效回复 | p50 ≤ 60 秒，p90 ≤ 180 秒 |
| 零配置激活率 | 未编辑配置文件即完成首条消息的首次用户占比 | ≥ 80% |
| Onboarding 完成率 | 开始检测后进入可聊天会话的用户占比 | ≥ 80% |
| 首条消息成功率 | 首次发送后得到非错误回复的占比 | ≥ 90% |

### 9.2 检测质量

| 指标 | 定义 | 目标 |
|------|------|:---:|
| 检测召回率 | 支持清单内已安装 CLI 被发现的比例 | ≥ 95% |
| 检测准确率 | 标记为已安装的结果确实可执行 | ≥ 99% |
| 状态判断准确率 | ready / needs_auth / unsupported 与实际一致 | ≥ 90% |
| 扫描耗时 | 冷启动扫描完成时间 | p95 ≤ 3 秒 |

### 9.3 留存与价值

| 指标 | 目标 |
|------|------|
| D7 激活用户留存 | ≥ 30%（早期开发者样本） |
| 每周使用 2 个以上 Agent 的激活用户占比 | ≥ 40% |
| 历史搜索成功率 | 搜索后 60 秒内打开目标会话 ≥ 70% |
| Agent 安装成功率 | 发起安装后通过健康检查 ≥ 90% |
| 群聊任务完成率 | 创建群任务后至少一个目标 Agent 成功回复 ≥ 85% |
| Room Agent 授权一致性 | 加入、移除或可见性撤销后 60 秒内在 Room 成员端收敛 ≥ 99% |
| 远程误路由率 | 因重名或陈旧目录投递给错误 Agent | 0 |
| 配对零泄露率 | 仅完成配对时未自动创建任何远程 Agent 记录 | 100% |
| Relay 配置反馈 | 保存后 500 ms 内出现成功/失败反馈 | ≥ 99% |

### 9.4 隐私指标

- 默认遥测为关闭或明确征得同意。
- 0 个 API Key、消息正文或本地路径进入产品分析事件。
- Relay 运维日志不记录解密后的消息正文。

## 10. 非功能要求

| 领域 | 要求 |
|------|------|
| 启动 | UI 可交互时间 p95 小于 3 秒；检测异步进行 |
| 本地优先 | 历史与配置保存在应用数据目录；Relay 不影响本地单人使用 |
| 跨平台 | macOS、Windows、Linux 检测逻辑分别测试，尤其处理 GUI PATH 差异 |
| 安全 | Catalog 有来源和完整性信息；探测命令白名单；敏感信息进入系统钥匙串 |
| 可恢复 | 检测、安装、登录和运行失败都有重试或回滚路径 |
| 可访问性 | Onboarding、Catalog 和聊天主路径支持键盘操作与屏幕阅读器 |

## 11. Anti-features：Chorus 不是什么

- **不是 ChatGPT 克隆。** Chorus 不以一个通用聊天模型为中心，也不销售模型能力。
- **不是通用 Chatbot Builder。** 它不与 Dify 等工作流搭建平台争夺所有机器人场景，重点是本地 CLI 的管理与通信。
- **不是默认云 SaaS。** 本地单人能力不依赖 Chorus 账号或官方云端；Relay 是可选、自托管的协作组件。
- **不是静默自动化平台。** 不会在用户不知情时安装二进制、登录账号或执行高风险操作。
- **不是终端模拟器。** 产品抽象的是 Agent、会话和协作，而不是完整复刻 shell。
- **不是“所有 Agent 自动广播”的聊天室。** 无提示广播会放大成本、噪音和安全风险，默认路由必须可预测。

## 12. 路线图与发布门槛

| 版本 | 用户结果 | 发布门槛 |
|------|----------|----------|
| 已完成 | 开发者能通过配置使用单 Agent | 已实现 |
| 已完成 | 新用户打开即可发现 CLI 并完成首条消息 | 已实现 |
| 已完成 | 用户能安装 Agent、管理长期历史、创建本地群聊 | 已实现 |
| 已完成 | 多 Agent 协作可控、可取消、可审计 | 已实现 |
| 已完成 | 团队可跨设备安全协作 | Hub Client、Relay、加密和运维方案完成 |
| 下一阶段 | 用户通过联系人和 Room 安全协作 | Relay 配置反馈、Contacts、Room API/UI、owner-only Agent 加入、默认 private 与撤销通过验收 |

## 13. 开放决策

产品决策：

1. 首批正式支持的 CLI 清单与最低版本。
2. macOS GUI PATH 的获取策略：登录 shell 解析、常见目录补充及用户自选路径的边界。
3. `needs_auth` 的探测方式，确保不会发出计费请求或污染用户历史。
4. UI 配置、数据库记录与 `chorus.config.ts` 冲突时的精确合并规则。
5. 系统钥匙串落地前，API Agent 是否允许通过 UI 保存密钥；建议默认不开放。
6. 一个 User 的多设备模型；已决策：User 身份稳定并可绑定多个 Hub，Room 状态跨绑定 Hub 同步，Agent 仅在其 `ownerHubId` 上实际执行。
7. `public` Agent 是否允许被 Relay 全局搜索；已决策：v1 不提供全局目录，`public` 仅表示已配对联系人可发现。
8. Room 管理员移除 Agent；已决策：管理员可以移除任意 Agent，但不能添加别人的 Agent，且必须通知所有者并写入审计事件。

**English:** Decisions 6 and 8 are closed: a stable User may bind multiple Hubs while each agent executes only on its `ownerHubId`; room administrators may remove any agent but may neither add another user's agent nor omit owner notification and auditing.

## 14. 设计参考 / Design References

- [Google A2A Agent Cards](https://google.github.io/A2A/latest/specification/)：Agent Card 是由所有者选择发布的能力名片；Chorus 采用最小、分范围、可撤销的声明，而不是配对后全量抓取。
- [Discord Bots](https://discord.com/developers/docs/topics/oauth2) 与 [Slack app installation](https://api.slack.com/authentication/oauth-v2)：先建立服务器/工作区或频道，再由有权限的所有者安装 bot/app。Chorus 对应为先建 Room，再由每位所有者带自己的 Agent 入房。
- [Agent Client Protocol (ACP)](https://agentclientprotocol.com/)：借鉴客户端—Agent 的明确控制边界；跨用户调用额外要求双方信任、Room 范围和所有者授权。

**English:** The design combines opt-in A2A-style capability cards, Discord/Slack-style room-first bot admission, and ACP-style explicit ownership boundaries. These references inform the interaction model; Chorus's E2E transport and local-first identity remain architecture-specific.

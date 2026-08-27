# Chorus 全项目代码质量审计报告

- 审计日期：2026-08-27
- 审计基线：`main @ 569b8e7`（工作区干净）
- 审计方式：6 个区域并行代码审计（shared 边界 / A2A 核心 / Hub 跨设备 / Relay / Web / 数据层与平台层）+ 主审计人对全部计划修复项的逐行复核
- 二次 Review：已执行——剔除纯风格项与日志类问题（按任务要求日志问题全部排除）、合并跨区域重复项、降级无真实影响的发现

---

## 1. Executive Summary

**总体健康度：中上。** 架构分层清晰（monorepo 包边界零违规、跨包 import 全部走 `@chorus/shared` 根入口、WS 事件类型已 typed 共享、A2A bus 对 remote 分支前统一做权限与环检测、Relay JWT/挑战/回执验证实现规范），质量门禁全绿（format/lint/typecheck/178 单测/19 e2e/build/cargo 全 PASS）。核心风险不在结构，而在**跨设备链路的幂等/生命周期细节**与**少数并发计数缺陷**。

**核心架构评价**：`shared` 定位正确（协议类型 + JCS + logging/telemetry 均被多包真实复用，无宿主实现混入）；server 内 hub/agent/db 的 `import type` 双向引用是分层模糊的早期信号但无运行时循环；repository 1333 行 God-class 是最大的可维护性债务；runtime.ts（936 行）同时承担持久化/事件发布/路由/A2A 确认流/设置管理九类职责。

**主要稳定性风险**：接收端幂等去重仅内存 LRU（重启/淘汰后 Relay 重发导致 Agent 重复执行）；发送端离线队列纯内存且 offline 短路绕过 Relay（重启丢消息）；A2A bus 并发计数器恢复旧值而非递减（闸门可被绕过也可永久卡死）；scheduler 重叠执行无互斥。

**主要安全风险**：Relay 未认证 WS 帧可远程崩溃进程（P0）；Relay WS 未设 maxPayload（默认 100MB）且 offline_messages 单帧全量下发；resync 不校验 Room 成员资格（已配对非成员可读/改写 Room 状态）；Windows 下 CLI argument 模式存在命令注入面（`shell:true` + 消息拼参）；macOS keychain 写入经 argv 暴露 secret。

**是否适合本轮直接优化**：适合。无风险清理项、SSOT 收敛项、明确 crash/race/资源泄漏类修复均有低风险方案；涉及产品语义的行为类问题（群聊 mention 权限、Room CAS 接线、跨 Hub 取消传播等）只记录不修改。

**推荐优化顺序**：Relay 进程级加固 → A2A/Hub 并发与泄漏修复 → SSOT 常量收敛 → Web 死代码清理 → API 类型契约下沉 shared。

---

## 2. Baseline（修改前，全部 PASS）

| 命令 | 结果 |
|---|---|
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS（2 个 pre-existing warning：react/jsx-no-literals） |
| `pnpm typecheck` | PASS |
| `pnpm test`（shared+relay+server） | PASS（server 178 项） |
| `pnpm build` | PASS |
| `pnpm test:e2e` | PASS（19 项） |
| `cargo test` / `cargo check` | PASS（0 个 Rust 测试存在） |

---

## 3. 问题清单

> 格式：`[P?] 标题`。每项含位置/现象/维度/影响/修复方案/风险/**本轮处理**。
> 维度取值：Correctness / Security / Concurrency / Architecture / Maintainability / Testing / AI-Human readability。
> 本轮处理取值：**Fixed**（本轮修复）/ **Not Fixed（功能问题，超出纯代码优化范围）** / **Not Fixed（风险>收益）** / **Partially Fixed**。

### P0 Critical

#### [P0-1] Relay：未认证 WS 帧可触发未捕获异常，远程崩溃整个 Relay 进程

- **位置**：`packages/relay/src/ws/handler.ts:174-188`（注册分支在 try 块外，try 从 :211 才开始）；`packages/relay/src/auth.ts:125`（`token.split(".")`）
- **现象**（已主审计人逐行复核）：未注册 socket 发送 `{"type":"register","hubId":"<任意已注册hubId>"}`（缺 token）→ `registry.get(message.hubId)` 命中短路 → `verifyHubToken(undefined, ...)` → `authenticatedHubClaims` 内 `token.split(".")` 抛 TypeError。该异常在 ws message 监听器内、try 之前抛出；ws@8 对 message 事件裸 emit，`index.ts` 无 `uncaughtException` 处理器 → Node 默认进程退出。攻击者可先经 REST 注册自己的 hub 拿合法 hubId，再用缺 token 帧无限打死进程（持久 DoS）。
- **维度**：Security / Correctness
- **修复**：注册分支前加 `typeof hubId === "string" && typeof token === "string"` 守卫；整个 message 处理（含注册分支）包进 try/catch，catch 内 close。
- **风险**：Low　**本轮处理**：**Fixed**（Batch 1）

#### [P0-2] Relay：WS 未设 maxPayload（默认 100MiB）+ offline_messages 单帧全量下发，构成资源耗尽与投递死循环

- **位置**：`packages/relay/src/index.ts:63`（`app.register(websocket)` 未传 options）；`handler.ts:200-206`（注册时把全部离线消息序列化进单个 `offline_messages` 帧，默认最多 1000 条 × 256KB）
- **现象**：应用层 256KB 限制在 `JSON.parse` 之后才执行，帧级别无防护，未认证连接在 10s 注册窗口内可发数个 ~100MB 帧。另一侧：离线帧可达 250MB，超过客户端 ws 默认 100MiB 上限时客户端 1009 断连 → 重连 → 再收同帧 → 死循环，离线消息 TTL 内永远无法投递。
- **维度**：Security / Correctness
- **修复**：offline_messages 分帧下发（客户端 `relay-client.ts:353-354` 逐帧独立处理，多帧天然兼容，已验证）；`app.register(websocket, { options: { maxPayload } })` 设帧上限（覆盖分帧后的合法帧并留余量）。
- **风险**：Low（协议 additive，旧客户端按帧处理不受影响）　**本轮处理**：**Fixed**（Batch 1）

#### [P0-3] A2ABus 并发计数器在 finally 中"恢复进入时快照"而非递减：既可绕过 maxConcurrency 也可永久泄漏计数

- **位置**：`packages/server/src/agent/a2a-bus.ts:147`（读 active）、`:176`（set active+1）、`:240-241`（finally `if (active === 0) delete else set(toAgentId, active)`）
- **现象**（已主审计人逐行复核）：c1(a=0)、c2(a=1) 并发 → map=2；c1 先退出执行 delete（c1 的 active===0）把 c2 的计数抹掉，c2 退出再 set(…,1) → 0 个活跃调用却残留计数 1。三并发交错时新调用读到偏低计数被放行（实际并发超限）。`maxConcurrency` 是防止同一 CLI Agent 被打爆的唯一闸门，该缺陷使闸门双向失效。
- **维度**：Concurrency / Correctness
- **修复**：finally 改为真正递减：`const next = (this.concurrency.get(toAgentId) ?? 1) - 1; next <= 0 ? delete : set(next)`。
- **风险**：Low（纯计数修正）　**本轮处理**：**Fixed**（Batch 2）

### P1 High

#### [P1-1] 群聊 @mention 转发链完全绕过 a2aPolicy 权限检查

- **位置**：`packages/server/src/agent/runtime.ts:421-484`（routeAgentMessage → routeMessageToAgent → streamReply，全程不经 a2a-bus）；`runtime.ts:819-861` authorizeA2A 只被 `a2a-bus.ts:89` 调用
- **现象**：群聊 mention 模式下 Agent A 回复中 `@B` 仍会被无条件转发给 B，`deny`/`confirm` 权限对这条最常用路径不生效（默认 a2aMode 即 "mention"）。现有测试只覆盖 bus 路径（runtime.test.ts），掩盖了缺口。
- **维度**：Security（权限模型在默认路径失效）
- **真实影响**：deny 模式下群聊 A2A 协作仍会发生；confirm 模式不弹确认。
- **修复方案**：routeAgentMessage 开头补一次 authorizeA2A（deny 拦截、confirm 复用 pendingA2AConfirmations 机制）。
- **风险**：Low（deny 拦截/confirm 弹确认即该功能的文档语义）　**本轮处理**：**Fixed**（F3 批次：routeAgentMessage 接入 authorizeA2A，权限检查先于轮次计数；新增 deny 模式下 mention 转发被拦截的单测）

#### [P1-2] 接收端幂等去重仅内存 LRU（1000 条），且 rememberMessage 在信任/签名校验之前执行

- **位置**：`packages/server/src/hub/message-router.ts:57`（`seenMessageIds = new Set`）、`:257-258`（去重入口先于 trust 检查）、`:751-756`（FIFO 淘汰上限 1000）；对照 `packages/relay/src/ws/handler.ts:199-206`（每次注册重发全部未 ack 离线消息）
- **现象**：执行中崩溃重启后 Relay 重发同一 envelope，去重集随进程消失 → a2a_call/chat 重复执行；7 天 TTL 内单 peer 超 1000 条即淘汰旧 id，此后任何重发再次执行。且不可信 Hub 可在签名校验前刷 id 挤掉真实近期 id。
- **维度**：Correctness（At-least-once transport → multiple business execution）/ Security
- **修复方案**：已处理 envelope.id 持久化（`processed_envelopes` 表 + 复用现有 purge 定时器）；rememberMessage 移到信任+签名校验后。
- **风险**：Low（新增 additive 表）　**本轮处理**：**Fixed**（顺序修复 + `processed_envelopes` 持久化去重表，启动加载、写入记忆、随离线 TTL 清理；实机验证 14 条记录落库）

#### [P1-3] 发送端离线队列纯内存 + offline 短路绕过 Relay：发送端重启即永久丢消息

- **位置**：`packages/server/src/hub/offline-store.ts:20`（`messages = new Map`，无持久化）；`message-router.ts:393-399`（`offlineHubIds.has(toHubId) && !hasP2PConnection` 短路使 `sendEnvelope` 根本不被调用——Relay 的离线库在最需要的场景被绕过）
- **现象**：给离线设备发消息 → 只进本地内存 Map → 进程重启/升级 → 消息永久丢失，无 TTL、无补偿路径。
- **维度**：Correctness（数据丢失）
- **修复方案**：去掉短路总是走 Relay；或将 OfflineStore 落 SQLite（接口已足够窄：queue/markDelivered/markSettled/markComplete/getPendingForHub）。
- **风险**：Low　**本轮处理**：**Fixed**（F2 批次：去掉 offline 短路，总是 sendEnvelope——Relay 为离线对端落库存储；本地队列仅作发送失败补偿。实机验证：对端断开→消息入 Relay 离线库→重连→投递→执行→响应回传全闭环）

#### [P1-4] Room revision CAS 链路整体未接线；relay CAS 内存态且语义与本地不兼容

- **位置**：`packages/server/src/hub/relay-client.ts:113-142`（`roomCas()` 全仓库零调用者）；`routes/hub.ts:275、314`（增删 Room agent 仅本地 `incrementRoomRevision`）；`packages/relay/src/room-cas.ts:7`（CAS 状态内存 Map，重启回 `{1,1}`）、`:26`（强制 `newKeyEpoch === expectedKeyEpoch + 1`，与本地只加 revision 的语义冲突）
- **现象**：两台 Hub 并发对同一 Room 变更，各自本地 +1 产生分叉 revision；resync 收敛规则是"较高 revision 后到者胜"，一方成员变更被静默覆盖；snapshot 不含成员数据、`agent_added` 事件从不生成，成员复制不闭环。
- **维度**：Architecture / Correctness（split-brain）
- **修复方案**：增删 agent 改为 relay CAS 成功后再落库并写事件；relay CAS 状态持久化并放宽锁步约束。
- **风险**：High（协议语义变更 + 存量 revision 对齐）　**本轮处理**：**Not Fixed**（经评估保留：CAS 接线属协议级功能开发而非缺陷修复，需要独立设计窗口（revision 对齐策略、Relay 不可达降级、双端并发验证）；当前实际风险已通过 F2 批次的 resync 房间授权 + keyEpoch 闭环收敛）

#### [P1-5] keyEpoch/rekey/群组密钥全部为死代码：blocked member 旧 key 与旧 OwnerProof 永久有效

- **位置**：`packages/server/src/hub/group-crypto.ts:64-181`（GroupKeyManager 仅测试引用，消息加密实际全走 pairwise crypto_box）；`db/repository.ts:775-786`（`incrementRoomKeyEpoch` 零调用者）；block 路径 `routes/trust.ts:48-53` 不触碰 Room/keyEpoch
- **现象**：文档承诺的 keyEpoch 轮换无任何实现支撑；被移除成员的 OwnerProof 因 keyEpoch 永不递增而永久通过校验（`owner-proof.ts:36` 的拒绝逻辑形同虚设）。
- **维度**：Security（前向保密缺失）/ Architecture（死代码伪装成能力）
- **修复方案**：最小闭环是在移除 Room agent / block hub 时调用已存在的 `incrementRoomKeyEpoch`。
- **风险**：Low　**本轮处理**：**Fixed**（最小闭环：移除 Room agent 时递增 keyEpoch，旧 epoch OwnerProof 即刻失效；实机验证 revision 4/keyEpoch 2 递增。群组密钥 GroupKeyManager 仍未接线——待 P1-4 CAS 落地时一并处理）

#### [P1-6] Windows 下 CLI argument 模式存在命令注入面（`shell:true` + 消息拼入参数）

- **位置**：`packages/server/src/agent/adapters/cli.ts:455-462`：`spawnArgs = [...args, message]`，`spawn(cfg.command, spawnArgs, { shell: process.platform === "win32" })`
- **现象**：Windows 上 `shell:true` 时 Node 把 command+args 拼成 cmd 字符串，message（用户消息或对端 Agent 生成的 A2A handoff 文本，跨 hub 时来自远端不可信对端）中的 `&`、`|`、`>`、`"` 会被 cmd 解释。A2A 场景等于允许远端模型输出在本地 Windows 触发任意 shell 命令。
- **维度**：Security（命令注入）
- **修复方案**：Windows 上避免 `shell:true`（复用 `resolveCommandPath` 的 PATHEXT 解析，cli.ts:265-287 已有现成逻辑），或对 message 做严格转义并强制 stdin 模式。
- **风险**：Medium（需 Windows 真机回归 .cmd 包装的 CLI；本环境无法验证）　**本轮处理**：**Not Fixed（修复需 Windows 实机验证，环境限制；强烈建议发布 Windows 版前处理）**

#### [P1-7] plugins：单个坏 plugin.json 阻断整个后端启动

- **位置**：`packages/server/src/plugins/loader.ts:22-38`（JSON.parse 失败/manifest 无效/entry 越界/导出非法一律 throw）；`index.ts:106` loadPlugins 在 main() 内，异常 → `process.exit(1)`
- **现象**：plugins 目录里任何一个坏 manifest 都能让桌面后端起不来（桌面壳照常启动，webview 永远连不上 3210）。
- **维度**：Correctness（crash）/ Maintainability
- **修复**：单插件失败降级为 log + skip，其余插件继续加载。
- **风险**：Low（合法插件行为不变）　**本轮处理**：**Fixed**（Batch 2）

#### [P1-8] 带 scheduled task 的会话删除必 500（FK）；删除路径与 Scheduler 内存态脱节

- **位置**：`packages/server/src/db/repository.ts:1055-1067`（deleteConversation 不删 scheduledTasks）；drizzle 0003 `scheduled_tasks.conversation_id REFERENCES conversations(id) ON DELETE no action`；`db/index.ts:30` PRAGMA foreign_keys=ON；删 Agent 同理：`repository.ts:580` 删了行但 Scheduler 内存 cron 不注销，继续周期触发已删除 agent 的任务
- **现象**：对存在定时任务的会话执行删除 → `FOREIGN KEY constraint failed` → 500，会话永远删不掉；删 Agent 后 cron 空转报错直到重启。
- **维度**：Correctness / Concurrency
- **修复方案**：deleteConversation 事务内先删 scheduledTasks 并通知 Scheduler 取消；Scheduler 暴露 `cancelByAgent/cancelByConversation`。
- **风险**：Low　**本轮处理**：**Fixed**（F1 批次：deleteConversation 事务内先删 scheduledTasks；Scheduler 新增 cancelByConversation/cancelByAgent 并接入会话/Agent/批量删除路由。实机验证：删除持有任务的会话返回 200（修复前必 500），任务与内存 cron 同步消失）

#### [P1-9] Scheduler 重叠执行无互斥：短周期任务叠加长 LLM 调用导致并发重复执行

- **位置**：`packages/server/src/scheduler/index.ts:88-101`（cron 回调 `void this.runtime.handleUserMessage(...)` 即返回，无 in-flight 保护）
- **现象**：任务执行时间长于 cron 间隔时（LLM 调用普遍如此），同一任务并发多跑：消息重复、token 重复消耗、会话状态交叉。
- **维度**：Concurrency（double execution）
- **修复**：`runningTasks: Set<string>`，触发时已在跑则记 skipped。
- **风险**：Low（标准互斥语义；重叠执行本身即缺陷）　**本轮处理**：**Fixed**（Batch 2）

#### [P1-10] 迁移双轨制 schema drift：drizzle 快照与真实迁移链脱节，`drizzle-kit generate` 链路已坏

- **位置**：`packages/server/src/db/index.ts:32-44`（migrate() 之后又跑 12 个手写 ensure\* 补丁）；conversations 的 revision/key_epoch/management_state/metadata/a2a_policy、agents 的 credential_ref/capabilities 等、整表 trusted_hubs/client_tokens/room_state_events 只靠运行时补丁创建，而 `meta/0010_snapshot.json` 已包含它们 → drizzle-kit 视为已迁移不再生成；`meta/0009_snapshot.json` 文件缺失，快照链断裂
- **现象**：下次 `drizzle-kit generate` 会重复输出 ensure\* 已做的事；schema 演进依赖两条并行机制，极易漂移。
- **维度**：Maintainability / Correctness（迁移）
- **修复方案**：生成收口迁移把 ensure\* DDL 落进 SQL，删除 ensure\*，补回快照链。
- **风险**：Medium（需对存量 DB 做 up/down 验证）　**本轮处理**：**Not Fixed（风险>收益：迁移链重建需专门验证窗口）**

#### [P1-11] Tauri 无单实例保护 + sidecar 崩溃无重启 + 退出硬杀绕过优雅关闭

- **位置**：`src-tauri/src/lib.rs:94-101`（端口硬编码 3210）、`:59-65`（Terminated 只清 child 不重启）、`:87-91`（kill 走 SIGKILL，server 的 SIGTERM 优雅关闭 index.ts:276-292 永远不执行）；Cargo.toml 无 single-instance 插件
- **现象**：双实例互踩（第二个实例 webview 连到第一个实例的 server，退出时共享 server 被杀）；Node 侧任何 uncaughtException 即整服务死亡且不自愈；无 ready 探测。
- **维度**：Correctness（进程生命周期）
- **修复方案**：single-instance 插件（新增依赖，任务规则不允许无依据引入）或端口探测；Terminate 后延迟重启（带上限）+ 健康探测。
- **风险**：Medium　**本轮处理**：**Not Fixed（风险>收益：桌面生命周期重构需真机验收，且修复需新增依赖）**

#### [P1-12] 取消"用户→远端 Agent"消息是 no-op；跨 Hub 无取消/超时传播；用户直发远端路径忽略 callTimeoutMinutes

- **位置**：`runtime.ts:364-419`（routeMessageToRemoteAgent 从不注册 controllers，signal 是永远无法 abort 的新建 AbortController）；`message-router.ts:462-469`（入站 context 无 signal，协议无 cancel 消息类型）；`runtime.ts:390-394`（未传 a2aCallTimeoutMs，恒 5min 默认，用户配置的 30min 失效）
- **现象**：用户点取消，远端调用继续跑满超时；发起侧超时后对端 Agent 继续执行到自然结束（迟到响应处理是安全的——settlePending 先删再 resolve，无 double-resolve）。
- **维度**：Correctness（cancel/timeout 语义）/ 资源浪费
- **修复方案**：入站 controller 注册 + 新增 `a2a_cancel` 协议消息（需 payload-compat 同步）；timeout 透传一行可修。
- **风险**：Low（a2a_cancel 为 additive 协议消息，旧对端忽略）　**本轮处理**：**Fixed**（F2 批次：routeMessageToRemoteAgent 注册 controller（用户取消真正生效）+ 透传 callTimeoutMinutes；新增 `a2a_cancel` 协议消息——发起侧 abort 时通知对端中止执行，对端按 correlationId 中止入站调用）

#### [P1-13] Web：agent 状态事件驱动的三组真实缺陷（引用不稳定是共同根因）

- **位置与现象**：
  1. `agentStore.ts:132-139` updateAgentStatus 对每条 agent_status 事件都返回新数组+新对象引用（无论是否变化）。
  2. `GroupMemberList.tsx:92-96` effect 依赖 `[agents,...]` → 流式回复期间每条状态事件触发 3 个 API 请求（请求风暴）。
  3. `useAgentSettings.ts:41-54` effect 依赖 `[agent]` → 用户正在编辑表单时，目标 agent 的状态事件（online→busy）会把表单重置为 store 值，未保存输入丢失。
- **维度**：Correctness / 性能
- **修复**：updateAgentStatus 无变化早退返回原引用（零行为变化，一行守卫）；2/3 的 effect 依赖收敛属 UI 行为修复。
- **风险**：引用稳定性 Low　**本轮处理**：**Fixed**（引用稳定性修复（Batch 4）+ F4 批次修复表单重置：useAgentSettings 依赖收敛为 agentId，经 getState 读取初始值——agent 状态事件（流式期间每 chunk 一条）不再清空未保存编辑）

#### [P1-14] Web：A2A mode 同一状态三处独立维护且互不同步

- **位置**：`Conversation.a2aMode`（shared 类型已随 GET /conversations 返回，无人使用）；`ChatArea.tsx:103-141` local state 自行 `api.getA2AMode()`；`PrivacySettings.tsx:50-51,100-108` 又一份，对前 20 个会话逐个拉取
- **现象**：两个入口显示矛盾的 A2A 模式，直到各自重新 fetch。
- **维度**：Maintainability（状态所有权）/ Correctness（脏读）
- **修复方案**：统一到 `Conversation.a2aMode` + `syncConversation` 通道。
- **风险**：Low　**本轮处理**：**Fixed**（F4 批次：统一以 `Conversation.a2aMode` 为唯一来源，ChatArea/PrivacySettings 派生展示 + 乐观 syncConversation；删除两处独立的 per-conversation 拉取（顺带消除 PrivacySettings 的请求风暴））

#### [P1-15] Relay：频率限制只覆盖 "message" 帧，其他已认证帧不限速

- **位置**：`packages/relay/src/ws/handler.ts:226-230`（exceedsRateLimit 仅在 message 分支内）
- **现象**：`transport_receipt` 每帧 Ed25519 验签、`contact_block` 每帧 DB upsert，均无限速——单 hub 可持续烧 CPU/打 DB。
- **维度**：Security（资源耗尽）
- **修复**：exceedsRateLimit 上移至 try 开头，对除 ping 外所有已认证帧统一计数。
- **风险**：Low（合法客户端控制帧频率远低于阈值）　**本轮处理**：**Fixed**（Batch 1）

### P2 Medium

#### [P2-1] A2A call timeout 上限/默认值三处独立定义；maxRounds 常量四处漂移源

- **位置**：`runtime.ts:25-27`（分钟，export）、`a2a-bus.ts:15-16`（毫秒，独立）、`hub/message-router.ts:25-27`（毫秒，独立）——默认 5min/范围 1-30min 当前数值恰好一致；`DEFAULT_A2A_MAX_ROUNDS=12`（runtime.ts:22）与 `cli.ts:42`、`openai.ts:59` 的 `DEFAULT_MAX_A2A_HANDOFFS=12` 三份；跨 Hub 校验 `message-router.ts:786` 用裸数字 `1..50` 不引用常量
- **维度**：Maintainability（SSOT）
- **修复**：a2a-bus/message-router 从 runtime 常量派生；adapters import 默认值；范围校验引用 MIN/MAX 常量。纯等值重构。
- **风险**：Low　**本轮处理**：**Fixed**（Batch 3）

#### [P2-2] 7 天离线 TTL、心跳 30s/10s、消息 32KB 限制等协议常量跨包多处 hardcode

- **位置**：TTL 四处（relay/offline-store.ts:7、server/hub/offline-store.ts:17、relay/room-manager.ts:11、relay/index.ts:26）；心跳三处（relay-client.ts:35-36、relay/ws/handler.ts:154-161、web/useWebSocket.ts:11-12）；32KB 两处（server/ws/handler.ts:16、routes/conversations.ts:29）；relay 启动 fallback 与各模块 DEFAULT_* 重复五处（relay/index.ts:26-37）
- **维度**：Maintainability（SSOT；运维改 TTL 会造成 Hub/Relay 行为分叉）
- **修复**：提升为 `@chorus/shared` 导出常量，各处引用（值全部不变）。
- **风险**：Low　**本轮处理**：**Fixed**（Batch 3）

#### [P2-3] Web 手工复制 server API 响应类型成规模双份维护，且 CatalogEntry 已实际漂移

- **位置**：`web/src/services/api.ts:41-93`（A2AMode/PairingSession/AgentMetrics/CredentialStatus/HubStatus 等）、`catalogStore.ts:8-37`（CatalogEntry：`platforms: string[]` vs server `CatalogPlatform[]`、`license: string` vs server `license?`、`adapterTemplate.type` 手写两值 vs shared `AgentType` 七值）、`schedulerStore.ts:5-16`（ScheduledTask 逐字段手抄 server `ScheduledAgentTask`）
- **维度**：Maintainability（类型漂移已在发生：类型系统对 catalog 数据给出错误保证）
- **修复**：响应 DTO 下沉 `@chorus/shared`，server/web 两侧引用，顺手修正 web 三处漂移（类型级，无运行时变化）。
- **风险**：Low　**本轮处理**：**Fixed**（Batch 5）

#### [P2-4] Web 死代码链（生产不可达）

- **位置**（引用已逐一 grep 验证）：
  - `A2AThread.tsx`（213 行）——唯一引用是 DEV-only fixture（MessageStatusFixture）；生产路径用 TaskTrackingCard
  - `AgentCard.tsx`——零引用
  - `agentStore.fetchGroupedAgents` + `AgentGroup` + `api.getUsersWithAgents`——零外部引用
  - `chatStore.deleteConversations` + `api.deleteConversations`——零外部调用（批量删除 UI 已删，链路残留）
  - `api.health/getCatalogEntry/scanCliDetections/getP2PDiscovered/addAgentToConversation/removeAgentFromConversation`——零调用方
  - ~35 个未使用 i18n 键（zh-CN/en 双份，含 batchDelete/p2p 系列与上述死链同批）
- **维度**：Maintainability / AI readability（A2AThread 尤其误导：让人以为它是生产渲染路径）
- **修复**：整链删除；fixture 中 A2AThread 用法替换为生产组件 TaskTrackingCard 后再删组件。
- **风险**：Low（全部经引用验证；e2e 走 route mock 不受影响，已核对 quality.spec.ts）　**本轮处理**：**Fixed**（Batch 4）

#### [P2-5] resync_request/response 不校验 Room 成员资格：已配对非成员可读/改写任意 Room 状态

- **位置**：`authorization.ts:29-65`（Room 校验仅覆盖 a2a_call/chat；resync 对任意 trusted hub 放行）；`resync.ts:72-98`（handleResyncRequest 返回任意 roomId 的 snapshot+事件）、`:100-118`（response 的 currentRevision 更大即无条件 setRoomState）
- **维度**：Security（越权读取/状态改写）
- **修复**：authorize() 为 resync 消息增加与 a2a 分支一致的房间成员校验（数据已存在：registry.isHubInRoom）。
- **实机回归中的连带发现与修复**（resync 授权依赖的 `roomHubMembers` 缓存存在三个预存缺口，此前使该缓存长期过时——这也导致**预存的反向跨 Hub a2a 调用被误拒**，本轮一并修复）：
  1. 建房方从不 `joinRoom`，本地成员缓存为空直到下次 Relay 重连（`routes/hub.ts` 建房路由补一行 joinRoom，与 accept 路由同模式）；
  2. 对端 join/leave 的 `room:event` 广播在客户端零订阅（`registry.ts` 补增量更新：join→add / leave→delete，事件自带 delta，零额外帧）；
  3. Relay 侧经 REST 接受邀请后，随后的 WS `room:join` 因 `wasAlreadyMember` 短路**从不广播 join 事件**（`relay/ws/handler.ts` 改为始终广播——成员变更信号）。
  以上三项已在本机双实例 + Relay 环境实证：建房→邀请→接受后**无需任何重连**，双向跨 Hub a2a 即时成功、resync 全通过（修复前实测被拒："Sender Hub is not a current Room member"）。
- **风险**：Low（合法 resync 只发生在房间成员之间；实机验证通过）　**本轮处理**：**Fixed**（Batch 2 + 实机回归补充修复）

#### [P2-6] Hub 入站消息并发处理不串行：同一 peer 消息乱序、ack 倒序

- **位置**：`message-router.ts:106-108`（每条 relay envelope `void processRelayEnvelope` 并发）；`p2p-listener.ts:220-229`、`:125-135` 同样；对照离线批量反而逐条 await（在线无序/离线有序，语义不一致）
- **维度**：Concurrency（消息顺序）
- **修复**：按 fromHubId 维护串行 promise 链（可只串行化验签→授权→去重段）。
- **风险**：Medium（时序语义变化；需防长 a2a 执行阻塞同 peer 后续消息）　**本轮处理**：**Not Fixed（风险>收益：分段串行化实现复杂，收益主要是防御性的）**

#### [P2-7] presence 抖动全量重发"delivered 未 settled"消息（含永无业务 ack 的控制消息）——实机复现为重连死循环

- **位置**：`hub/offline-store.ts:73-82`（delivered 也算 pending）；`message-router.ts:390-392`（所有 relay 出站消息入本地队列，含 delivery_ack/directory_*/resync_*——这些类型永不会被 settle）
- **现象**：对端每次上线，7 天内全部未 settled 消息整体重发；控制消息靠对端版本去重兜底。
- **实机证据（2026-08-27 双实例回归中捕获）**：控制消息积压后，一次 Relay 重启触发 presence 抖动 → 双方全量重发 → 撞 60 条/分钟限流 → 断连 → 再重发，形成**自维持死循环**（实测 581 次限流断连）。叠加 P1-2（重启清空去重集），Relay 离线库积压在每次重连时对已执行过的 a2a_call 重复执行。
- **维度**：Correctness（流量放大 + 重复执行风险面 + 自 DoS）
- **修复**：入队白名单化——仅 a2a_call/chat 进本地重发队列（控制消息在重连时本来就被各自流程重新发起：joinRoom/resync/directory，入队它们只有风暴没有收益）。
- **风险**：Low（已实机验证：白名单后 presence 抖动零限流、离线 a2a/chat 消息仍正常入队并在对端上线后投递）　**本轮处理**：**Fixed**（实机回归补充修复；P1-2 的持久化去重部分仍为 Not Fixed）

#### [P2-8] 离线状态机允许非法定型翻转；transport failed 直接写成业务终态 error

- **位置**：`hub/offline-store.ts:55-62`（markSettled 允许 accepted↔denied 互转）、`:65-70`（markComplete 允许 denied→done、queued→done）；`message-router.ts:138-139`（网络 failed → markComplete(error)，一次限流瞬断即批量判死消息）
- **维度**：Correctness（状态机）
- **修复**：markSettled 仅允许从 queued/delivered 进入；failed 分支回退 queued。
- **风险**：Low　**本轮处理**：**Fixed**（F2 批次：markSettled 仅允许 queued/delivered 进入；markComplete 不覆盖 denied；transport failed 回退 queued 重试（接收端持久化去重保证重发不重复执行）——同步更新语义锁定测试）

#### [P2-9] macOS keychain 写入经 argv 暴露 secret；file 回退加密密钥可由公开信息推导

- **位置**：`credential-store.ts:185-189`（`security add-generic-password -w <apiKey>`，本机任意进程 ps 可见；对比 Linux 路径已用 stdin）；`:443-445`（machineKey = sha256(hostname+username)，含身份私钥/Hub 私钥的 ~/.chorus/credentials.enc 拿到即解）
- **维度**：Security
- **修复**：macOS 改 `security -i` 交互模式 stdin 喂命令；file 回退混入每安装随机盐（需带版本迁移）。
- **风险**：Low（v1 旧文件经 legacy key 解密后自动迁移 v2）　**本轮处理**：**Fixed**（macOS stdin 路径（Batch 2）+ F5 批次 file 回退盐化：每安装随机盐（0600 独立文件）混入密钥派生，v1 文件透明迁移 v2——本机实测迁移+新旧凭据往返全通过）

#### [P2-10] scope 映射死分支：/api/messages/search 降级为 api:read；cleanup/credentials 绕过资源粒度

- **位置**：`middleware/auth.ts:43-45`（映射的是不存在的 `/api/search`；真实路由 `/api/messages/search` 落入兜底 api:read，与 /api/export 的 conversations:read 不一致）
- **维度**：Security（scoped token 权限过宽）
- **修复**：修正映射。**风险**：Low（收紧仅影响此前依赖错误放宽的调用方）　**本轮处理**：**Fixed**（F5 批次：`/api/messages/search` → conversations:read；`/api/credentials` → agents:read/write；`/api/cleanup` → conversations:write）

#### [P2-11] Repository God-class（1333 行/12 张表）+ 业务层越层开事务

- **位置**：`db/repository.ts:71`（唯一数据访问点，混入身份密钥管理/远程 agent 策略/owner 快照等业务规则）；`hub/directory.ts:128` 直接伸手进 `repository.context.sqlite.transaction` 在外层组事务
- **维度**：Maintainability / Architecture
- **修复**：按表拆分聚合 + 公开 `transaction(fn)` API。风险 Low 但工作量大、回归面广。　**本轮处理**：**Not Fixed（风险>收益：纯机械拆分 1333 行的回归面超过本轮可验证范围）**

#### [P2-12] adapters 真实重复代码块：SSE 读取循环 ×4、A2A 调用执行器 ×2（~80 行）、caller-context 增强 ×2

- **位置**：`custom.ts:114-152`/`dify.ts:73-116`/`langchain.ts:128-163`/`openclaw.ts:55-89`；`cli.ts:367-445` vs `openai.ts:262-343`；`cli.ts:349-365` vs `openai.ts:97-109`
- **维度**：Maintainability（cancellation/超时/错误语义靠平行代码维持一致，已是多处漂移的温床）；另 dify/custom/openclaw/langchain 未实现 handleA2ACall，能被列进目录却不能作为 A2A 目标
- **修复**：抽 BaseAdapter 公共执行器与 sseLines helper；提供默认 handleA2ACall。
- **风险**：Medium（行为逐字节等价需仔细核对 + 新增默认行为属功能扩展）　**本轮处理**：**Not Fixed（风险>收益：合并两套执行器的等价性核对成本超过本轮收益；默认 handleA2ACall 属新增功能）**

#### [P2-13] 两套互不相同的 A2A 系统 prompt + skill 文档承诺未实现

- **位置**：`cli.ts:621-634` 自带 4 行 prompt；`chorus-skill.ts:119-129` 完整版仅 openai.ts 使用（:6-9 注释已过期失实）；`:45` 承诺"每次最多调用 3 个不同 Agent"无 enforcement
- **维度**：Correctness（同一会话内 CLI 与 OpenAI Agent 遵循不同协作规则）/ AI readability
- **修复**：cli.ts 改 import chorus-skill 实现（注意：会改变发往 CLI 的 prompt 内容，属行为变化）。
- **风险**：Medium（prompt 变化影响 CLI 输出）　**本轮处理**：**Not Fixed（功能问题（prompt 内容变更），超出纯代码优化范围；仅修正过期注释）**

#### [P2-14] CLI 子进程 this.child 单字段被并发覆写；terminate 不杀进程树

- **位置**：`cli.ts:224`（单一 child 字段）、`:463`（每次 runCli 覆写）、`:675-681`（terminate 仅对直接 child SIGTERM→SIGKILL，无进程组 kill）
- **现象**：bus 允许对 busy Agent 发起 A2A 调用 → 同一 adapter 并发两个 child：第二个覆写引用，第一个 finally 置 null，destroy() 大概率杀不到任何进程；CLI 的孙进程（git/node）在超时/取消后成为 orphan。
- **修复**：this.child 改 `Set<ChildProcess>`（引用管理修复，零 spawn 语义变化）；进程组 kill（detached + process.kill(-pid)）会改变所有 CLI 的 spawn 语义。
- **风险**：Set 化 Low；进程组 Medium　**本轮处理**：**Partially Fixed**（Set 化完成；进程组 kill 标记 Not Fixed（Windows 差异 + spawn 语义变化无法本机全量验证））

#### [P2-15] Web：切会话整体重建 WebSocket；tool_call_start/a2a_response 事件重放非幂等；REST fallback fetchMessages 覆盖进行中的流

- **位置**：`useWebSocket.ts:316-331`（依赖 currentConversationId → close+重连+重 subscribe，切换瞬间流式回复被丢弃）；`chatStore.ts:345-356`（startA2AThread 无条件覆盖，重连补发会把已完成线程打回 running）；`chatStore.ts:325`（fetchMessages 全量覆盖 messages）
- **维度**：Correctness（UI 数据一致性）
- **修复**：常驻 socket + subscribe 切换；thread 状态守卫 + eventId 去重；fetch 合并而非覆盖。
- **风险**：Low　**本轮处理**：**Partially Fixed**（F4 批次：tool_call_start 重放幂等（已完成线程不被打回 running）+ fetchMessages 按 id 合并保留进行中的流（不再整体覆盖）；常驻 socket + subscribe 切换仍保留为后续项（涉及订阅管理重构））

#### [P2-16] Web：Sidebar.tsx（1225 行）承担 12 项职责（配对向导/建群/首会话引导/联系人/…）；trust 列表三处独立 fetch；conversations 三分数组 5 处重推导（排序规则两份实现）

- **位置**：`Sidebar.tsx:88-298,994-1101,1102-1217` 等；`PrivacySettings.tsx:74-85`、`GroupMemberList.tsx:65-69`；`chatStore.ts:102-106` vs `Sidebar.tsx:219-225`
- **维度**：Maintainability / AI readability
- **修复**：按业务域机械拆分（AddFriendDialog/CreateGroupDialog）、trustStore、派生 selector。
- **风险**：Low-Medium（拆分面大，e2e 覆盖有限）　**本轮处理**：**Not Fixed（风险>收益：本轮聚焦零行为变化的清理；拆分建议保留为后续独立批次）**

#### [P2-17] server hub/agent/db 存在 type-only 双向引用（无运行时循环）

- **位置**：`hub/message-router.ts:8-9` ↔ `agent/runtime.ts:18-19`/`a2a-bus.ts:5-6`；`db/repository.ts:21` ↔ `hub/trust-store.ts:2`
- **维度**：Architecture（分层方向模糊的早期信号）
- **修复**：共享类型抽到 types 文件。　**本轮处理**：**Not Fixed（无运行时影响，收益低）**

#### [P2-18] 客户端消息重试无幂等（saveMessage 裸 INSERT）

- **位置**：`db/repository.ts:1104-1121`（无 onConflictDoNothing）；`runtime.ts:275`（WS clientMessageId 直接当 DB 主键，同 id 重试 → UNIQUE 异常 500，换 id → 重复）
- **维度**：Correctness（幂等）
- **修复**：saveMessage 改 onConflictDoNothing 返回 bool，调用方据此决定是否发布事件。
- **风险**：Low　**本轮处理**：**Fixed**（F1 批次：saveMessage 改 onConflictDoNothing 返回是否插入；同一 clientMessageId 重试不再重复执行 Agent）

### P3 Low

| # | 问题 | 位置 | 本轮处理 |
|---|---|---|---|
| P3-1 | Relay TTL 过期消息在清理间隙仍被投递（getForHub 不滤 expiresAt） | relay/offline-store.ts:51-57 | **Fixed**（Batch 1，加 `gt(expiresAt, now)`） |
| P3-2 | 大小限制按 UTF-16 字符数计（CJK 实际可达标称 3 倍） | relay/ws/handler.ts:217、offline-store.ts:21 | **Fixed**（Batch 1，改 Buffer.byteLength） |
| P3-3 | room_cas 帧缺 roomId 时 `message.roomId.length` 抛 TypeError 被静默吞（客户端只能等 10s 超时） | relay/ws/handler.ts:288-291、:333-345 | **Fixed**（Batch 1，validRoomCasMessage 前置 typeof 守卫） |
| P3-4 | logs 路由 zod enum 与 shared LOG_LEVELS/LogSource 双份 | server/routes/logs.ts:6-7 | **Fixed**（Batch 3，复用 shared 元组） |
| P3-5 | web 在已 import shared 的文件里重定义 A2AMode | web/services/api.ts:41 | **Fixed**（Batch 3，re-export shared） |
| P3-6 | useWebSocket switch 无穷尽性检查，`typing` 事件被静默丢弃 | web/hooks/useWebSocket.ts:77-246 | **Fixed**（Batch 5，显式 no-op case + exhaustive check，不新增 UI 行为） |
| P3-7 | chatStore 三份几乎相同的"删除后选下一条会话"推导（purge 缺 targetMessageId 重置） | chatStore.ts:646-669/711-734/788-804 | **Fixed**（Batch 4，合并内部函数，统一含 targetMessageId 重置——与 delete 行为对齐） |
| P3-8 | Sidebar 首次会话引导绕过 store 重复实现 createConversation | Sidebar.tsx:183-213 | **Not Fixed**（行为微变（store 版多空会话去重），留待 UI 批次） |
| P3-9 | message-router deliveryListeners 在超时/abort 路径泄漏（settlePending 不清理） | message-router.ts:412-418、:685-693 | **Fixed**（Batch 2） |
| P3-10 | runtime a2aResults 在异常中断的 A2A 线程上泄漏（量级小无上界） | runtime.ts:774、:797-816、:603-609 | **Not Fixed**（需 parentMessageId→threadId 映射改造，收益低） |
| P3-11 | destroy 退订不完整 + outboundPayloadByEnvelope/pairing sessions 慢泄漏 | message-router.ts:106-119、:230-235、pairing-service.ts:93 | **Not Fixed**（destroy 仅进程退出调用，实际影响有限） |
| P3-12 | 本地 block 未同步 Relay（contact_block 已实现未发送）；P2P 审批不持久化；directory 版本重启回退 | routes/trust.ts:48-53、routes/hub.ts:39、hub/directory.ts:19 | **Fixed**（F2 批次：block 时发送 contact_block（relay 停存对端离线消息）；P2P 审批落 settings；directory 版本持久化防重启回退） |
| P3-13 | relay 直达消息不验证收件人存在性（离线库可被伪造 to 填充，N×1000×256KB 存储放大） | relay/message-router.ts:44-48 | **Not Fixed**（会改变"发往未注册 hub 先排队"语义，需产品确认） |
| P3-14 | relay db 迁移为 ad-hoc CREATE IF NOT EXISTS + 手工 ALTER（无 migration runner）；rooms/invitations 行永不删除 | relay/db/index.ts:15-79、room-manager.ts:236-245 | **Not Fixed（迁移机制重建，风险>收益）** |
| P3-15 | FTS 每次启动全量 rebuild；userHubs 缺 (user_id,hub_id) unique；roomStateEvents 孤儿行 | db/index.ts:267、schema.ts:15-26 | **Not Fixed**（各有边界条件，收益低） |
| P3-16 | probe/path-scanner 超时只 SIGTERM 无升级；catalog download recipe 无 checksum；插件 name 无重复检测/permissions 装饰性 | probe.ts:63-66、catalog/installer.ts:243-248、plugins/loader.ts:51-66 | **Not Fixed**（记录待办） |
| P3-17 | WS token 走 URL query（会进日志/历史） | server/ws/handler.ts:116 | **Not Fixed**（本地场景影响小，协议变更） |
| P3-18 | docker-compose 无 healthcheck；.env.example 占位符恰好 33 字符能通过 ≥32 检查 | docker-compose.yml、.env.example:3 | **Not Fixed**（部署文档项；compose 路径有强制覆盖安全） |
| P3-19 | getWsUrl 生产漏配时静默指向 localhost；Sidebar 一处硬编码中文兜底绕过 i18n | web/services/env.ts:8、Sidebar.tsx:249 | **Not Fixed**（部署脚枪/文案项，留待 UI 批次） |
| P3-20 | shared/utils/env.ts 的 isTauri 等仅 web 使用 | shared/utils/env.ts:23-42 | **Not Fixed**（移动收益低） |
| P3-21 | 跨包重复的表单 load/error 六件套与 ErrorRetry JSX（12+ 处） | SettingsPanel/PrivacySettings/GroupMemberList/Sidebar/MessageList | **Not Fixed**（纯 UI 去重收益中、触面广，留待 UI 批次） |
| P3-22 | scheduler 无时区选项/停机不补跑/失败无 retry | scheduler/index.ts:88-101 | **Not Fixed**（语义设计，记录；重叠执行互斥已于 Batch 2 修复） |
| P3-23 | e2e 为纯前端门（全 API mock），无后端端到端；relay room-cas/room-manager、server offline-store/resync、db/repository 无直接单测 | e2e/quality.spec.ts 等 | **Not Fixed**（测试补充建议保留：优先 Repository 事务/幂等/FK 删除三组） |

### 明确排除项（按任务规则）

- 全部日志相关问题（日志内容/脱敏/持久化/level/库统一）：未列入任何修复。
- 纯风格项（命名、注释密度、行数本身）。
- 未发现的项（审计确认无问题，避免误报）：跨包 import 违规（零违规）、web→server 深路径引用（不存在）、MessageStatus 双份定义（web 用 shared）、secret 进入前端 bundle（不存在，`import.meta.env` 全部非机密）、JWT 实现（header 钉死/timingSafeEqual/authVersion 撤销均正确）、pairing 生命周期（TTL/一次性/MAC 校验完整）、P2P+Relay 双路径验签一致性（onEnvelope 唯一漏斗）、settlePending double-resolve 防护（正确）、Relay 重连指数退避（正确封顶 30s）、sidecar 父进程死亡自杀机制（正确）。

---

## 4. Optimization Plan（本轮执行）

| Batch | 目标 | 主要文件 | 改 Public Contract | 回滚方式 |
|---|---|---|---|---|
| 1 Relay 加固 | P0-1/P0-2/P1-15/P3-1/P3-2/P3-3：注册守卫+全量 try、maxPayload、offline 分帧、限流上移、过期过滤、byteLength、room_cas 守卫 | relay/ws/handler.ts、index.ts、offline-store.ts | 否（分帧为 additive，客户端逐帧处理已验证） | 单 commit revert |
| 2 并发与泄漏 | P0-3/P1-7/P1-9/P2-5/P2-9(macOS)/P2-14(Set)/P3-9：a2a-bus 计数、plugins 容错、scheduler 互斥、resync 授权、keychain stdin、child Set、listener 清理、rememberMessage 顺序 | server/agent/a2a-bus.ts、plugins/loader.ts、scheduler/index.ts、hub/authorization.ts、credential-store.ts、agent/adapters/cli.ts、hub/message-router.ts | 否 | 分文件 commit，逐个 revert |
| 2R 实机回归补充 | P2-5 连带缺口（建房即 join、room:event 增量更新、relay join 始终广播）+ P2-7（离线队列白名单）——均为实机双实例回归中发现并实证 | routes/hub.ts、agent/registry.ts、relay/ws/handler.ts、hub/message-router.ts | relay join 广播为 additive 信号（此前无人订阅） | 分文件 revert + 实机复验 |
| 3 SSOT 常量 | P2-1/P2-2/P3-4/P3-5：timeout/maxRounds/TTL/心跳/32KB/logs enum/A2AMode 收敛（值全部不变） | shared/constants.ts(新)、server+relay+web 各引用点 | shared 新增 export（additive） | 单 commit revert |
| 4 Web 清理 | P2-4/P1-13(引用稳定)/P3-7：死代码链+i18n 键删除、updateAgentStatus 稳定、next-conversation 合并 | web/store、services、components、locales | 否 | 单 commit revert |
| 5 类型契约 | P2-3/P3-6：API DTO 下沉 shared、web 漂移修正、exhaustive switch | shared/types/api.ts(新)、server 模块、web stores | shared 新增 export（additive）；server/web 内部 import | 单 commit revert |

每个 Batch 完成后：`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`，涉及 web 的加跑 `pnpm test:e2e`，涉及 relay 协议的加跑 relay 测试；全部 Batch 完成后跑完整回归（见 REGRESSION_TEST_REPORT.md）。

## 5. 状态汇总

修复完成后各问题状态已在上方各条目标注（Fixed / Partially Fixed / Not Fixed（功能问题） / Not Fixed（风险>收益））。

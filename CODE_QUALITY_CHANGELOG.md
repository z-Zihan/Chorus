# Chorus 代码质量优化变更记录

- 基线：`main @ 569b8e7`（工作区干净，质量门禁全绿）
- 完成日期：2026-08-27
- 总计：6 个 Batch（含实机回归补充批次），47+ 文件，净删除约 340 行
- 每批完成后均独立运行相关测试；全部完成后跑完整回归（见 REGRESSION_TEST_REPORT.md）

---

## Batch 1 — Relay 进程级加固

**修改内容**
1. 注册分支类型守卫（hubId/token 必须 string）+ 整个注册处理包进 try/catch：未认证畸形帧不再抛出 ws 监听器导致进程退出（P0-1）。
2. offline_messages 分帧下发（每帧 50 条）+ WebSocket `maxPayload: 32MB`：消除单帧可达 250MB 的下行帧与未认证连接的 ~100MB 帧缓冲向量（P0-2）。客户端逐帧独立处理，已验证兼容。
3. 频率限制上移：非 message/ping 的已认证控制帧（transport_receipt/contact_block/room:join 等）纳入 20× 限流窗口（默认 1200/分钟，覆盖离线追赶时的合法回执突发）（P1-15）。
4. getForHub 过滤 `expiresAt > now`：过期消息在清理间隙不再投递（P3-1）。
5. 大小限制改 `Buffer.byteLength`（UTF-8 字节数，此前 UTF-16 字符数使 CJK 内容实际可达标称 3 倍）（P3-2）。
6. room_cas 帧 roomId 前置 typeof 守卫：缺 roomId 不再抛 TypeError 被静默吞（P3-3）。

**涉及文件**：`relay/src/ws/handler.ts`、`relay/src/index.ts`、`relay/src/offline-store.ts`、`relay/src/ws/handler.test.ts`（新增回归测试）

**如何保证功能不变**：所有改动为防御性守卫与帧级拆分；合法客户端行为不变（分帧对客户端是 additive，控制帧限流阈值远超合法突发）。新增测试"rejects malformed registration frames without crashing the relay"证明畸形帧被拒绝且进程存活、后续合法注册成功。

**相关测试**：relay 19→20 项全过；typecheck/build 过。

**结果**：完成。

---

## Batch 2 — 并发计数、泄漏与容错

**修改内容**
1. `a2a-bus.ts` 并发计数 finally 改为真正递减（此前恢复进入时快照，并发下既会绕过 maxConcurrency 也会永久泄漏计数）（P0-3）。新增并发回归测试（已验证旧代码下失败、新代码通过）。
2. `message-router.ts` settlePending 终态时清理 deliveryListeners（超时/abort 路径此前永久泄漏条目）（P3-9）。
3. `message-router.ts` 入站去重（rememberMessage）移到信任+签名校验之后：不可信 Hub 不能再刷 LRU 挤掉真实消息 id（P1-2 部分）。
4. `plugins/loader.ts` 单插件加载失败降级为 log + skip（记录 loadErrors），坏 manifest 不再阻断整个后端启动（P1-7）。
5. `scheduler/index.ts` runningTasks 互斥：任务执行中跳过下一次触发，消除短周期 cron × 长 LLM 调用的并发重复执行（P1-9）。
6. `authorization.ts` resync_request/response 增加房间成员校验（与 a2a_call/chat 同一闸门）——已配对非成员不能再读/改写任意 Room 状态（P2-5）。
7. `credential-store.ts` macOS keychain 写入改 `security -i` stdin 模式：secret 不再出现在进程 argv（本机已实测含空格/引号/特殊字符的往返一致性 + 端到端 PATCH→剥离→写入→读回）（P2-9 部分）。
8. `cli.ts` 子进程引用 `child` 单字段改 `Set<ChildProcess>`：并发调用时后续 spawn 不再遮蔽前者、destroy() 能杀到全部活跃进程；destroy 复用既有 terminate()（SIGTERM→3s→SIGKILL）（P2-14 部分）。
9. `chorus-skill.ts` 修正过期注释（CliAdapter 并不使用该 prompt）。

**涉及文件**：`server/src/agent/a2a-bus.ts(+test)`、`hub/message-router.ts`、`plugins/loader.ts`、`scheduler/index.ts`、`hub/authorization.ts`、`credential-store.ts`、`agent/adapters/cli.ts`、`agent/chorus-skill.ts`

**如何保证功能不变**：计数修复为纯计数语义修正；listener 清理只影响已终结调用的迟到状态通知；去重后移只增加验签开销不改变合法消息处理；插件容错保持合法插件加载行为；调度互斥仅在任务仍在运行时跳过（标准语义）；keychain stdin 已实测往返一致；child Set 不改变 spawn 语义。

**相关测试**：server 178→179 项全过（新增并发回归）；auth/message-router/authorization 等既有测试全过。

**结果**：完成。

---

## Batch 2R — 实机回归中发现的链路修复

> 双实例 + 本机 Relay 实测中发现三个**预存缺口**（此前使房间成员缓存长期过时，并导致反向跨 Hub a2a 被误拒——实测证据"Sender Hub is not a current Room member"），以及一个**预存死循环**。均为 P2-5 授权修复的依赖项 / 实机复现的高危问题，一并修复：

**修改内容**
1. `routes/hub.ts`：建房后立即 `joinRoom`（与 accept 路由同模式）——建房方本地成员缓存不再为空直到下次重连。
2. `agent/registry.ts`：订阅 `onRoomEvent`（此前全仓零订阅者），按事件 delta 增量更新 roomHubMembers（join→add / leave→delete；零额外帧、天然无环——迭代中曾试过"收到事件后 re-join 刷新"，实测形成 A↔B 乒乓广播死循环，已改为纯增量方案）。
3. `relay/ws/handler.ts`：WS room:join **始终**广播 join 事件（此前 REST 接受邀请后 wasAlreadyMember 短路导致从不广播，成员变更信号丢失）。
4. `hub/message-router.ts`：出站离线队列白名单化——仅 a2a_call/chat 入队（控制消息 delivery_ack/resync_*/directory_* 永无业务 ack、每 presence 抖动全量重发，实测与 60/min 限流形成自维持断连死循环：581 次限流；控制流在重连时本就被各自流程重新发起）。

**涉及文件**：`server/src/routes/hub.ts`、`server/src/agent/registry.ts`、`relay/src/ws/handler.ts`、`server/src/hub/message-router.ts`

**如何保证功能不变**：以上均为修复预存缺陷使行为符合既有设计契约（成员缓存应及时反映成员变更；控制消息靠重连重发起而非 at-least-once 重发）。实机复验：建房→邀请→接受后**无任何手动重连**，双向跨 Hub a2a 即时成功、resync 全通过、presence 抖动零限流、离线 a2a 消息仍正常入队并在对端上线后投递闭环。

**相关测试**：message-router 3 项、relay 20 项、server 179 项全过；实机双实例矩阵通过（见回归报告）。

**结果**：完成。

---

## Batch 3 — 协议常量 SSOT 收敛（纯等值重构）

**修改内容**：新增 `shared/src/constants.ts` 作为协议级策略常量唯一来源：A2A 超时（默认 5min/范围 1-30min，原 server 三处独立定义）、maxRounds（默认 12/范围 1-50，原四处）、离线保留 TTL（7 天，原跨包四处）、心跳 30s/pong 10s（原三条 WS 链路独立）、消息内容 32KB（原 server 两处）。server/relay/web 全部改为引用（值一律不变）；logs 路由 zod enum 复用 shared `LOG_LEVELS`/新增 `LOG_SOURCES`；web `A2AMode` 改 re-export shared 同名类型；relay 启动 fallback 引用各模块 DEFAULT_* 常量。

**涉及文件**：`shared/src/constants.ts`（新）、`shared/src/index.ts`、`shared/src/utils/logging.ts`、`server/src/agent/{runtime,a2a-bus}.ts`、`adapters/{cli,openai}.ts`、`hub/{message-router,relay-client,offline-store}.ts`、`ws/handler.ts`、`routes/{conversations,logs}.ts`、`relay/src/{index,offline-store,auth,ws/handler}.ts`、`web/src/hooks/useWebSocket.ts`、`web/src/services/api.ts`

**如何保证功能不变**：所有常量数值逐一比对不变；仅改变来源。shared 新增 export 为 additive。

**相关测试**：全仓 typecheck + 全部 214 项测试过。

**结果**：完成。

---

## Batch 4 — Web 死代码清理与状态引用稳定性

**修改内容**
1. 删除零引用死代码链：`A2AThread.tsx`（213 行，唯一引用是 DEV fixture——fixture 改用生产组件 TaskTrackingCard）、`AgentCard.tsx`、`agentStore.fetchGroupedAgents`+`AgentGroup`+`api.getUsersWithAgents`、`chatStore.deleteConversations`+`api.deleteConversations`（批量删除 UI 已删的残留链路）、6 个零调用 API 方法（health/getCatalogEntry/scanCliDetections/getP2PDiscovered/addAgentToConversation/removeAgentFromConversation）、37 个未使用 i18n 键（zh-CN/en 双份，逐个 grep 验证含 e2e）。
2. `agentStore.updateAgentStatus/updateAgentStatuses` 无变化早退返回原引用：agent_status 事件（每流式 chunk 一条）不再制造新数组/对象引用，消除下游 effect/selector 的无效重触发（请求风暴根因；行为内容完全一致）。
3. `chatStore` 三份"删除会话后选下一条"推导合并为 `dropConversation`（删除/外部清理共用；统一补上 `targetMessageId: null` 重置，与 archive 语义对齐——原 delete/purge 均缺失）。

**涉及文件**：`web/src/components/message/{A2AThread.tsx(删),MessageStatusFixture.tsx}`、`agent/AgentCard.tsx(删)`、`store/{agentStore,chatStore,catalogStore,schedulerStore}.ts`、`services/api.ts`、`components/catalog/CatalogModal.tsx`、`locales/{zh-CN,en}/*.json`

**如何保证功能不变**：删除项全部经全仓引用 grep（含 e2e 与 fixture mock）确认零引用；引用稳定性修复在状态实际不变时返回原对象（内容等价）；合并推导逐行比对等价。

**相关测试**：web typecheck 过；e2e 19 项全过。

**结果**：完成。

---

## Batch 5 — API 类型契约下沉 shared

**修改内容**：新增 `shared/src/types/api.ts` 收纳 REST DTO（AgentMetrics、CredentialStatus、PairingSessionView、HubPeerStatus/HubStatusResponse、HubRoom、ScheduledAgentTask、CatalogEntry 系、InstallationStatus 系）——server 侧改为 import+re-export（保持原导出名），web 侧删除手抄副本改为 import。**顺手修正 web 已漂移类型**（CatalogEntry.platforms `string[]`→`CatalogPlatform[]`、license 必填→可选、adapterTemplate.type 两值→shared AgentType 七值；ScheduledTask.conversationId `string|null`→`string`）——均为类型级修正，使 web 类型与 server 实际返回一致。`useWebSocket` 事件 switch 补 `typing` 显式 no-op case + never 穷尽性检查（新事件类型漏处理将编译报错）。

**涉及文件**：`shared/src/types/api.ts`（新）、`shared/src/types/index.ts`、`server/src/agent/{metrics,persistence}.ts`、`hub/pairing-service.ts`、`scheduler/index.ts`、`catalog/{schema,installer}.ts`、`credential-store.ts`、`web/src/services/api.ts`、`store/{catalogStore,schedulerStore}.ts`、`components/catalog/CatalogModal.tsx`、`hooks/useWebSocket.ts`

**如何保证功能不变**：纯类型移动与 import 替换，无运行时代码变化；漂移修正使类型匹配真实数据（server 端本就按 shared 类型返回）。

**相关测试**：全仓 typecheck + 214 项测试 + e2e 19 项全过。

**结果**：完成。

---

## Batch F1 — 数据与生命周期（用户授权的功能修复）

**修改内容**
1. **P1-8 修复**：`deleteConversation(s)` 事务内先删 scheduledTasks（FK 不再 500）；Scheduler 新增 `cancelByConversation/cancelByAgent` 并接入会话删除/批量删除/Agent 删除路由（内存 cron 不再空转）。实机验证：删除持有任务的会话返回 200，任务与 cron 同步消失。
2. **P2-18 修复**：`saveMessage` 改 `onConflictDoNothing` 并返回是否插入；runtime 对同一 `clientMessageId` 的重试早退——不再重复执行 Agent、不再抛 UNIQUE 500。
3. **P1-2 完整修复**：新增 `processed_envelopes` 表（schema + ensure* 补丁，遵循仓库现行模式）；message-router 启动加载历史去重集、验签后记忆时写库、随离线 TTL 定期清理。重启 + Relay 离线重发不再重复执行。

**涉及文件**：`db/{schema,index,repository}.ts`、`scheduler/index.ts`、`routes/{index,conversations,cleanup,agents}.ts`、`agent/runtime.ts`、`hub/message-router.ts`
**测试**：server 179→180 项全过；实机验证通过。
**结果**：完成。

## Batch F2 — 跨 Hub 链路（用户授权的功能修复）

**修改内容**
1. **P1-3 修复**：去掉 offline 短路，总是 `sendEnvelope`——Relay 为离线对端落库存储（这正是 Relay 离线库的用途）；本地队列仅作发送失败补偿。实机验证：对端断开→消息进 Relay 离线库→重连→投递→执行→响应回传，全闭环。
2. **P2-8 修复**：离线状态机收紧（markSettled 仅 queued/delivered 可进、markComplete 不覆盖 denied）；transport failed 回退 queued 重试而非写成业务终态 error（接收端持久化去重保证重发不重复执行）。同步更新语义锁定测试。
3. **P1-5 最小闭环**：移除 Room agent 时 `incrementRoomKeyEpoch`——旧 epoch 的 OwnerProof 即刻失效。实机验证 revision/keyEpoch 同步递增。
4. **P1-12 修复**：routeMessageToRemoteAgent 注册 controllers（用户取消真正生效）+ 透传用户配置的 callTimeoutMinutes（不再恒 5 分钟默认）；新增 `a2a_cancel` 协议消息（additive，旧对端忽略）——发起侧 abort 时通知对端中止执行，对端按 correlationId 中止入站调用。
5. **P3-12 修复**：block 联系人时向 Relay 发送 contact_block（relay 停止为其保存/投递离线消息）；P2P 已批准设备落 settings（重启不再要求重新批准）；directory 版本号持久化（重启不再回退导致对端永久忽略更新/撤销）。

**涉及文件**：`hub/message-router.ts`、`hub/offline-store.ts`、`hub/relay-client.ts`、`hub/directory.ts`、`routes/{hub,trust,index}.ts`、`agent/runtime.ts`、`shared/types/hub.ts`
**测试**：server 180 项全过；实机双实例全链路验证（配对/Room/双向/离线投递/零拒绝/零限流）。
**结果**：完成。

## Batch F3 — A2A 语义（用户授权的功能修复）

**修改内容**
1. **P1-1 修复**：群聊 @mention 转发链接入 a2aPolicy——routeAgentMessage 在轮次计数前调用 authorizeA2A（auto 放行/deny 拦截/confirm 走既有确认 UI 流）。新增 deny 模式下 mention 转发被拦截的单测（与 auto 模式转发成功的既有测试互为对照）。
2. **P2-13 修复**：CliAdapter 改用 chorus-skill 的 `buildA2ASystemPrompt`（CLI 与 OpenAI Agent 现在遵循同一套协作规则，目录带 agent 名称）；skill 文案删除未实现的"每次最多 3 个 Agent"承诺，改为真实约束（环检测/深度 5/轮次预算）。

**涉及文件**：`agent/runtime.ts(+test)`、`agent/adapters/cli.ts`、`agent/chorus-skill.ts`
**测试**：runtime 9→10 项、agent 全组 26 项全过。
**结果**：完成。

## Batch F4 — Web（用户授权的功能修复）

**修改内容**
1. **P1-13 修复**：useAgentSettings 表单重置依赖收敛为 agentId——agent 状态事件（流式期间每 chunk 一条）不再清空未保存的表单编辑。
2. **P1-14 修复**：A2A mode 统一以 `Conversation.a2aMode` 为唯一来源——ChatArea/PrivacySettings 派生展示 + 乐观 `syncConversation`；删除两处独立的 per-conversation 模式拉取（顺带消除 PrivacySettings 打开期间随会话列表刷新的 20+ 请求风暴与 modesLoadFailed 死状态）。
3. **P2-15 部分修复**：`startA2AThread` 幂等（重放的 tool_call_start 不把已完成线程打回 running）；`fetchMessages` 按 id 合并（保留 sending/streaming/thinking 的本地消息与运行中的线程，REST fallback 不再整体覆盖进行中的流）。

**涉及文件**：`hooks/useAgentSettings.ts`、`components/layout/ChatArea.tsx`、`components/settings/PrivacySettings.tsx`、`store/chatStore.ts`
**测试**：web typecheck + e2e 19 项全过。
**结果**：完成。

## Batch F5 — 安全（用户授权的功能修复）

**修改内容**
1. **P2-10 修复**：scope 映射——`/api/messages/search` → conversations:read（与 export 一致，不再落入 api:read 兜底）；`/api/credentials` → agents:read/write；`/api/cleanup` → conversations:write。
2. **P2-9 完整修复**：file 凭据回退密钥盐化——每安装 32 字节随机盐（0600 独立文件）混入派生；文件格式 v1→v2，读取 v1（legacy key）成功后透明迁移为 v2 盐化密钥。本机实测：v1 旧文件读取→自动迁移→盐文件生成→新旧凭据往返全通过（含真实 dev server 启动路径，B 实例自动生成盐文件）。

**涉及文件**：`middleware/auth.ts`、`credential-store.ts`
**测试**：auth 10 项全过 + 迁移实测通过。
**结果**：完成。

## 仍不修复（F 批次后）

- **P1-4 Room CAS 接线**：属协议级功能开发（revision 对齐、Relay 不可达降级、双端并发验证），非缺陷修复，需独立设计窗口；实际风险已由 resync 房间授权 + keyEpoch 闭环收敛。
- **P1-6 Windows 命令注入**：需 Windows 实机验证，盲改可能弄坏全部 Windows CLI 执行——发布 Windows 版前必须处理。
- **P1-11 Tauri 生命周期**：需新增 single-instance 依赖 + 真机验收。
- **P2-6 入站串行化 / P2-11 Repository 拆分 / P2-12 adapters 合并 / P2-16 Sidebar 拆分 / P2-15 常驻 socket**：架构重构项，风险大于当前收益。
- **P2-13 相关**：群组密钥 GroupKeyManager 仍未接线（与 P1-4 耦合）。

## 未修复项汇总（原批次）

见 `CODE_QUALITY_AUDIT.md` 各条目 **Not Fixed** 标注。要点：
- **功能问题类（按任务规则记录不修）**：群聊 @mention 绕过 a2aPolicy（P1-1）、带定时任务的会话删除 FK 500 + Scheduler 不注销（P1-8）、发送端离线队列内存态+短路绕过 Relay（P1-3）、Room CAS 未接线/keyEpoch 死代码（P1-4/5）、Windows shell 注入（P1-6，需 Windows 实机验证）、跨 Hub 取消/超时传播（P1-12）、Web UI 行为类问题组（P1-13 部分/P1-14/P2-15）等。
- **风险>收益类**：迁移双轨 schema drift（P1-10）、Tauri 生命周期重构（P1-11）、Repository 拆分（P2-11）、adapters 执行器合并（P2-12）、入站串行化（P2-6）、scope 收紧（P2-10）等。
- **Partially Fixed**：P1-2（持久化去重未做）、P2-9（file 回退盐化未做）、P2-14（进程组 kill 未做）。

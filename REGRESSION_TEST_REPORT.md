# Chorus 回归测试报告

- 日期：2026-08-27
- Git Baseline：`main @ 569b8e7`（修改前工作区干净）
- 对照：修改前基线全绿（见下），修改后执行同一套命令 + 核心业务实机矩阵

## 1. Environment

- macOS 25.5.0 arm64（darwin），Node 22，pnpm 9.15.9
- 实机跨 Hub 矩阵：本机 Relay（3211，dev）+ 双 server 实例（A:3210 默认 DB / B:3220 独立 file credential backend + 独立 DB）
- 桌面端：Rust 工具链编译/测试可跑；Tauri GUI 全流程未启动（见 Not Run）

## 2. Baseline Result（修改前）

| 命令 | 结果 |
|---|---|
| pnpm format:check | PASS |
| pnpm lint | PASS（2 个 pre-existing warning：react/jsx-no-literals） |
| pnpm typecheck | PASS |
| pnpm test（shared 15 + relay 19 + server 178） | PASS（212 项） |
| pnpm build | PASS |
| pnpm test:e2e | PASS（19 项） |
| cargo test / cargo check | PASS（Rust 侧 0 个测试存在） |

## 3. Final Result（修改后，全部 Batch + 实机回归补充修复完成）

| 命令 | 结果 | 对比 |
|---|---|---|
| pnpm format:check | PASS | 持平 |
| pnpm lint | PASS（同 2 个 pre-existing warning） | 持平 |
| pnpm typecheck | PASS | 持平 |
| pnpm test（shared 15 + relay 20 + server 180） | **PASS（215 项，+3 新增回归测试）** | +3 |
| pnpm build | PASS | 持平 |
| pnpm test:e2e | PASS（19 项） | 持平 |
| cargo test | PASS（0 tests） | 持平 |
| cargo check | PASS | 持平 |

**无任何 Regression；无 Pre-existing failure。** 新增失败为 0。

> 注：F 批次（用户授权的功能修复，见 CHANGELOG）完成后另行复跑同一套命令，全绿；其中 1 处旧测试断言（transport failed → error 终态）按新设计语义更新为 failed → queued 重试。

## 4. Commands Executed

上述 8 条命令 + 各 Batch 中途验证（relay/server/web 分包 typecheck/test/build、a2a-bus 回归测试在旧代码下的失败验证）。

## 5. Package Results

| 包 | 单元/集成测试 | typecheck | 说明 |
|---|---|---|---|
| Shared | 15 PASS | PASS | 新增 constants.ts 与 types/api.ts（纯新增导出） |
| Server | 180 PASS（+并发计数回归、+deny 模式 mention 拦截回归） | PASS | a2a-bus/plugins/scheduler/authorization/message-router/credential/cli/runtime 变更全覆盖 |
| Relay | 20 PASS（+1 畸形注册帧回归） | PASS | handler/offline-store/index 变更全覆盖 |
| Web | （无单测，由 e2e 覆盖） | PASS | 死代码删除/类型迁移/引用稳定性 |
| Tauri/Rust | 0 tests（仓库现状） | cargo check PASS | 本轮未改动 Rust 代码 |
| E2E | 19 PASS | — | 含 a11y/键盘/响应式/onboarding/会话恢复/群聊 A2A 菜单 |

## 6. Core Scenario Results（实机双实例 + 本机 Relay，2026-08-27）

### Local Agent
- mock Agent 创建/会话创建/发送/回复/历史：**PASS**
- CLI discovery：启动即发现 claude-code/codex/opencode（沿用 dev DB）：**PASS**

### A2A
- bus 权限/环检测/超时/取消：单测覆盖（runtime/a2a-bus/handoff/openai/cli 179 项）**PASS**
- 并发计数修复：新增回归测试（旧代码失败/新代码通过，已用 git checkout 双向验证）：**PASS**
- 跨 Hub A2A 双向（见下）：**PASS**

### Group
- 群聊 A2A 菜单键盘操作：e2e **PASS**（"group A2A and export menus expose named keyboard actions"）

### Cross-device（双实例实机）
- 配对（pair→accept→SAS 一致→双方 approve→trusted）：**PASS**
- Room（创建→邀请→接受→双方 agent 入会+visibility）：**PASS**
- **双向跨 Hub 消息（无手动重连，建房后即时）**：A→B 与 B→A 均 **PASS**（修复前实测 B→A 被预存缓存缺陷误拒；修复链 = 建房即 join + room:event 增量更新 + relay join 始终广播）
- resync（重连触发 requestAllRooms，经新增房间成员授权）：**PASS**（0 拒绝）
- queued 离线投递（B 下线→A 发送入队→B 上线→投递→执行→响应回传 A，状态 done）：**PASS**
- presence 抖动 + 限流（修复前实测 581 次限流断连死循环；队列白名单后重连风暴 **0 限流**）：**PASS**
- 重复投递防护（重连重放经 seenMessageIds 去重，本轮实测无重复执行）：**PASS**（重启场景的持久化去重仍为已知缺口，见审计 P1-2）

### Relay
- 在线投递/离线存储/TTL/回执：**PASS**（全程实机使用中验证）
- 畸形注册帧不崩进程（新增回归测试 + 实机）：**PASS**
- 注册重发/离线消息下发（分帧后客户端正常消费）：**PASS**

### P2P
- **NOT RUN — Environment limitation**（需真实第二物理设备的局域网场景；本轮双实例同为 loopback，P2P 发现/握手未纳入）

### Desktop
- **NOT RUN — Environment limitation**（未启动 Tauri GUI/sidecar 全流程；本轮未改动 Rust 代码，cargo check/test 通过）

### Scheduler
- 创建（cron 校验/nextRunAt）→ 分钟级触发执行 → lastResult=success → 删除：**PASS**（重叠互斥由代码审查 + 单测路径覆盖，未做长周期实机重叠验证）
- **删除持有定时任务的会话（F1 修复验证）**：返回 200（修复前必 500 FK），任务行与内存 cron 同步消失：**PASS**

### F 批次新增验证（2026-08-27 第二轮实机）
- 离线投递经 **Relay 离线库**（F2 去短路）：对端断开→消息入 relay offline_messages→重连→推送→执行→响应回传：**PASS**
- keyEpoch 闭环（F2）：移除 Room agent 后 revision/keyEpoch 同步递增（4/2），旧 OwnerProof 失效：**PASS**
- 入站去重持久化（F1）：processed_envelopes 表实测落库 14 条：**PASS**
- 全链路收尾状态：双端 0 授权拒绝、relay 0 限流：**PASS**
- file 凭据回退盐化（F5）：v1 旧文件→自动迁移 v2→盐文件生成→新旧凭据往返：**PASS**（standalone + 真实 dev server 路径）
- deny 模式 mention 拦截（F3）：单测锁定（auto 转发成功 vs deny 零转发）：**PASS**
- a2a_cancel（F2）：additive 协议消息，代码路径随全链路 typecheck/测试覆盖（未做长调用取消实机演示）

### Credential Store
- macOS keychain 新 stdin 写入路径：PATCH agent 带 apiKey → 持久化配置剥离 → keychain 写入 → `security find-generic-password` 读回一致（含特殊字符 standalone 往返验证）：**PASS**

## 7. Not Run（环境限制，`NOT RUN — Environment limitation`）

- 双物理设备 Relay/P2P/Hybrid（配对、Room 消息、断网重连、P2P receipt parity）
- Windows 原生应用与 Windows CLI argument 模式（P1-6 命令注入面修复需 Windows 实机验证，未修，已在审计中标出）
- Tauri 桌面端启动/sidecar/关闭/重启全流程
- 签名/公证、干净机器安装升级
- 人工屏幕阅读器可访问性

## 8. 剩余风险

1. **P1-6（未修）**：Windows `shell:true` CLI argument 模式命令注入面——发布 Windows 版前必须处理（本机为 macOS，盲改风险高）。
2. **P1-4（未修）**：Room revision CAS 链路未接线 + relay CAS 内存态锁步——属协议级功能开发，需独立设计窗口；实际风险已由 resync 房间授权 + keyEpoch 闭环收敛。群组密钥 GroupKeyManager 仍未接线。
3. **P1-10（未修）**：drizzle 快照链与运行时 ensure\* 双轨——下次 `drizzle-kit generate` 会产生重复迁移（F1 新增的 processed_envelopes 也走 ensure\* 模式），需专门窗口收口。
4. **P1-11（未修）**：Tauri 单实例/sidecar 重启/优雅关闭——需新增依赖 + 真机验收。
5. **跨 Hub REST 发送同步等待远端执行**（最长 5min，对端离线时 HTTP 挂起）——预存行为，两轮实测复现，建议后续改 202/异步。
6. **P2-15 剩余**：切会话整体重建 WebSocket（常驻 socket + subscribe 切换未做，涉及订阅管理重构）。
7. **a2a_cancel 为 additive 协议**：旧版本对端会忽略该消息（退化为原有的"对端跑满超时"行为）；跨版本混布时取消不传播属预期。
8. **scope 收紧（F5）**：此前依赖错误放宽（api:read 调搜索、api:write 清凭据/批量删除）的存量 scoped token 需要换发正确 scope。
9. 控制消息不再进本地重发队列（Batch 2R 白名单）：依赖"重连时各流程自行重发起"语义；新增需 at-least-once 的控制消息须显式加白。

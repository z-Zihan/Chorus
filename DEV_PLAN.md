# AgentLink 开发计划 / Development Plan

> 最后更新 / Last updated: 2026-08-04
>
> 规范来源 / Normative source: [`docs/CROSS_DEVICE_DESIGN.md`](./docs/CROSS_DEVICE_DESIGN.md)
>
> 范围 / Scope: 历史基础设施、跨设备通信实现、产品交互闭环与发布门槛 / Historical foundations, cross-device implementation, product UX closure, and release gates

本文完全以 `docs/CROSS_DEVICE_DESIGN.md` 为跨设备实现依据。历史任务的“完成”仅表示对应代码与既有审查已完成；任何依赖真实双设备、生产包或运维环境的验收，必须由下方独立任务关闭后才算发布就绪。

This plan treats `docs/CROSS_DEVICE_DESIGN.md` as the single source of truth for cross-device work. A completed historical task means its implementation and prior review are complete; release readiness still requires the separate real-device, packaged-build, and operational acceptance tasks below.

## 状态与优先级 / Status and Priority

- `✅ done`：实现与该任务定义的验收已完成 / Implementation and task-level acceptance are complete.
- `🔄 in-progress`：正在实现或验收 / Implementation or acceptance is actively underway.
- `⏳ todo`：尚未完成 / Not yet complete.
- **P1 — 发布阻断 / Release blocker**：发布前必须完成并通过 Review。
- **P2 — 发布后优化 / Post-release optimization**：不阻断首发，按依赖顺序在发布后完成。

---

## 第一部分：已完成的基础设施 / Part I: Completed Foundations

以下记录保留既有 P0–P2 历史任务及其完成状态，仅作追溯参考。

The following P0–P2 records preserve the completed historical work for traceability.

### 历史 P0 / Historical P0

| ID | 任务 | 交付物与验收 | 依赖 | 状态 | Review |
|---|---|---|---|---|---|
| ID-01 | User schema + migration / User 模型与迁移 | Drizzle `users`；初始化本机 User；现有 Agent 回填 `ownerId/ownerType`；升级与回滚测试 / Create users, initialize the local user, backfill agent ownership, and pass upgrade/rollback tests | — | ✅ done | ✅ code-review skill |
| ID-02 | User/Hub cryptographic binding / User-Hub 密码学绑定 | User key 存钥匙串；稳定 `userId`；`UserHubBinding` 双签名与指纹 UI / Store the user key securely and provide stable identity, dual signatures, and fingerprint UI | ID-01 | ✅ done | ✅ code-review skill |
| ID-03 | Agent owner model / Agent 所有者模型 | Agent API 返回 owner；`system` CLI 关联本机 User；远程 config/credential 永不落库 / Return ownership, bind system agents to the local user, and never persist remote secrets | ID-01 | ✅ done | ✅ code-review skill |
| ID-04 | Conversation migration / 会话迁移 | 支持 `dm/group/cross_hub`；`channel→group`；保存 Owner/Agent/Hub 身份快照 / Migrate conversation kinds and preserve immutable identity snapshots | ID-01, ID-03 | ✅ done | ✅ code-review skill |
| PROTO-01 | HubPayload v2 / HubPayload v2 协议 | 增加 User/Agent 路由字段；兼容读取 v1；无法安全映射时拒绝 / Add stable routing identities, retain v1 reads, and fail closed on unsafe mappings | ID-02 | ✅ done | ✅ code-review skill |
| DISC-01 | Signed directory / 签名目录 | `request/announce/revoke`；visibility 过滤；版本、TTL、签名与最小披露 / Implement scoped, signed, versioned, expiring minimal manifests | PROTO-01 | ✅ done | ✅ code-review skill |
| DISC-02 | Remote registration / 远程注册 | 单事务 upsert remote User 后 Agent；确定性远程 ID；revoke/stale 与重名测试 / Atomically register remote identities and pass revoke, stale, and collision tests | DISC-01, ID-03 | ✅ done | ✅ code-review skill |
| SEC-01 | Trust store / 信任存储 | 邀请/配对码、User/Hub 指纹、`pending/trusted/blocked`、公钥变化重配对 / Persist trust states and require re-pairing on key change | ID-02 | ✅ done | ✅ code-review skill |
| SEC-02 | Inbound authorization / 入站授权 | API scope → trust → visibility → Agent policy → conversation mode → action approval；own auto / trusted confirm / unknown deny | SEC-01, DISC-02 | ✅ done | ✅ code-review skill |
| SEC-03 | Offline delivery semantics / 离线投递语义 | `queued/delivered/accepted/denied/done`；ack 后删除；TTL expired；幂等与顺序测试 / Implement distinct delivery/application states, expiry, idempotency, and ordering | PROTO-01 | ✅ done | ✅ code-review skill |

### 历史 P1 / Historical P1

| ID | 任务 | 交付物与验收 | 依赖 | 状态 | Review |
|---|---|---|---|---|---|
| API-01 | Owner-aware discovery API / 所有者感知发现 API | `/api/users`；按 owner/scope 查询 Agent；capabilities/status；分页与 stale 字段 / Owner-scoped discovery with capability, status, pagination, and stale metadata | DISC-02 | ✅ done | ✅ code-review skill |
| API-02 | Scoped client tokens / 受限客户端令牌 | token hash、`clientId/userId`、scope、expiry、revoke；WS 短期 ticket；默认 loopback / Hashed scoped tokens, revocation, short-lived WS tickets, and loopback defaults | ID-01 | ✅ done | ✅ code-review skill |
| UI-01 | User-grouped directory / 按 User 分组目录 | “我的 Agent”与远程 User 分组；`Owner / Agent` 消歧；本地/远程/离线/待确认状态 / Group agents by owner and expose unambiguous availability states | API-01 | ✅ done | ✅ code-review skill |
| UI-02 | Cross-hub conversation / 跨 Hub 会话 | remote DM、`cross_hub` 群聊、Owner 身份、路由路径和离线状态展示 / Support remote conversations with owner identity, path, and offline state | ID-04, SEC-03, UI-01 | ✅ done | ✅ code-review skill |
| UI-03 | Privacy & permission settings / 隐私与权限设置 | User/Agent visibility、`auto/confirm/deny`、trust revoke、披露预览 / Configure visibility and invocation policy, revoke trust, and preview disclosure | SEC-02 | ✅ done | ✅ code-review skill |
| EXT-01 | External Agent contract / 外部 Agent 契约 | 以 `skills/agentlink-platform/SKILL.md` 为契约补齐 discovery/send/stream/error API conformance tests / Complete external-agent API conformance tests | API-01, API-02 | ✅ done | ✅ code-review skill |

### 历史 P2 / Historical P2

| ID | 任务 | 交付物与验收 | 依赖 | 状态 | Review |
|---|---|---|---|---|---|
| SCALE-01 | Multi-device User / 多设备 User | `user_hubs`、设备撤销、同一 User 多 Hub Agent 聚合 / Bind multiple hubs, revoke devices, and aggregate agents by user | P1 foundation | ✅ done | ✅ code-review skill |
| SCALE-02 | MLS group crypto / MLS 群组加密 | 大群 rekey 与成员撤销代码；启用必须经协议版本/能力协商 / Implement scalable group rekey and removal behind explicit negotiation | TEST-01 | ✅ done | ✅ code-review skill |
| STD-01 | Standard adapters / 标准适配器 | 将 AgentLink identity/capability 映射到 Google A2A、MCP、ACP / Map AgentLink identity and capabilities to external standards | EXT-01 | ✅ done | ✅ code-review skill |
| OPS-01 | Relay metadata hardening / Relay 元数据加固 | retention、size padding 评估、滥用检测、自托管运维基线 / Provide retention, padding assessment, abuse detection, and self-hosting baseline | TEST-01 | ✅ done | ✅ code-review skill |

---

## 第二部分：跨设备通信实现 / Part II: Cross-Device Communication Delivery

本节落实设计文档 §13 的归一化后续任务。底层 Relay、Hub Client、P2P、Hybrid 与跨 Hub Room 代码已存在，但以下集成和发布验收尚未完成。

This section carries forward the normalized open work from design §13. Relay, Hub Client, P2P, Hybrid, and cross-hub room foundations exist, but the integration and release acceptance below remain open.

### P1 — 发布阻断 / Release Blockers

| ID | 任务 | 交付物与验收 | 依赖 | 状态 | Review |
|---|---|---|---|---|---|
| FLOW-01 | Contact → Room → owner-only Agent 流程集成 / Normative collaboration-flow integration | 全面移除“配对后自动目录/直接远程 Agent”旧入口；配对只产生 Contact；显式创建/接受 Room；仅 owner 可用签名证明添加自己的 Agent；`@mention` 仅按 `(roomId, agentId, homeHubId)` 路由 / Replace every legacy shortcut with the contact-room-owner flow and stable-ID routing | XDEV-07, XDEV-08, XDEV-09, XDEV-11, UX-03 | ⏳ todo | 未审查 / Pending |
| TEST-01 | 真实双设备 E2E 矩阵 / Real two-device E2E matrix | 在两台真实设备上完成 E2E-01～09；每项运行 Relay、P2P，并在 Hybrid fallback 后重复关键断言；验证幂等与无敏感审计日志 / Complete E2E-01 through E2E-09 over Relay and P2P and repeat critical assertions after Hybrid fallback | 全部 P1 协议与 FLOW-01 / All P1 protocol work and FLOW-01 | ⏳ todo | 未审查 / Pending |
| PKG-01 | Tauri 生产包验证 / Packaged Tauri validation | 在 macOS、Windows、Linux 生产包验证 sidecar、mDNS、P2P listener、端口/防火墙/系统权限、macOS entitlement 与 Relay fallback / Validate packaged sidecars, discovery, listeners, platform permissions, entitlements, and fallback | TEST-01 | ⏳ todo | 未审查 / Pending |

### P2 — 发布后优化 / Post-Release Optimizations

| ID | 任务 | 交付物与验收 | 依赖 | 状态 | Review |
|---|---|---|---|---|---|
| SCALE-02-VAL | Negotiated group-crypto validation / 协商式大群加密验收 | 验证 MLS/大群方案仅在显式版本与能力协商后启用，绝不静默改变 v2 密文；补齐规模与撤销 E2E / Verify negotiated activation, v2 compatibility, scale, and revocation end to end | TEST-01, SCALE-02 | ⏳ todo | 未审查 / Pending |
| OPS-01-VAL | Relay hardening operations validation / Relay 加固运维验收 | 在类生产环境验证 retention、滥用检测、日志隐私、备份恢复与 padding 决策 / Validate hardening, privacy, backup/restore, and padding decisions in a production-like environment | TEST-01, OPS-01 | ⏳ todo | 未审查 / Pending |
| RELAY-OPS | Official Relay deployment / 官方 Relay 部署 | 部署公网 WSS/TLS Relay，配置强 JWT secret、持久卷、监控、告警、备份与恢复演练 / Operate an official TLS Relay with durable storage, monitoring, alerting, backups, and recovery drills | OPS-01-VAL | ⏳ todo | 未审查 / Pending |

---

## 第三部分：产品交互闭环修复 / Part III: Product UX Closure

### 已完成 / Completed

| ID | 任务 | 交付物与验收 | 依赖 | 状态 | Review |
|---|---|---|---|---|---|
| UX-01 | 跨设备 onboarding checklist / Cross-device onboarding checklist | 已提供从连接、配对、建 Room 到协作的 checklist / Checklist covers connection, pairing, room creation, and collaboration | — | ✅ done | 已完成 / Complete |
| UX-02 | 群聊消息路由可视化 / Group-message route visualization | 已展示 Relay/P2P/Hybrid 路径与路由状态 / Transport path and routing state are visible | — | ✅ done | 已完成 / Complete |
| UX-03 | Room 添加 Agent 入口 / Add-Agent entry in Room | 已提供 Room 内添加 Agent 入口 / Room exposes an agent-admission entry point | — | ✅ done | 已完成 / Complete |

### P1 — 发布阻断 / Release Blockers

| ID | 任务 | 交付物与验收 | 依赖 | 状态 | Review |
|---|---|---|---|---|---|
| UX-04 | 首次启动引导 / First-run guidance | 首次扫描检测到本机 Agent 后自动创建本地 DM，并显示“开始聊天 / Start chatting”；不触发任何远程目录交换 / Create a local DM after detecting an agent and show the start-chatting prompt without remote disclosure | Agent detection, ID-03 | ⏳ todo | 未审查 / Pending |
| UX-05 | Agent 添加时连通性测试 / Agent preflight on add | 添加前自动执行可执行文件/API、凭据、权限与基础请求 preflight；失败时保留表单并给出可操作原因 / Run connectivity and credential preflight before adding and preserve recoverable input on failure | Agent runtime adapters | ⏳ todo | 未审查 / Pending |
| UX-07 | 添加好友后引导创建 Room / Room guidance after pairing | 配对成功后的联系人页显示“创建聊天室 / Create Room”引导卡；不得自动创建 Room 或发现 Agent / Show an explicit room-creation card after pairing without implicit room or agent discovery | FLOW-01 | ⏳ todo | 未审查 / Pending |
| UX-08 | Room 成员面板分区 / Partitioned Room member panel | 人类成员与 Agent 成员分栏；每个 Agent 显示 `Owner / Agent`、owner Hub/在线状态；重名时显示 Hub 短指纹 / Separate humans from agents and expose owner and availability without ambiguous names | FLOW-01, XDEV-09, XDEV-11 | ⏳ todo | 未审查 / Pending |
| UX-10 | 错误状态恢复 / Recoverable error states | Relay 断开显示持久 banner 与重试；配对失败展示 SPAKE2/SAS/指纹/过期原因；Agent 显示 `queued/accepted/denied/running/done/error` 进度及恢复动作 / Provide precise, recoverable transport, pairing, and execution states | UX-05, XDEV-01, XDEV-07, TEST-01 | ⏳ todo | 未审查 / Pending |

### P2 — 发布后优化 / Post-Release Optimizations

| ID | 任务 | 交付物与验收 | 依赖 | 状态 | Review |
|---|---|---|---|---|---|
| UX-06 | A2A 模式首次提示 / First-use A2A tooltip | 首次进入群聊时一次性介绍 `auto/confirm/deny`，可关闭且不重复打扰 / Explain all three invocation modes once on first group-chat use | SEC-02 | ⏳ todo | 未审查 / Pending |
| UX-09 | 设置页保存反馈 / Settings save feedback | 保存后 500 ms 内显示“保存成功，正在连接”，并独立显示 `connecting/connected/reconnecting/error` 与最近错误 / Separate persistence feedback from live connection state | Hub config/status API | ⏳ todo | 未审查 / Pending |

---

## 第四部分：规范缺口实现 / Part IV: Normative Implementation Gaps

以下任务逐项覆盖设计文档中明确要求、但尚未完成的跨设备协议与安全实现。它们全部是 P1 发布阻断；不得因相邻基础代码存在而标记完成。

These tasks cover every explicitly identified protocol and security gap in the design. All are P1 release blockers and must not be marked complete merely because adjacent foundation code exists.

### P1 — 协议、安全与状态一致性 / Protocol, Security, and State Consistency

| ID | 任务 | 交付物与验收 | 依赖 | 状态 | Review |
|---|---|---|---|---|---|
| XDEV-01 | TransportReceipt 实现改造 / TransportReceipt rework | Relay 处理明文签名 `transport_receipt`，校验认证连接、Hub 签名与待投递记录，仅在 `status=persisted` 时删除；Hub 仅在持久化成功后发送，重复投递须幂等且重发 receipt；3 次无有效 receipt 标记 `failed` / Enforce durable, signed transport receipts and correct redelivery semantics | SEC-03, XDEV-05 | ⏳ todo | 未审查 / Pending |
| XDEV-02 | Room CAS 计数器 / Atomic Room CAS counters | Relay 为每个 Room 原子持久化 `(revision, keyEpoch)`；仅 expected 双匹配且两个 new 值恰好 `+1` 时接受 `room_cas`；失败返回当前值并要求 resync；P2P-only 由 owner Hub 等价仲裁 / Implement authoritative atomic CAS with conflict recovery on Relay and P2P-only paths | XDEV-09 | ⏳ todo | 未审查 / Pending |
| XDEV-03 | `contact_block` 路由帧 / Contact-block routing frame | Relay 验证认证 Hub、JCS 签名及 `affectedRoomIds` membership；立即停止受影响 Room 对 `blockedHubIds` 的双向新投递并返回 `contact_blocked`；帧不得含资料、正文或 key / Install authenticated bidirectional routing blocks without exposing business content | SEC-01, XDEV-05 | ⏳ todo | 未审查 / Pending |
| XDEV-04 | KeyCommitment 验证 / Rekey key commitment | rekey 携带 `hex(HMAC-SHA-256(newRoomKey, UTF8(roomId) || uint64be(newKeyEpoch)))`；接收方常量时间校验；不一致拒绝安装、写安全审计并触发 resync / Commit to each distributed room key and fail closed on mismatch | XDEV-02, XDEV-05, XDEV-09 | ⏳ todo | 未审查 / Pending |
| XDEV-05 | RFC 8785 JCS 序列化 / RFC 8785 JCS serialization | 建立唯一共享 JCS 实现；envelope、manifest、OwnerProof、授权/rekey event 与控制帧统一对移除签名字段后的完整对象 UTF-8 bytes 签名；加入跨实现测试向量并移除自定义 canonical JSON / Use one RFC 8785 implementation and shared signature vectors everywhere | PROTO-01 | ⏳ todo | 未审查 / Pending |
| XDEV-06 | Hub 私钥迁入钥匙串 / Move Hub private key to credential store | 扩展 `credential-store` 支持 Hub key；安全迁移已有私钥；`data/hub-keypair.json` 仅保留公钥和非敏感元数据；重启、迁移失败与回滚测试证明无明文私钥残留 / Securely migrate and persist Hub private keys with no plaintext residue | ID-02 | ⏳ todo | 未审查 / Pending |
| XDEV-07 | SPAKE2 配对 / SPAKE2 pairing | 一次性码仅作为 SPAKE2 password；transcript 绑定排序后的完整 Hub IDs、至少 128-bit nonce 与双方交换消息并完成 key confirmation；按规范生成保留前导零的 6 位 SAS；任一失败不保存部分信任 / Implement fail-closed PAKE pairing and exact six-digit SAS verification | SEC-01, XDEV-05, XDEV-06 | ⏳ todo | 未审查 / Pending |
| XDEV-08 | Hub 指纹 32 hex / Full 32-hex Hub fingerprint | 所有配对、联系人详情与安全核验 UI 显示 `hex(SHA-256(raw Ed25519 public key)[0:16])` 的完整 32 字符；更短值只能作非安全视觉提示 / Display the complete 128-bit fingerprint for every security decision | XDEV-06 | ⏳ todo | 未审查 / Pending |
| XDEV-09 | Room revision 状态机 / Room revision state machine | Room 创建时 `revision=1,keyEpoch=1`；成员/Agent/角色/block/rekey 每个状态变化生成独立 JCS 签名事件并严格 `revision+1`；仅 rekey `keyEpoch+1`；校验 actor 权限、当前 revision、签名与事件 schema / Persist and validate a monotonic, signed Room state machine | ID-04, XDEV-05 | ⏳ todo | 未审查 / Pending |
| XDEV-10 | Resync 流程 / Room resynchronization | 实现加密 `resync_request {roomId,lastKnownRevision}` 与 `resync_response` 连续增量/签名快照；缺口、未知 epoch 或 TTL 超期时进入 `resyncing`；验证后应用完整增量或最高可信快照，完成前禁止依赖未知状态的新消息 / Restore verifiable Room state after gaps or expiry | XDEV-04, XDEV-09 | ⏳ todo | 未审查 / Pending |
| XDEV-11 | OwnerProof 签名验证 / OwnerProof signature verification | Agent 入房携带完整 `OwnerProof`；用有效 `UserHubBinding` 中 owner User 公钥验证 JCS 签名并精确匹配 agent、Room、当前 epoch；失败返回 `403 INVALID_OWNER_PROOF`，成功后方可 upsert、递增 revision 与 rekey / Admit an agent only after exact owner-proof verification | ID-02, SEC-02, XDEV-05, XDEV-09 | ⏳ todo | 未审查 / Pending |
| XDEV-12 | Block 立即 rekey / Immediate rekey on block | block 后将全部已验证对方 Hub 加入 TrustStore，成员标为 `blocked`、其 Agent 标为 `unavailable`；立即对每个共享 Room rekey 并从新 key 分发排除被 block Hub；历史保留且不等待管理员正式移除 / Revoke routing and key access immediately while preserving history | XDEV-02, XDEV-03, XDEV-04, XDEV-09, XDEV-10 | ⏳ todo | 未审查 / Pending |

### P1 — E2E-01～09 详细矩阵 / Detailed E2E-01–09 Matrix

`TEST-01` 只有在以下九项全部完成后才可标记 `✅ done`。除特别说明外，每项都必须分别走 Relay、P2P，并在 Hybrid fallback 后重复关键断言；所有接收端统一验证 `messageId` 幂等，且审计日志不含正文或 key。

`TEST-01` may become `✅ done` only after all nine rows pass. Unless noted otherwise, every scenario runs over Relay and P2P and repeats critical assertions after Hybrid fallback; all receivers also verify message idempotency and content-safe audit logs.

| ID | 任务 | 交付物与验收 | 依赖 | 状态 | Review |
|---|---|---|---|---|---|
| E2E-01 | 完整协作链路 / Full collaboration flow | 配对 → 建 Room → 邀请/接受 → OwnerProof 加 Agent → `@mention` → 回复；断言配对泄露 Agent 数为 0、revision/epoch 单调、仅 home Hub 执行一次、合法成员均可见回复 / Validate the complete normative collaboration flow | FLOW-01, XDEV-07, XDEV-11 | ⏳ todo | 未审查 / Pending |
| E2E-02 | 并发 rekey / Concurrent rekey | 两成员基于同一 revision 同时加自己的 Agent；仅一个 CAS 成功，失败方 resync 后重试，无同 epoch 异 key，最终两个 OwnerProof 均有效 / Prove deterministic conflict recovery without split-brain keys | XDEV-02, XDEV-04, XDEV-10, XDEV-11 | ⏳ todo | 未审查 / Pending |
| E2E-03 | 管理员委派与退出 / Admin delegation and leave | 最后管理员退出先返回 `409 LAST_ROOM_ADMIN`；委派使 revision+1；其后退出、rekey 与角色在所有 Hub 收敛 / Enforce last-admin safety and convergent delegation | XDEV-09, XDEV-10 | ⏳ todo | 未审查 / Pending |
| E2E-04 | TTL 过期与 resync / TTL expiry and resync | 离线超过 TTL 期间变更成员、角色与 Agent；过期密文不重投；上线发送 lastKnownRevision，并通过验证后的增量/快照恢复最新 Room state 与 epoch / Recover state, but never expired content, after TTL | XDEV-10 | ⏳ todo | 未审查 / Pending |
| E2E-05 | block 后共享 Room / Shared Room after block | block 后 TrustStore、成员 `blocked`、Agent `unavailable` 与双向停投一致；历史保留；管理员正式移除再产生 revision+1 与 rekey / Verify immediate block enforcement and later administrative cleanup | XDEV-03, XDEV-12 | ⏳ todo | 未审查 / Pending |
| E2E-06 | nonce 碰撞检测 / Nonce collision detection | 两 Hub 同 epoch 发多条消息并注入重复 `(senderHubNonceId,counter)`；正常 nonce 为 8+4 bytes 且跨 Hub 唯一；碰撞拒绝并审计；counter 不回绕且仅 rekey 后归零 / Reject duplicate nonces and prove durable counters | Room crypto, XDEV-04 | ⏳ todo | 未审查 / Pending |
| E2E-07 | keyEpoch 在途解密 / In-flight epoch decryption | epoch N 延迟消息在 rekey 后 5 分钟内可仅解密，超时后拒绝；N 不再加密，N+1 只用新 key，内外 epoch 不匹配失败 / Enforce decrypt-only grace and strict epoch matching | XDEV-04, XDEV-09 | ⏳ todo | 未审查 / Pending |
| E2E-08 | receipt 丢失重投 / Lost-receipt redelivery | 丢弃前两次 receipt；Relay attempts `1→2→3`，业务仅处理一次，重复投递重发 receipt，第三次有效 receipt 后删除队列 / Prove durable idempotency across lost receipts | XDEV-01 | ⏳ todo | 未审查 / Pending |
| E2E-09 | 三次无 receipt / Three missing receipts | 连续丢弃 3 次 receipt；记录转 `failed`、停止自动重投并通知发送方；加密 E2E `delivery_ack` 不得删除 Relay 队列 / Prove terminal failure semantics and receipt/ack separation | XDEV-01 | ⏳ todo | 未审查 / Pending |

---

## 建议实施顺序 / Recommended Execution Order

1. **密码学与身份基线 / Crypto and identity baseline:** XDEV-05 → XDEV-06 → XDEV-07 → XDEV-08。
2. **Room 一致性 / Room consistency:** XDEV-09 → XDEV-02 → XDEV-04 → XDEV-10 → XDEV-11。
3. **投递与撤销 / Delivery and revocation:** XDEV-01 → XDEV-03 → XDEV-12。
4. **产品闭环 / Product closure:** FLOW-01 与 P1 UX；随后执行 TEST-01、UX-10、PKG-01。
5. **发布后工作 / Post-release work:** P2 UX、SCALE-02-VAL、OPS-01-VAL、RELAY-OPS。

---

## 发布门槛 / Exit Criteria

P1 全部标记 `✅ done` 且 Review 通过，并同时满足以下条件，方可发布。P2 不阻断首发。

Release is allowed only after every P1 task is `✅ done`, reviewed, and all criteria below pass. P2 work does not block the initial release.

1. **身份与迁移 / Identity and migration:** 所有 Agent 都有有效 owner；升级/回滚后历史可读；同名 Agent 误路由为 0。Every agent has a valid owner, history survives upgrade/rollback, and name-based misrouting is zero.
2. **授权闭环 / Authorization closure:** 配对自动创建远程 Agent 数为 0；非 owner、未入房 Agent、非管理员操作分别稳定返回规范错误；在线撤销 60 秒内收敛且历史保留。Pairing leaks no agents, owner/member/admin rules fail with stable errors, and revocation converges within 60 seconds without deleting history.
3. **密码学基线 / Cryptographic baseline:** 所有签名统一 RFC 8785 JCS；Hub 私钥不以明文落盘；SPAKE2、6 位 SAS、32-hex 指纹、KeyCommitment、nonce 防碰撞与 5 分钟旧 epoch 仅解密窗口全部通过。All signature, key-storage, pairing, commitment, nonce, and epoch-grace requirements pass.
4. **Room 一致性 / Room consistency:** revision/keyEpoch 单调；并发 CAS 无 split-brain；状态缺口、未知 epoch 与 TTL 超期均可经签名增量或快照 resync；block 立即停投并 rekey。Room state remains monotonic and convergent under conflicts, gaps, expiry, and blocking.
5. **离线投递 / Offline delivery:** Relay 持久性、TTL、`transport_receipt` ack-delete、3 次失败、重复投递幂等、发送方通知全部通过；加密业务 ack 不能删除队列。Offline storage and receipt semantics are durable, idempotent, and correctly separated from application acknowledgements.
6. **真实设备矩阵 / Real-device matrix:** 两台真实设备完成 E2E-01～09 的 Relay、P2P 与 Hybrid fallback 验收；失败不产生半注册 User/Agent、重复执行或含正文/key 的审计日志。Two real devices pass all nine scenarios without partial registration, duplicate execution, or sensitive logs.
7. **产品可恢复性 / Product recoverability:** UX-04、UX-05、UX-07、UX-08、UX-10 完成；用户能区分保存、连接、投递、授权和执行状态，并从 Relay、配对及 Agent 错误恢复。All P1 UX work exposes distinct and recoverable states.
8. **外部接入 / External access:** 外部 Agent 按契约完成本地发现、同步/流式发送、A2A 确认、远程投递与离线状态处理。External agents pass discovery, send/stream, confirmation, remote-delivery, and offline-state conformance.
9. **生产包 / Production packages:** macOS、Windows、Linux Tauri 生产构建通过 sidecar、mDNS、P2P listener、系统权限、端口/防火墙与 Relay fallback 验证。Production desktop packages pass platform networking and fallback validation.
10. **Relay 发布检查 / Relay release checks:** 目标 Relay 通过 WSS/TLS、强 secret、速率限制、SQLite WAL/FULL durability、备份恢复与日志隐私检查。The release Relay passes transport security, rate limit, durability, recovery, and log-privacy checks.

**English summary:** Historical identity, discovery, security, owner-aware UI/API, scaling, standards, and hardening tasks remain recorded as complete. Release work now centers on the normative Contact → Room → owner-only Agent flow, twelve explicit protocol/security gaps, five P1 UX closures, nine real-device E2E scenarios, and packaged Tauri validation. P2 contains only post-release UX, scale validation, and Relay operations.

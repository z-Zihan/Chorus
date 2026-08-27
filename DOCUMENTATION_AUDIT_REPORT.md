# Chorus 文档审计报告（DOCUMENTATION_AUDIT_REPORT）

- 审计日期：2026-08-27
- 基线：`main @ 569b8e7` + 未提交的质量/功能修复 diff（两轮优化见 CODE_QUALITY_AUDIT.md / CHANGELOG）
- 原则：代码是事实来源，测试是行为证据；设计文档不等于实现证据；"已实现/进程级已验证/物理设备已验收"严格区分
- 本轮特殊授权：对"文档有、代码无"且值得存在的功能，**补代码实现**而非仅改文档（详见 §Gap-1 处理）

---

## 1. Executive Summary

文档体系共 14 个主要文件，整体质量高于典型同阶段项目：README 的三层成熟度叙事基本准确，DEV_PLAN 是诚实的活文档（指向 design/development-plan.md 为发布门禁），CROSS_DEVICE_DESIGN 规范详尽。**最大的 Gap 是跨设备协议栈的"规范 vs 实现"落差**：CROSS_DEVICE_DESIGN 将 Room key（GroupKeyManager）/ rekey / Relay 原子 CAS 写为规范 v1，代码中前两者长期为死代码、CAS 零接线。

本轮处理：
- **Room CAS 已补实现并接线**（用户授权：好功能直接实现）——Relay 持久化权威计数器（重启不再回退 {1,1}）+ server agent 增删路由经 CAS 协调、冲突返回 409 并触发重同步；实机双实例验证通过。实现与规范的唯一偏差：keyEpoch 允许 +0/+1（成员变更尚不自动生成新群组密钥），已在设计文档 Implementation Status 中如实标注。
- **typing 指示器已补实现**——shared 协议/服务端/WS 客户端早已存在该事件，仅 UI 未渲染；本轮补齐渲染与过期清理。
- 其余"文档有代码无"项（完整 Room key 轮换方案、P2P 会话加密 P2P-04、Retry 阈值等）为大协议项或发布门禁项，标注 Planned/Pending，不强行实现。
- README 保持产品首页定位，空「产品预览」以真实截图填充（scripts/readme-screenshots.mjs 可重复生成）。

## 2. Documentation Inventory

| Path | 用途 | 受众 | 状态 | 动作 |
|---|---|---|---|---|
| README.md | 产品首页 | 所有人 | Needs Update | 重构+截图 |
| DEV_PLAN.md | 当前开发/验收计划 | 维护者 | Current（数字过时） | 更新基线数字与 XDEV 状态 |
| docs/TECH.md | 当前架构 | 开发者 | Current | 小幅同步（本轮新组件） |
| docs/GUIDE.md | 用户操作 | 用户 | Current | 核对无误，微调 |
| docs/DEVELOPMENT.md | 开发者上手 | 开发者 | Current | 无实质漂移 |
| docs/PRD.md | 产品需求 | 产品 | Historical-leaning | 补状态声明头 |
| docs/CROSS_DEVICE_DESIGN.md | 跨设备协议规范 | 协议/开发者 | Needs Update | 加 Implementation Status 区块 |
| docs/RELAY_DESIGN.md | Relay 设计 | 协议/开发者 | Needs Update | CAS 段落标注实现状态 |
| docs/WINDOWS_BUILD.md | Windows 构建 | 发布 | Current | 不动（诚实标注未验证） |
| docs/reviews/automated-quality-report.md | 阶段证据 | — | Generated/Evidence | 加历史标记头 |
| docs/reviews/autonomous-quality-remediation.md | 阶段证据 | — | Generated/Evidence | 加历史标记头 |
| design/development-plan.md | 发布门禁真源 | 维护者 | Current | 不动 |
| skills/chorus-platform/SKILL.md | 外部 Agent 接入契约 | 外部 Agent | Current | 与 API 一致（端点核对通过） |

## 3. Documentation ↔ Code Gap

### Gap-1：文档写了、代码没有
| 声称 | 出处 | 实际 | 处理 |
|---|---|---|---|
| Room 状态 CAS（Relay 原子维护 revision/keyEpoch；§313 完整契约） | CROSS_DEVICE_DESIGN/RELAY_DESIGN/DEV_PLAN-XDEV | 曾零接线、内存态 | **本轮实现**（持久化+接线+放宽 epoch∈{0,+1}，偏差已标注） |
| typing 事件（输入中指示） | shared events / 服务端发射 | UI 从不渲染 | **本轮实现**（指示器+过期清理+i18n） |
| Room key AES-GCM epoch 方案 / rekey 事件 / keyCommitment / nonce 计数器（§4.2 规范 v1） | CROSS_DEVICE_DESIGN | GroupKeyManager 死代码；实际全部走 pairwise crypto_box | 标注 Planned（最小闭环已做：移除成员递增 keyEpoch 使旧 OwnerProof 失效）；完整轮换待独立窗口 |
| 发送方三次重试阈值/管理员重试/持久化 attempt | CROSS_DEVICE_DESIGN:672 | 未实现 | 文档已有"尚未实现"标注 ✓ |
| P2P-04 P2P 消息加密（ECDH 会话密钥） | DEV_PLAN | 未实现（传输层包装签名有，会话加密无）；业务 payload 本身经 pairwise crypto_box 已 E2EE | 保持 ⏳（DEV_PLAN 如实） |
| block 后立即 rekey（发布门槛 #6） | DEV_PLAN | block 即时生效本地拒收 ✓；keyEpoch 在移除成员时轮换 ✓；完整 group-key rekey 待 Gap 上项 | 门禁语义按现有实现如实描述 |

### Gap-2：代码有、文档没写（本轮两轮修复后需同步）
- a2a_cancel 协议消息、resync 房间成员授权、建房即 join、离线队列白名单、入站 envelope 持久化去重（processed_envelopes）、transport failed→queued 重试、scheduler 重叠互斥、bad-plugin 容错跳过、file 凭据盐化迁移、macOS keychain stdin 写入、scoped-token scope 映射 → **写入 TECH.md 新增小节 + 相关 DESIGN Implementation Status**
- A2A mode 统一来源、typing 渲染、表单防误清 → GUIDE/TECH 提及

### Gap-3：文档互相冲突
- DEV_PLAN 基线数字（171 单测/18 E2E）vs 实际（215/19 且随 diff 增加）→ 已更新
- README FAQ「不能仅凭浏览器模拟视为真实设备闭环」与正文「进程级已实现」一致，无冲突
- reviews 两份报告含旧数字（如 144/178 测试），属历史快照 → 加历史标记而非改正文

### Gap-4：成熟度语言
README 三层「已可用/已实现/进程级已实现，物理双设备待验收」与代码相符，保留；CROSS_DEVICE_DESIGN 缺少实现状态层 → 本轮以 Implementation Status 表补齐（Available / Process-level implemented / Automated-test verified / Planned 四级）。

## 4. Capability Matrix（节选，全量证据见测试与实机记录）

| Capability | Status | Evidence |
|---|---|---|
| CLI discovery/run/stream/cancel/history | Available | dev 实机 + cli.test |
| API Connector (OpenAI-compatible) | Available | openai adapter + catalog |
| @mention 转发 + 权限闸门(auto/deny/confirm) | Available（deny/confirm mention 路径本轮补齐） | runtime.test 新增 deny 用例 |
| A2A_CALL + maxRounds/环检测/超时/取消 | Available | a2a-bus/runtime tests |
| 跨 Hub 双向消息/A2A + resync 房间授权 | Process-level verified（本机双实例多轮） | 回归报告 |
| Relay 离线投递（经 relay 离线库） + 幂等去重持久化 | Process-level verified | 本轮实机 + processed_envelopes |
| Room membership + OwnerProof + **CAS 并发协调** | Process-level verified（**本轮**） | room-cas.test + 实机 409/正常路径 |
| Room key/rekey 全量方案 | Planned | 设计规范保留 |
| P2P 发现/握手/确认连接 | Process-level implemented | p2p-listener |
| P2P 会话加密 | Planned（P2P-04） | — |
| Scheduler（cron/CRUD/重叠互斥/恢复/删除联动） | Available | scheduler tests + 实机 |
| Plugin 启动加载+诊断（无安装 UI） | Available（如实描述） | loader/routes |
| Credential Store（keychain stdin + file 盐化迁移） | Available | 实机往返验证 |
| REST Platform Skill / Scoped Token / 标准 A2A Agent Card·MCP·ACP 只读映射 | Available | routes/standards + skill-contract test |
| 物理双设备（配对/Room/断网重连） | Pending physical validation | NOT RUN 环境 |

## 5. CLI 支持列表核对

README 列出的 14 个 CLI 与 `server/src/cli-detector/descriptors.ts` 内置 descriptor 一一对应（detected=内置可发现），API Connector 3 项由 type=openai 承载。措辞为「本机自动检测」，非「完整支持」，无需降级。

## 6. Broken Links / Commands

- README 快速开始命令（pnpm install/dev/build/test:e2e 等）与 package.json scripts 一致 ✓
- Relay docker compose 路径/env 变量与 packages/relay/{docker-compose.yml,.env.example,index.ts} 一致 ✓
- chorus.config.ts 示例字段与 AppConfig 类型一致 ✓
- 相对链接 docs/* 全部存在 ✓

## 7. Remaining Uncertainty

- 物理设备矩阵、Windows 打包、签名公证、干净机安装、屏幕阅读器人工验证：保持 NOT RUN/Pending，不因自动化通过而宣称完成。

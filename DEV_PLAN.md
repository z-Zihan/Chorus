# AgentLink 开发计划 / Development Plan

> 最后更新：2026-08-05
> 规范来源：`docs/CROSS_DEVICE_DESIGN.md`

## 状态说明

- `✅ done`：已完成
- `🔄 in-progress`：进行中
- `⏳ todo`：未开始
- **P1**：发布阻断，必须完成
- **P2**：发布后优化

---

## P1 — 发布阻断 / Release Blockers

### 协议与安全 / Protocol & Security

| ID | 任务 | 交付物与验收 | 状态 |
|---|---|---|---|
| XDEV-05 | RFC 8785 JCS 序列化 | 全协议统一 JCS 签名，跨实现测试向量 | ✅ done |
| XDEV-06 | Hub 私钥迁入钥匙串 | 私钥从明文文件迁入 OS 钥匙串 | ✅ done |
| XDEV-07 | SPAKE2 配对 | ECDH+HKDF PAKE + 6 位 SAS | ✅ done |
| XDEV-08 | Hub 指纹 32 hex | 128 bit 指纹，所有安全 UI 显示完整 32 字符 | ✅ done |
| XDEV-09 | Room revision 状态机 | revision/keyEpoch 单调递增，签名事件 | ✅ done |
| XDEV-02 | Room CAS 计数器 | Relay 原子 (revision,keyEpoch) CAS，P2P owner 仲裁 | ✅ done |
| XDEV-04 | KeyCommitment 验证 | rekey 携带 HMAC 承诺，接收方验证 | ✅ done |
| XDEV-10 | Resync 流程 | resync_request/response + 增量事件 + 快照 | ✅ done |
| XDEV-11 | OwnerProof 签名验证 | Agent 入房带 Ed25519 签名，验证后才接受 | ✅ done |
| XDEV-01 | TransportReceipt | Relay 明文 receipt 删离线消息，与 E2E ack 分离 | ✅ done |
| XDEV-03 | contact_block 路由帧 | Relay 双向阻断被 block Hub 的投递 | ✅ done |
| XDEV-12 | Block 立即 rekey | block 后立即 rekey 受影响 Room | ✅ done |

### 产品流程 / Product Flow

| ID | 任务 | 交付物与验收 | 状态 |
|---|---|---|---|
| FLOW-01 | Contact→Room→owner-only Agent | 配对只产生 Contact；创建 Room；仅 owner 加 Agent | ✅ done |
| UX-01 | 跨设备 onboarding checklist | 连接 Relay 后 4 步引导 | ✅ done |
| UX-02 | 群聊消息路由可视化 | 输入框旁显示消息接收者 | ✅ done |
| UX-03 | Room 添加 Agent 入口 | 群聊标题栏 Bot 图标按钮 | ✅ done |
| UX-04 | 首次启动引导 | 检测到 Agent 后自动创建 DM + 欢迎提示 | ✅ done |
| UX-05 | Agent 添加连通性测试 | 添加后验证存在性，失败显示错误 | ✅ done |
| UX-07 | 添加好友后引导创建 Room | checklist 步骤②"立即创建"按钮 | ✅ done |
| UX-08 | Room 成员面板分区 | 人类/Agent 分栏，Agent 显示 owner | ✅ done |
| UX-10 | Relay 断开 banner | cross_hub 会话显示红色断开提示 | ✅ done |
| UX-06 | A2A 模式首次提示 | 首次群聊弹 tooltip 介绍三种模式 | ⏳ todo |
| UX-09 | 设置页保存反馈 | 保存后立即显示连接状态 | ⏳ todo |

### P2P 产品化 / P2P Productization

| ID | 任务 | 交付物与验收 | 状态 |
|---|---|---|---|
| P2P-01 | 设置页 P2P 开关 | 设置→跨设备协作加 P2P 开关 + 说明"仅限同一局域网" | ⏳ todo |
| P2P-02 | 发现确认 UI | 发现设备后弹确认"发现设备 XXX，是否连接？"，不自动连接 | ⏳ todo |
| P2P-03 | P2P 状态显示 | 设置页或侧边栏显示 P2P 连接状态 + 延迟 | ⏳ todo |
| P2P-04 | P2P 消息加密 | 用 ECDH 派生会话密钥加密消息（不只签名） | ⏳ todo |

### 测试与打包 / Testing & Packaging

| ID | 任务 | 交付物与验收 | 状态 |
|---|---|---|---|
| TEST-01 | 真实双设备 E2E | 两台设备完成 E2E-01~09（Relay + P2P + Hybrid） | ⏳ todo |
| PKG-01 | Tauri 生产包验证 | macOS/Windows/Linux 生产包验证 sidecar、mDNS、权限 | ⏳ todo |

---

## P2 — 发布后优化 / Post-Release

| ID | 任务 | 交付物与验收 | 状态 |
|---|---|---|---|
| SCALE-02-VAL | 大群加密验收 | MLS/大群方案协商式启用验收 | ⏳ todo |
| OPS-01-VAL | Relay 运维验收 | 生产环境验证 retention、滥用检测、备份恢复 | ⏳ todo |
| RELAY-OPS | 官方 Relay 部署 | 公网 WSS/TLS Relay + 监控 + 告警 | ⏳ todo |
| UX-06 | A2A 模式首次提示 | 首次群聊一次性 tooltip | ⏳ todo |
| UX-09 | 设置页保存反馈 | 保存后显示连接状态 | ⏳ todo |

---

## 建议实施顺序

1. **P2P 产品化**：P2P-01 → P2P-02 → P2P-03（P2P-04 可后续）
2. **UX 收尾**：UX-06 → UX-09
3. **真实测试**：TEST-01（两台设备）
4. **打包验证**：PKG-01
5. **发布后**：SCALE-02-VAL、OPS-01-VAL、RELAY-OPS

---

## 发布门槛

P1 全部 ✅ done 且 Review 通过后发布：

1. 所有 Agent 有有效 owner，升级/回滚后历史可读
2. 配对自动创建远程 Agent 数为 0
3. 所有签名统一 RFC 8785 JCS
4. Hub 私钥不以明文落盘
5. Room revision/keyEpoch 单调，并发 CAS 无 split-brain
6. block 立即停投并 rekey
7. 离线投递幂等，receipt/ack 分离
8. 两台真实设备通过 E2E-01~09
9. P2P 有用户入口、发现确认、状态显示
10. Tauri 生产包验证通过

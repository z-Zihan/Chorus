# AgentLink 开发计划 / Development Plan

> 最后更新：2026-08-05
> 规范来源：`docs/CROSS_DEVICE_DESIGN.md`

## 状态说明

- `✅ done`：已完成
- `⏳ todo`：未开始
- **P1**：发布阻断
- **P2**：发布后优化

---

## P1 — 发布阻断 / Release Blockers

### 协议与安全（全部完成）

| ID | 任务 | 状态 |
|---|---|---|
| XDEV-01~12 | TransportReceipt, Room CAS, KeyCommitment, JCS, Hub key keychain, SPAKE2, 32-hex fingerprint, Room revision, Resync, OwnerProof, contact_block, Block rekey | ✅ done |

### 产品流程（全部完成）

| ID | 任务 | 状态 |
|---|---|---|
| FLOW-01 | Contact→Room→owner-only Agent | ✅ done |
| UX-01~10 | Onboarding checklist, 路由可视化, Room Agent 入口, 首次引导, 连通性测试, Room 引导, 成员面板, Relay banner, A2A tooltip, 保存反馈 | ✅ done |

### P2P 产品化（已完成 3/4）

| ID | 任务 | 状态 |
|---|---|---|
| P2P-01 | 设置页 P2P 开关 | ✅ done |
| P2P-02 | 发现确认 UI（不自动连接） | ✅ done |
| P2P-03 | P2P 状态显示 | ✅ done |
| P2P-04 | P2P 消息加密（ECDH 会话密钥） | ⏳ P2 |

### 测试与打包

| ID | 任务 | 状态 |
|---|---|---|
| TEST-01 | 真实双设备 E2E（Relay + P2P + Hybrid） | ⏳ 需物理设备 |
| PKG-01 | Tauri 生产包验证 | ⏳ 需测试后打包 |

---

## P2 — 发布后优化 / Post-Release

| ID | 任务 | 状态 |
|---|---|---|
| P2P-04 | P2P 消息加密 | ⏳ |
| SCALE-02-VAL | 大群加密协商式验收 | ⏳ |
| OPS-01-VAL | Relay 运维验收 | ⏳ |
| RELAY-OPS | 官方 Relay 部署 | ⏳ |

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

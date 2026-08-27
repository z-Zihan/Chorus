# Chorus 开发计划 / Development Plan

> 最后更新：2026-08-27
> 规范来源：`docs/CROSS_DEVICE_DESIGN.md`
> 当前发布门禁与证据以 `design/development-plan.md` 为准；本文件下半部“项目暂停总结”保留为 2026-08-05 历史快照，不代表当前发布完成度。

当前仓库质量基线：Shared 15 + Relay 24 + Server 180 = 219 项单元/集成测试，另有 19 项 Playwright Web E2E；format、lint、typecheck、build 与 Cargo test/check 通过。完整运行证据见仓库根目录 REGRESSION_TEST_REPORT.md 与 CODE_QUALITY_AUDIT.md（2026-08-27 全项目审计）。

## 状态说明

- `✅ done`：已完成
- `⏳ todo`：未开始
- **P1**：发布阻断
- **P2**：发布后优化

---

## P1 — 发布阻断 / Release Blockers

### 协议与安全（实现推进中，真实设备门禁未关闭）

| ID | 任务 | 状态 |
|---|---|---|
| XDEV-01~12 | Relay TransportReceipt、Room CAS、JCS、Hub key、Room revision/Resync 等 | 🔶 进程级完成：TransportReceipt/JCS/持久化 Room CAS（server 增删成员经 relay 协调，冲突 409+resync）/revision/Resync 房间授权均落地并有双实例证据；完整 rekey 群组密钥与物理设备矩阵未关闭 |

### 产品流程（确定性流程已实现，真实设备与故障矩阵未完成）

| ID | 任务 | 状态 |
|---|---|---|
| FLOW-01 | Contact→Room→owner-only Agent | ⏳ 两进程通过；两物理设备未验证 |
| UX-01~10 | Onboarding、路由、Room、A2A 与反馈 | ⏳ 核心实现存在；完整 UI/故障矩阵未关闭 |

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
| PKG-01 | Tauri 生产包验证 | ⏳ arm64 macOS 未签名 `.app` 与 `.dmg` 已生成；签名/公证、DMG 安装、Windows、干净机未完成 |
| UX-LOAD-01 | 会话、消息、Agent 加载失败与重试 | ✅ loading/empty/error 分离；已有消息保留；桌面/375px、明暗、双语验证通过 |
| UX-LOAD-02 | 搜索、设置/隐私、Agent 目录状态真实性 | ✅ 假空态已移除；跨页面依赖错误、重试和移动 44px 触控目标验证通过 |
| UX-LOAD-03 | 定时任务与插件诊断产品入口 | ✅ Scheduler CRUD/回滚/确认/错误恢复和只读插件列表已实现；API 回归与桌面/375px 浏览器交互通过 |
| UX-LOAD-04 | 群成员、联系人和 A2A 状态真实性 | ✅ 群聊崩溃已修复；加载失败/重试、成员增删确认、Room owner-proof 路径和 375px Header 已验证 |
| UX-LOAD-05 | Onboarding、Updater 与会话变更恢复 | ✅ 未知/失败/重试、运行时真实性、安装/重启分离、创建/重命名/置顶/归档/删除失败保真已实现；API 回归与 375px 浏览器交互通过 |
| UX-LOAD-06 | 设置写入与低频动作反馈 | ✅ 凭据清除确认/失败保真、Hub 保存、偏好持久化、导出与配对复制反馈已实现；375px 中文暗色与 English 浅色验证通过 |
| UX-LOAD-07 | 全局状态视觉、响应式与焦点收口 | ✅ 语义状态 Token、Toast、中文导出、320/375/800/1440/极短视口、真实 Chrome 200% zoom、skip link、主键盘路径、Onboarding/设置/配对焦点循环及导出菜单已验证；屏幕阅读器保留人工门禁 |
| UX-LOAD-08 | 全项目低频语义与移动触控矩阵 | ✅ 375px 下八个设置页、配对、搜索、建群、Agent 目录/设置、日志、确认框和群成员菜单均有稳定名称、无横向溢出且有效目标 ≥44px；屏幕阅读器保留人工门禁 |

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

---

## 项目暂停总结 / Project Pause Summary

> **暂停时间**：2026-08-05
> **状态**：开发完成，待真实设备测试和打包验证

### 已完成

- **60+ commits**，从 v0.1 MVP 到完整跨设备协作架构
- **123 tests passed**，server + web + relay typecheck 全部通过
- **所有文档与代码同步**（README/GUIDE/PRD/TECH/RELAY_DESIGN/CROSS_DEVICE_DESIGN/SKILL/DEV_PLAN）
- **两轮设计 review**（Codex 12 issues + CC 7 issues）全部修复

### 完成的模块

| 模块 | 完成度 |
|------|--------|
| P0 身份+安全基线 | 10/10 ✅ |
| P1 产品闭环+外部接入 | 全部 ✅ |
| P2 规模化+互操作 | 4/4 ✅ |
| XDEV 协议安全实现 | 12/12 ✅ |
| P2P 产品化 | 3/3 ✅（P2P-04 加密留 P2） |
| UX 交互闭环 | 10/10 ✅ |
| P2P bug 修复 | 6/6 ✅ |

### 恢复开发时的待办

1. **TEST-01**：两台真实设备 E2E 测试（Relay + P2P + Hybrid）
2. **PKG-01**：`pnpm tauri:build` 打 DMG 验证生产包
3. **P2P-04**：P2P 消息加密（ECDH 会话密钥）
4. **SCALE-02-VAL**：大群加密协商式验收
5. **OPS-01-VAL / RELAY-OPS**：Relay 运维验收 + 官方部署

### 快速恢复指南

```bash
cd ~/Desktop/Crucio/Chorus
git pull
source ~/.nvm/nvm.sh
pnpm install
pnpm --filter @chorus/shared build
pnpm dev  # 开发模式
pnpm test  # 历史快照当时为 123 tests；当前数量见本文件顶部基线
```

参考文档：
- 开发计划：本文件
- 跨设备设计：`docs/CROSS_DEVICE_DESIGN.md`
- 使用指南：`docs/GUIDE.md`
- 技术文档：`docs/TECH.md`
- 外部 Agent 接入：`skills/chorus-platform/SKILL.md`

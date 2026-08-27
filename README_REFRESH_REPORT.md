# README Refresh Report

- 日期：2026-08-27
- 范围：README.md + assets/readme/*（本轮）＋ 全文档治理（见 DOCUMENTATION_AUDIT_REPORT.md）

## Main Problems Before
- 「产品预览」为空 heading，无任何真实截图。
- 三层叙事准确，但跨设备能力缺「并发协调/离线补投」这两个本轮已落地特性的提及。
- DEV_PLAN 基线数字过时（171/18 → 实际 219/19），XDEV 状态未反映 Room CAS 落地。

## Product Positioning
保持不变（与 prompt 推荐一致）：**Local-first workspace for AI agents to communicate and collaborate across CLIs, devices, and teams.** 未堆叠多余定位词。

## Accuracy Changes
- 产品预览：空节 → 4 张真实运行截图。
- 三层能力第三层补充「权威计数器协调 + 离线可靠补投」两句（均为已验证实现）。
- 「已实现」清单新增 Room 并发协调一条。
- FAQ 未改动（逐条核对与代码一致：A2A 三模式、跨设备成熟度、外部接入端点）。

## Maturity Language Changes
- 维持「已可用 / 已实现 / 进程级已实现（物理设备待验收）」三级措辞，未夸大。
- CROSS_DEVICE_DESIGN / RELAY_DESIGN / DEV_PLAN 的状态同步见 DOCUMENTATION_AUDIT_REPORT §3。

## Structure Changes
保持现有结构（hero → 定位 → 三层 → 功能清单 → 预览 → 快速开始 → 支持列表 → Relay → 原理 → FAQ），仅以截图填充预览节——结构本身已符合推荐框架，无需重排。

## Content Removed
无删除（README 无失真或冗余段落）。

## Content Added
- 4 张截图（`assets/readme/`）。
- Room 并发协调功能条目。

## Claims Verified（摘要，全量见审计报告 §4/§5）
- 14 CLI + 3 API Connector 列表 = descriptors.ts + catalog 一致（截图即为目录真实渲染）。
- Quick Start / Relay 部署 / config 示例命令均与 scripts 与类型定义一致。
- A2A 三模式、群聊、权限、外部 REST 均有测试与实机证据。

## Screenshot Design
- 统一 1600×1000 @2x，暗色主题，zh-CN，同一演示数据集（3 个 mock Agent：Claude Code / Codex / Gemini CLI；3 个会话）。
- 无 DevTools、无报错、无真实隐私（演示实例使用独立临时 DB 与 file 凭据，onboarding 已走完，真机扫描出的 CLI 已清理）。

## Screenshot Files
- assets/readme/chorus-desktop-overview.png（Hero：会话流 + Agent 列表）
- assets/readme/chorus-a2a-collaboration.png（差异化：群聊转发链 + A2A 卡片）
- assets/readme/chorus-agent-management.png（Agent 目录全量）
- assets/readme/chorus-scheduled-tasks.png（定时任务设置）

可重复生成：`scripts/readme-screenshots.mjs`（依赖一个已播种的 dev 实例；脚本只负责浏览与截图，不含数据造假）。

## Broken Link Verification
README 相对链接（docs/*、assets/*）全部存在；命令与 package.json/relay compose 一致。

## Remaining Limitations
- 物理双设备、Windows、签名/公证、干净机安装、屏幕阅读器人工验证维持 Pending（README 未宣称完成）。
- Room key 全量轮换方案（设计规范 v1）为 Planned，README 未将其表述为已实现。

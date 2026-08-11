# Chorus 设计 QA

> 日期：2026-08-12
>
> 原型：本地 Web 构建 + 确定性 API fixture + 后端不可用实况
>
> 依据：`design/context.md`、`design/ui-state-matrix.md`、`docs/reviews/autonomous-quality-remediation.md`

## Verdict

**READY — 仅限 E2 Web/浏览器质量范围。** 需求一致性、核心/低频交互、响应式、主题语言、键盘恢复和自动无障碍门禁通过，本轮发现的 P2 漂移已修复。

**NOT RELEASE READY。** 人工屏幕阅读器、原生 Tauri 全矩阵、两台物理设备、Windows、签名/公证和干净机器仍是阻断项。

## 需求一致性

| 要求 | 结果 | 证据 |
| --- | --- | --- |
| conversation-first 主路径可达 | PASS | 会话标题、Composer、侧栏和群聊 fixture 可达 |
| loading/empty/error 不混淆 | PASS | Onboarding 与 conversation-error 专项 E2E；保留历史实况复核 |
| 失败有就地恢复 | PASS | 重新扫描、重新检查配置、会话重试均验证 |
| 跨设备状态不冒充真实连接 | PASS | 测试数据明确为 disconnected；文档保留 E4 门槛 |
| 危险操作默认取消 | PASS | 清除凭据 alertdialog 初始焦点位于“取消” |

## 视觉与响应式

- PASS：320×812、375×812、400×300、800×600、1280×800、1440×900 无页面横向溢出，核心内容和末端动作可达。
- PASS：Light/Dark × zh-CN/en 的语义 Token 和页面状态一致。
- PASS：主按钮使用语义前景色；消息时间、发送状态和折叠动作不再叠加降低对比度的透明度。
- PASS：移动有效交互目标达到 44×44px；桌面密度未被强制放大。
- PASS：设置、搜索、目录、Agent 设置、日志和确认框在窄屏保持可滚动与可关闭。

## 行为与键盘

- PASS：设置 tabs 支持方向键/Home/End；Escape 关闭后焦点返回触发按钮。
- PASS：搜索、A2A 与导出菜单可由键盘打开、移动和关闭。
- PASS：Onboarding 首次失败和连续失败都有恢复动作；重试再次失败后焦点回到重试按钮。
- PASS：会话加载失败保留可见错误与重试，不把错误伪装成空列表。
- PASS：危险确认默认聚焦取消，避免键盘误触破坏性动作。

## Accessibility sanity

- PASS：核心 landmark、skip link、`h1`、Composer 与 Dialog 名称存在。
- PASS：桌面及四种主题/语言组合的 axe serious/critical 违规为 0。
- PASS：可见焦点、焦点循环、焦点返回与 reduced-motion 测试基线存在。
- MANUAL：自动 axe 不能证明完整 WCAG；仍需 VoiceOver/NVDA 阅读顺序、状态播报、快捷键冲突和高对比模式验收。

## 本轮修复清单

| 严重度 | 位置/触发 | 用户影响 | 修改 | 验证 |
| --- | --- | --- | --- | --- |
| P2 | 明暗主题弱文本 | 次级信息难读 | 调整 tertiary/muted Token | 主题矩阵 + axe |
| P2 | 主按钮/用户消息元数据 | 对比随背景和透明度波动 | 统一语义前景并移除额外 opacity | 消息 fixture + 主题矩阵 |
| P2 | Onboarding 连续 503 | 键盘用户重试后失去位置 | 失败稳定后恢复 retry focus | 专项 E2E + 实况复核 |

## 未关闭的 QA 门槛

1. 人工屏幕阅读器与系统高对比模式。
2. Tauri WebView 的同等主题/语言/键盘/失败矩阵。
3. macOS 与 Windows 原生菜单、窗口、权限、防火墙和更新流程。
4. 两台物理设备上的配对、Room、断网重连和状态一致性。
5. 签名安装包在干净机器的安装、升级、卸载与恢复。

Web E2 范围无剩余 P0/P1；上述项目保持发布阻断，不应降级为普通优化。

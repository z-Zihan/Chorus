# Chorus 自动化质量整改报告

> 执行日期：2026-08-12
>
> 代码基线：`main` / `eeb7555597f872d15a9e49297f8f77039a65d753`
>
> 任务定义：`docs/reviews/autonomous-quality-remediation.md`

## 结论

Chorus 的仓库级自主质量整改门禁已通过：自动检查、171 项单元/集成测试、18 项 Web E2E、浏览器 UI 复核、生产构建和 Rust 编译门禁均为绿色；本轮发现的 4 个 P2 UI/无障碍问题已修复并有回归覆盖，P0/P1 新增未关闭项为 0。

当前证据达到 E2（真实浏览器渲染与交互）。历史记录中已有本机未签名 Tauri 包的 E3 证据，但本轮没有重新执行完整原生交互矩阵，不能用本报告把 E2 提升为 E3，也不能宣称 E4/E5 或“发布就绪”。

## 环境与范围

| 项目 | 值 |
| --- | --- |
| 系统 | macOS 26.5.1 / Darwin 25.5.0 / arm64 |
| Node | 24.18.0 |
| pnpm | 9.15.9 |
| Rust | rustc 1.97.1 |
| 分支 | `main` |
| 代码基线 | `eeb7555597f872d15a9e49297f8f77039a65d753` |
| 浏览器自动化 | Playwright 1.62.1，Chromium/Chrome channel |

执行前后均保留用户/系统生成的 `.DS_Store`，未暂存、未删除。测试使用确定性 API fixture 和独立 Vite 进程，没有读取用户数据库或真实凭据。变更扫描只发现测试占位值 `test-key` 和类型/变量名，没有新增真实密钥、私钥、数据库或运行数据。

## 自动化门禁

| 门禁 | 结果 | 证据摘要 |
| --- | --- | --- |
| `pnpm format:check` | PASS | 所有匹配文件符合 Prettier；Drizzle 生成快照明确排除 |
| `pnpm lint` | PASS | ESLint 退出码 0 |
| `pnpm typecheck` | PASS | Shared、Relay、Server、Web 全部通过 |
| `pnpm test` | PASS | Shared 9 + Relay 18 + Server 144 = 171，0 失败 |
| `pnpm test:e2e` | PASS | 18/18，0 跳过，单 worker 独立 Web 进程 |
| `pnpm build` | PASS | Shared、Relay、Server、Web 全部构建成功，无 chunk warning |
| `cargo test` | PASS | Rust 0 项测试；lib/main/doc-test 入口通过 |
| `cargo check` | PASS | Tauri crate 编译检查通过 |
| `git diff --check` | PASS | 无空白错误 |

Rust 当前没有测试用例，因此 Cargo 结果只证明 Rust 工程可编译和测试入口正常，不证明 sidecar 生命周期、WebView 或系统权限的原生行为。

## Web E2E 与 UI QA

18 项 Playwright 测试覆盖：

- 320×812、375×812、400×300、800×600、1280×800、1440×900 六档视口，无页面级横向溢出。
- Light/Dark × zh-CN/en，`html[lang]` 与主题状态一致。
- 主 landmark、skip link、会话 `h1`、Composer 名称、设置 roving tab、Escape 与焦点返回。
- 移动侧栏、搜索、建群、配对、Agent 目录/设置、日志、危险确认和群成员菜单。
- 移动可见交互目标不小于 44×44px。
- Onboarding 扫描失败恢复、连续加载失败后重试焦点、会话加载失败后恢复。
- 群聊 A2A 与导出菜单的 Enter/Space/Escape 键盘路径。
- axe serious/critical 规则在桌面以及四种主题/语言组合中为 0。

额外的真实浏览器人工复核覆盖消息状态 fixture 的桌面/移动渲染、保留历史的会话加载失败、真实后端不可用的 Onboarding 状态、375px 横向溢出，以及重复失败后焦点返回重试按钮。

自动 axe、键盘脚本和 Chromium 渲染不能替代 VoiceOver/NVDA 等人工辅助技术验收。

## 本轮 Bug 修复

| 问题 | 等级 | 根因与修改 | 回归证据 |
| --- | --- | --- | --- |
| 暗色弱文本对比不足 | P2 | 提升 `--text-tertiary`/`--text-muted` 明度 | 主题矩阵 + axe serious/critical |
| 亮色弱文本对比不足 | P2 | 加深对应语义 Token | 主题矩阵 + axe serious/critical |
| 主按钮和用户消息元数据对比不稳定 | P2 | 主按钮改用 `--accent-foreground`；移除元数据的额外透明度 | 主题矩阵、消息状态渲染 |
| Onboarding 连续网络失败后键盘焦点丢失 | P2 | 加入 retry ref，在失败状态稳定后恢复焦点 | 专项 E2E + 真实浏览器失败复核 |

没有发现新的 P0/P1。格式门禁曾被历史 Drizzle 快照和未格式化源码阻断，现已通过 `.prettierignore` 与一次机械格式化收口；这属于工程门禁修复，不作为产品 Bug 计数。

## 构建预算

Vite production build：

| 指标 | 实际 | 预算 | 结果 |
| --- | ---: | ---: | --- |
| 主 Web 入口 minified | 268.25 kB | ≤300 kB | PASS |
| 全部 JavaScript gzip 合计 | 约 272.26 kB | ≤350 kB | PASS |
| CSS gzip | 10.55 kB | ≤15 kB | PASS |

总 JavaScript gzip 使用 Vite 对每个产物输出的 gzip 值求和；不同 gzip 工具因 header 元数据会有轻微差异。

## CI 与文档同步

- PR 工作流已加入 Playwright Chromium 安装，并按 format → lint → typecheck → unit/integration → E2E → build 执行。
- README、开发指南、设计上下文、产品审计和开发计划已同步当前测试口径、浏览器证据和发布边界。
- `DEV_PLAN.md` 的 123 tests 明确标记为 2026-08-05 历史快照，不再代表当前基线。
- `design/qa.md` 记录了 UI 一致性结论和人工门禁。

## 证据等级与未关闭项

| 等级 | 本轮状态 | 说明 |
| --- | --- | --- |
| E1 | PASS | 自动测试、静态门禁、协议回归和生产构建 |
| E2 | PASS | Playwright 与真实浏览器渲染/交互 |
| E3 | 本轮未重验 | 历史存在本机未签名 Tauri 证据；本轮不据此扩张结论 |
| E4 | BLOCKED | 两台物理设备尚未完成 |
| E5 | BLOCKED | 签名、公证和干净机器发布验收尚未完成 |

发布前仍必须关闭：

1. 两台真实物理设备：配对、Room 消息、Relay/P2P/Hybrid 与断网重连矩阵。
2. P2P receipt/state parity 与完整 timeout/retry 故障矩阵。
3. VoiceOver/NVDA 等人工屏幕阅读器验收。
4. Windows 原生构建、WebView UI 和系统集成验证。
5. macOS/Windows 签名、公证、正式 updater artifact。
6. 干净机器安装、升级、卸载和恢复。
7. 真实历史数据库迁移与回滚演练。

因此，本轮结论是“仓库级质量整改完成，发布门禁未完成”。

# AgentLink — 设计规范

> 基于 ui-ux-pro-max skill 生成 + frontend-design skill 指导

## 设计方向

**风格**: 暗色主题 + 精致简约 + 微动效
**参考**: Linear / Raycast / Vercel Dashboard / Arc Browser
**关键词**: Dark, Refined, Compact, Fast, Professional

## 设计 Token

### 颜色系统

```css
:root {
  /* 背景层次 (从深到浅) */
  --bg-base: #0a0a0b;        /* 最深背景 */
  --bg-surface: #131316;      /* 卡片/面板背景 */
  --bg-elevated: #1a1a1f;     /* 悬浮元素 */
  --bg-hover: #222228;        /* hover 状态 */
  --bg-active: #2a2a32;       /* active 状态 */

  /* 文字层次 */
  --text-primary: #f0f0f5;    /* 主文字 */
  --text-secondary: #a0a0ab;  /* 次要文字 */
  --text-tertiary: #6b6b78;   /* 辅助文字 */
  --text-muted: #4a4a55;      /* 静默文字 */

  /* 强调色 — Indigo */
  --accent: #6366f1;          /* 主强调 */
  --accent-hover: #818cf8;    /* hover */
  --accent-active: #4f46e5;   /* active */
  --accent-soft: #6366f120;   /* 软背景 (12% opacity) */

  /* 语义色 */
  --success: #10b981;
  --warning: #f59e0b;
  --error: #ef4444;
  --info: #3b82f6;

  /* 状态色 — Agent */
  --agent-online: #10b981;
  --agent-busy: #f59e0b;
  --agent-offline: #6b6b78;
  --agent-error: #ef4444;

  /* 边框 */
  --border: #2a2a32;
  --border-light: #1f1f26;
  --border-hover: #3a3a45;

  /* 代码块 */
  --code-bg: #0d0d0f;
  --code-border: #1f1f26;
}
```

### 字体

```css
/* 不用 Inter / Roboto / Arial */
--font-display: "Geist", "SF Pro Display", system-ui, sans-serif;
--font-body: "Geist", "SF Pro Text", system-ui, sans-serif;
--font-mono: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
```

> Geist 是 Vercel 的开源字体，风格现代且辨识度高。fallback 到 SF Pro。

### 字号层级

| Token | Size | Line Height | Weight | 用途 |
|-------|------|-------------|--------|------|
| text-xs | 11px | 16px | 400 | 时间戳、辅助 |
| text-sm | 13px | 20px | 400 | 正文、消息 |
| text-base | 14px | 22px | 400 | 输入框 |
| text-md | 15px | 24px | 500 | 标题、Agent名 |
| text-lg | 17px | 28px | 600 | 页面标题 |
| text-xl | 20px | 32px | 700 | 空状态标题 |

### 间距系统

| Token | Value | 用途 |
|-------|-------|------|
| space-1 | 4px | 紧凑间距 |
| space-2 | 8px | 默认间距 |
| space-3 | 12px | 组件内间距 |
| space-4 | 16px | 组件间间距 |
| space-6 | 24px | 区块间距 |
| space-8 | 32px | 大区块间距 |

### 圆角

| Token | Value | 用途 |
|-------|-------|------|
| radius-sm | 6px | 小按钮、badge |
| radius-md | 8px | 输入框、卡片 |
| radius-lg | 12px | 消息气泡 |
| radius-xl | 16px | 大卡片、弹窗 |
| radius-full | 9999px | 头像、圆点 |

### 阴影

```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
--shadow-glow: 0 0 12px rgba(99, 102, 241, 0.3);
```

## 动效规范

| 场景 | 动画 | 时长 | 缓动 |
|------|------|------|------|
| 消息进入 | slideUp + fade | 200ms | ease-out |
| 流式打字 | opacity fade | 50ms | linear |
| Agent 状态变化 | color pulse | 300ms | ease-in-out |
| 侧边栏展开/折叠 | width + opacity | 200ms | ease |
| 按钮 hover | background + transform | 150ms | ease |
| A2A 调用链展开 | height + opacity | 250ms | ease-out |
| 打字指示器 | bounce | 1.4s | ease-in-out (infinite) |

**`prefers-reduced-motion`**: 所有动画降级为 instant (0ms)。

## 组件规范

### 消息气泡

- 用户：右侧，`bg-indigo-600`，`text-white`，`rounded-2xl rounded-br-md`
- Agent：左侧，`bg-gray-800`，`text-gray-100`，`rounded-2xl rounded-bl-md` + Agent 头像
- 代码块：`bg-gray-950`，`rounded-lg`，`font-mono`，语言标签 + 复制按钮
- 最大宽度：70% 容器

### Agent 卡片

- 头像：40x40，渐变背景（indigo → purple），首字母
- 状态灯：8x8 圆点，右下角，带 1px 深色边框
- 名称：`text-md font-medium`
- 描述：`text-sm text-secondary`，单行截断

### 输入框

- `bg-gray-800`，`rounded-lg`，`border border-gray-700`
- focus：`ring-2 ring-indigo-500`
- placeholder：`text-tertiary`
- 发送按钮：`bg-indigo-600 hover:bg-indigo-500`

### A2A 调用链

- 折叠卡片：`bg-gray-900/60 border border-gray-700/50 rounded-xl`
- 展开内容：每条 A2A 消息显示 `AgentA → AgentB` + 内容
- 状态图标：⏳ pending (amber) / 🔄 running (indigo pulse) / ✅ done (green)

## Anti-Patterns（禁止）

- ❌ 用 emoji 当图标（用 SVG: Lucide / Heroicons）
- ❌ Inter / Roboto / Arial 字体
- ❌ 紫色渐变白底（太 "AI 味"）
- ❌ 千篇一律的卡片网格
- ❌ 无 hover/focus 状态
- ❌ 动画超过 400ms

## 检查清单

- [ ] 所有可点击元素有 `cursor-pointer`
- [ ] hover 状态有 150-300ms 过渡
- [ ] 键盘导航 focus 可见
- [ ] 对比度满足 WCAG AA (4.5:1)
- [ ] `prefers-reduced-motion` 支持
- [ ] 响应式：375px, 768px, 1024px, 1440px
- [ ] 空状态 / 加载状态 / 错误状态
- [ ] 代码块有复制按钮


## 桌面端 UI 规范

### 原生窗口

| 属性 | 值 |
|------|-----|
| 窗口标题 | AgentLink |
| 默认尺寸 | 1200 × 800 |
| 最小尺寸 | 800 × 600 |
| 可调整大小 | ✅ |
| 全屏 | 支持 |

### 系统托盘

- 托盘图标：AgentLink logo（16×16 / 32×32）
- 图标样式：macOS 使用 template icon（自动适配深色/浅色模式）
- 右键菜单：
  - 显示窗口
  - 新建会话
  - 退出
- 点击图标：显示/隐藏主窗口
- 关闭窗口时：最小化到托盘（不退出），右键托盘退出

### 原生标题栏

- macOS：使用系统原生标题栏，标题显示 "AgentLink"
- Windows/Linux：原生标题栏 + 应用图标
- 不使用自定义标题栏（保持系统一致性）

### 桌面交互

| 交互 | 行为 |
|------|------|
| Cmd+C / Ctrl+C | 复制选中文本 |
| Cmd+V / Ctrl+V | 粘贴 |
| Cmd+K / Ctrl+K | 全局搜索（v0.3） |
| Cmd+, / Ctrl+, | 打开设置 |
| Cmd+W | 关闭窗口（最小化到托盘） |
| Cmd+Q | 退出应用 |

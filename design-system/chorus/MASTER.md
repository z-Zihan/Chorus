# Chorus Design System — Quiet Signal

Chorus is a communication workspace, not a model marketplace or a generic AI chat template. It should feel calm, technical and trustworthy, becoming visually active only where communication is active.

## Principles

1. Conversation before configuration.
2. State before decoration.
3. Participants have explicit identity and ownership.
4. Configured is not connected; connected is not verified.
5. Dense enough for daily desktop work, never crowded.

## Visual direction

- Neutral graphite surfaces in dark mode and warm paper-white in light mode.
- Low-saturation teal is the collaboration signal and primary action color.
- Amber means waiting, confirmation or degraded operation.
- Red is reserved for destructive actions and failures.
- Borders and tonal shifts establish hierarchy; shadows are reserved for overlays.
- No large gradients, glass cards, neon glow, decorative robots or universal pills.

## Typography

- UI: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Mono: `"SFMono-Regular", "Cascadia Code", "JetBrains Mono", monospace`.
- Body: 14px/1.55. Metadata: 12px/1.4. Page title: 18px/1.3.
- Use weight and spacing for hierarchy. All-caps is reserved for compact protocol labels.

## Spacing and geometry

- Base grid: 4px; scale: 4, 8, 12, 16, 20, 24, 32.
- Controls: 32px compact, 36px default, 40px composer primary action.
- Radius: 6px controls/list rows, 10px cards/popovers, 14px dialogs.
- Desktop sidebar: 288px; compact sidebar: 48px.
- Reading width: 760px; chat workspace maximum: 960px.

## Semantic colors

Components consume semantic CSS variables only:

```text
bg-base / bg-sidebar / bg-surface / bg-elevated / bg-hover / bg-active / bg-selected
text-primary / text-secondary / text-tertiary / text-muted / text-disabled
border-subtle / border-color / border-strong / focus-ring
accent-color / accent-hover / accent-subtle / accent-foreground
status-online / status-busy / status-error / status-info
```

## Interaction

- Hover/press transitions: 120–180ms; no layout-shifting scale effects.
- Every icon-only button has a tooltip and accessible name.
- `:focus-visible` uses a 2px ring plus offset.
- Async actions show pending within 200ms and disable duplicate submission.
- Reduced-motion removes entrance movement and animated cursors/dots.

## State patterns

- Loading: skeleton for content; compact spinner for button actions.
- Empty: concise reason, one primary next step and optional secondary step.
- Error: concrete cause, affected scope and recovery action.
- Offline: persistent but compact banner; local actions remain available.
- Disabled: visibly muted plus adjacent or programmatic reason.
- Success: update affected content; use Toast only for otherwise invisible confirmation.

## Responsive behavior

- `>=1024px`: sidebar + workspace.
- `768–1023px`: narrower sidebar; secondary header actions collapse.
- `<768px`: sidebar drawer; dialogs nearly fill viewport; composer respects safe bottom inset.
- 375px is the smallest web-development viewport; desktop minimum is 800×600.

## Brand mark

Three independent voices converge into a shared conversation signal. The mark must remain recognizable at 16px, avoid letters, and work on light and dark icon backgrounds.

## Anti-patterns

- Agent trees deeper than two visible levels by default.
- Silent failure or console-only recovery.
- Showing “connected” after only saving configuration.
- Emoji as structural/status icons.
- Purple/blue AI gradients, oversized empty-state art, cards around every section.

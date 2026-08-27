// Capture README screenshots from the real running UI (dev server + seeded
// demo data). Deterministic, no secrets, re-runnable: scripts/readme-screenshots.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:5173";
const OUT = "assets/readme";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  locale: "zh-CN",
});

await page.goto(BASE, { waitUntil: "networkidle" });
// Prereq: onboarding already completed via API on the demo instance.
await page.waitForTimeout(2000);

async function shot(name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("saved", name);
}

// 1. Hero — pick the pinned review conversation with content visible
await page.getByText("评审认证流程").first().click();
await page.waitForTimeout(1200);
await shot("chorus-desktop-overview");

// 2. Multi-agent group chat (A2A collaboration surface)
await page.getByText("发布准备讨论").first().click();
await page.waitForTimeout(1200);
await shot("chorus-a2a-collaboration");

// 3. Agent catalog modal (sidebar Agents section, add button)
const catalogTrigger = page.getByRole("button", { name: /添加 Agent|Add Agent/ }).first();
if (await catalogTrigger.isVisible().catch(() => false)) {
  await catalogTrigger.click();
  await page.waitForTimeout(1200);
  await shot("chorus-agent-management");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
} else {
  console.log("catalog trigger not found; skipping");
}

// 4. Scheduled tasks settings (if reachable via settings panel)
const settingsTrigger = page.getByRole("button", { name: /设置|Settings/i }).first();
if (await settingsTrigger.isVisible().catch(() => false)) {
  await settingsTrigger.click();
  await page.waitForTimeout(700);
  const schedTab = page.getByRole("button", { name: /定时任务|Scheduled/i }).first();
  if (await schedTab.isVisible().catch(() => false)) await schedTab.click();
  await page.waitForTimeout(700);
  await shot("chorus-scheduled-tasks");
}

await browser.close();
console.log("done");

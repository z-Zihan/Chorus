import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page, type Route } from "@playwright/test";

type FixtureMode = "default" | "onboarding-error" | "onboarding-load-error" | "conversation-error";

interface FixtureState {
  mode: FixtureMode;
  dmConversationAttempts: number;
}

const fixtureStates = new WeakMap<Page, FixtureState>();

const test = base.extend({
  page: async ({ page }, use) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installApiFixture(page);
    await use(page);
  },
});

const now = Date.now();
const agents = [
  {
    id: "fixture-claude",
    name: "Fixture Claude",
    description: "Deterministic CLI fixture",
    type: "cli",
    status: "online",
    disabled: false,
    ownerId: "fixture-user",
    ownerType: "local",
    owner: { id: "fixture-user", name: "本机用户", kind: "local" },
    capabilities: ["chat"],
    stale: false,
    createdAt: now - 10_000,
    updatedAt: now,
  },
  {
    id: "fixture-codex",
    name: "Fixture Codex",
    description: "Second deterministic CLI fixture",
    type: "cli",
    status: "online",
    disabled: false,
    ownerId: "fixture-user",
    ownerType: "local",
    owner: { id: "fixture-user", name: "本机用户", kind: "local" },
    capabilities: ["chat"],
    stale: false,
    createdAt: now - 9_000,
    updatedAt: now,
  },
  {
    id: "fixture-opencode",
    name: "Fixture OpenCode",
    description: "Available group member fixture",
    type: "cli",
    status: "online",
    disabled: false,
    ownerId: "fixture-user",
    ownerType: "local",
    owner: { id: "fixture-user", name: "本机用户", kind: "local" },
    capabilities: ["chat"],
    stale: false,
    createdAt: now - 8_000,
    updatedAt: now,
  },
];

const dmConversation = {
  id: "fixture-dm",
  title: "Fixture DM",
  type: "dm",
  a2aMode: "off",
  agentIds: ["fixture-claude"],
  pinned: false,
  archived: false,
  createdAt: now - 7_000,
  updatedAt: now,
};

const groupConversation = {
  id: "fixture-group",
  title: "Fixture Group",
  type: "group",
  a2aMode: "mention",
  agentIds: ["fixture-claude", "fixture-codex"],
  pinned: false,
  archived: false,
  createdAt: now - 6_000,
  updatedAt: now - 1_000,
};

const messages = [
  {
    id: "fixture-message-user",
    conversationId: "fixture-dm",
    fromType: "user",
    fromId: "fixture-user",
    content: "你好，Chorus",
    timestamp: now - 2_000,
    status: "done",
  },
  {
    id: "fixture-message-agent",
    conversationId: "fixture-dm",
    fromType: "agent",
    fromId: "fixture-claude",
    content: "确定性 fixture 已就绪。",
    timestamp: now - 1_000,
    status: "done",
  },
];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installApiFixture(page: Page) {
  const fixtureState: FixtureState = { mode: "default", dmConversationAttempts: 0 };
  fixtureStates.set(page, fixtureState);
  await page.addInitScript(() => {
    localStorage.setItem("chorus-lang", "zh-CN");
    localStorage.setItem("chorus-theme", "dark");
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/u, "");
    const method = route.request().method();
    if (path === "/onboarding/status") {
      if (fixtureState.mode === "onboarding-load-error") {
        return json(route, { error: "fixture unavailable" }, 503);
      }
      return json(
        route,
        fixtureState.mode === "onboarding-error"
          ? { step: "error", code: "CLI_SCAN_FAILED", recoverable: true }
          : { step: "completed", detections: [] },
      );
    }
    if (path === "/onboarding/rescan" && fixtureState.mode === "onboarding-error") {
      return json(route, { step: "completed", detections: [] });
    }
    if (path === "/hub/status") return json(route, { relayState: "disconnected", peers: [] });
    if (path === "/hub/room-invitations") return json(route, { invitations: [] });
    if (path === "/hub/config") {
      return json(route, {
        hubId: "fixture-hub",
        displayName: "Fixture Device",
        relayUrl: "",
        p2pEnabled: false,
        p2pPort: 3212,
      });
    }
    if (path === "/hub/p2p/status") {
      return json(route, { enabled: false, port: 3212, connected: [], discovered: [] });
    }
    if (path === "/trust") return json(route, []);
    if (path === "/credentials") {
      return json(route, {
        backend: "system-keychain",
        agents: [{ id: "fixture-claude", name: "Fixture Claude" }],
      });
    }
    if (path === "/scheduler/tasks" || path === "/plugins" || path === "/logs") {
      return json(route, []);
    }
    if (path === "/catalog" || path === "/users") return json(route, []);
    if (/^\/agents\/[^/]+\/metrics$/u.test(path)) {
      return json(route, { totalCalls: 1, successRate: 1, avgLatencyMs: 12, lastCallAt: now });
    }
    if (path === "/agents") return json(route, agents);
    if (/^\/conversations\/[^/]+\/a2a-mode$/u.test(path)) {
      return json(route, { mode: "mention" });
    }
    if (path === "/conversations/fixture-group/members") {
      return json(route, agents.slice(0, 2));
    }
    if (/^\/conversations\/[^/]+\/messages$/u.test(path)) {
      return json(route, path.includes("fixture-dm") ? messages : []);
    }
    if (path === "/conversations" && method === "GET") {
      if (url.searchParams.get("archived") === "true") return json(route, []);
      const type = url.searchParams.get("type");
      if (type === "dm") {
        fixtureState.dmConversationAttempts += 1;
        if (fixtureState.mode === "conversation-error") {
          return json(route, { error: "fixture unavailable" }, 503);
        }
        return json(route, [dmConversation]);
      }
      if (type === "group") return json(route, [groupConversation]);
      return json(route, []);
    }
    if (path === "/messages/search") return json(route, []);
    return json(route, {});
  });
}

function setFixtureMode(page: Page, mode: FixtureMode) {
  const fixtureState = fixtureStates.get(page);
  if (!fixtureState) throw new Error("API fixture must be installed before selecting a mode");
  fixtureState.mode = mode;
  fixtureState.dmConversationAttempts = 0;
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(overflow.page).toBeLessThanOrEqual(overflow.viewport);
}

async function setPreferences(page: Page, language: "en" | "zh-CN", theme: "dark" | "light") {
  await page.addInitScript(
    ({ language: nextLanguage, theme: nextTheme }) => {
      localStorage.setItem("chorus-lang", nextLanguage);
      localStorage.setItem("chorus-theme", nextTheme);
    },
    { language, theme },
  );
}

async function expectNoSeriousAxeViolations(page: Page) {
  const axe = await new AxeBuilder({ page }).analyze();
  const serious = axe.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(serious).toEqual([]);
}

async function expectMobileTargets(page: Page, scope = "body") {
  const smallTargets = await page
    .locator(scope)
    .locator(
      'button,input,textarea,select,a[href],[role="button"],[role="tab"],[role="menuitem"],[role="checkbox"]',
    )
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.width === 0 ||
          rect.height === 0
        ) {
          return [];
        }
        if (rect.width >= 44 && rect.height >= 44) return [];
        const labelRect = element.closest("label")?.getBoundingClientRect();
        if (labelRect && labelRect.width >= 44 && labelRect.height >= 44) return [];
        return [
          {
            tag: element.tagName,
            name:
              element.getAttribute("aria-label") ||
              element.textContent?.trim() ||
              element.getAttribute("placeholder") ||
              "unnamed",
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        ];
      }),
    );
  expect(smallTargets).toEqual([]);
}

test("desktop core semantics, settings keyboard path and serious axe gate", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Fixture DM" })).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "消息" })).toBeVisible();
  await expect(page.getByRole("link", { name: "跳到主要内容" })).toHaveAttribute(
    "href",
    "#main-content",
  );
  await expectNoHorizontalOverflow(page);

  const settingsTrigger = page.getByRole("button", { name: "设置", exact: true });
  await settingsTrigger.click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("tab")).toHaveCount(8);
  const firstTab = settingsDialog.getByRole("tab").first();
  await firstTab.focus();
  await firstTab.press("End");
  await expect(settingsDialog.getByRole("tab", { name: "关于" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(settingsDialog).toBeHidden();
  await expect(settingsTrigger).toBeFocused();

  await expectNoSeriousAxeViolations(page);
});

test("mobile dialogs, settings pages and touch targets remain reachable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "打开侧栏" }).click();

  await page.getByRole("button", { name: "创建群聊", exact: true }).click();
  const groupDialog = page.getByRole("dialog", { name: "创建群聊" });
  await expect(groupDialog).toBeVisible();
  await expectMobileTargets(page, '[role="dialog"]');
  await groupDialog.getByRole("button", { name: "取消" }).click();

  await page.getByRole("button", { name: "配对", exact: true }).click();
  const pairingDialog = page.getByRole("dialog", { name: "添加好友" });
  await expect(pairingDialog.getByRole("textbox", { name: "Hub ID" })).toBeVisible();
  await expectMobileTargets(page, '[role="dialog"]');
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "打开侧栏" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  const tabs = settingsDialog.getByRole("tab");
  await expect(tabs).toHaveCount(8);
  for (const tab of await tabs.all()) {
    await tab.click();
    await expectMobileTargets(page, '[role="dialog"]');
  }
  await expectNoHorizontalOverflow(page);
});

test("mobile group member menu has named and full-size actions", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "打开侧栏" }).click();
  await page.getByRole("button", { name: /^Fixture Group 不到/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Fixture Group" })).toBeVisible();
  await page.getByRole("button", { name: "2", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: /Fixture OpenCode/ })).toBeVisible();
  await expectMobileTargets(page, '[role="menu"]');
  await expectNoHorizontalOverflow(page);
});

for (const viewport of [
  { width: 320, height: 812 },
  { width: 375, height: 812 },
  { width: 400, height: 300 },
  { width: 800, height: 600 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`responsive shell remains reachable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Fixture DM" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "消息" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    if (viewport.width < 768) {
      await page.getByRole("button", { name: "打开侧栏" }).click();
      await expect(page.getByRole("searchbox", { name: "搜索会话..." })).toBeVisible();
      await expect(page.getByRole("button", { name: "关闭侧栏" }).last()).toBeVisible();
      await page.getByRole("button", { name: "关闭侧栏" }).last().click();
      await expect(page.getByRole("button", { name: "打开侧栏" })).toBeVisible();
    } else {
      await expect(page.getByRole("searchbox", { name: "搜索会话..." })).toBeVisible();
    }
  });
}

for (const preferences of [
  { language: "zh-CN" as const, theme: "dark" as const, settings: "设置" },
  { language: "zh-CN" as const, theme: "light" as const, settings: "设置" },
  { language: "en" as const, theme: "dark" as const, settings: "Settings" },
  { language: "en" as const, theme: "light" as const, settings: "Settings" },
]) {
  test(`${preferences.language} ${preferences.theme} theme renders with semantic contrast`, async ({
    page,
  }) => {
    await setPreferences(page, preferences.language, preferences.theme);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", preferences.language);
    await expect(page.locator("html")).toHaveAttribute("data-theme", preferences.theme);
    await expect(
      page.getByRole("button", { name: preferences.settings, exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxeViolations(page);
  });
}

test("low-frequency dialogs and destructive confirmation remain keyboard reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  await page.keyboard.press("Control+k");
  const searchDialog = page.getByRole("dialog", { name: "搜索消息" });
  await expect(searchDialog.getByRole("textbox", { name: "搜索会话历史…" })).toBeFocused();
  await expectMobileTargets(page, '[role="dialog"]');
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "打开侧栏" }).click();
  await page.getByRole("button", { name: "添加 Agent" }).click();
  const catalogDialog = page.getByRole("dialog", { name: "Agent 目录" });
  await expect(catalogDialog).toBeVisible();
  await expectMobileTargets(page, '[role="dialog"]');
  await catalogDialog.getByRole("button", { name: "关闭" }).click();

  await page.keyboard.press("Control+,");
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await settingsDialog.getByRole("tab", { name: "诊断" }).click();
  await settingsDialog.getByRole("button", { name: "查看日志" }).click();
  const logDialog = page.getByRole("dialog", { name: "诊断日志" });
  await expect(logDialog.getByRole("textbox", { name: "搜索日志" })).toBeVisible();
  await expectMobileTargets(page, '[role="dialog"]');
  await page.keyboard.press("Escape");
  await expect(logDialog).toBeHidden();
  await settingsDialog.getByRole("tab", { name: "安全" }).click();
  await settingsDialog.getByRole("button", { name: "清除所有凭据" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "清除全部已保存凭据？" });
  const cancel = confirmation.getByRole("button", { name: "取消" });
  await expect(cancel).toBeFocused();
  await expectMobileTargets(page, '[role="alertdialog"]');
  await cancel.click();
  await expect(confirmation).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

test.describe("onboarding recovery", () => {
  test("onboarding failure exposes a recovery action", async ({ page }) => {
    setFixtureMode(page, "onboarding-error");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const onboarding = page.getByRole("dialog", { name: "选择一个 Agent 开始" });
    await expect(onboarding).toBeVisible();
    await expect(onboarding.getByText("无法扫描本机 CLI，请检查环境后重试")).toBeVisible();
    await onboarding.getByRole("button", { name: "重新扫描" }).click();
    await expect(onboarding).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Fixture DM" })).toBeVisible();
  });

  test("onboarding load retry retains keyboard focus after another failure", async ({ page }) => {
    setFixtureMode(page, "onboarding-load-error");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const retry = page.getByRole("button", { name: "重新检查配置" });
    await expect(retry).toBeFocused();
    await retry.click();
    await expect(retry).toBeFocused();
    await expect(page.getByRole("alert")).toContainText("无法读取初始化状态");
  });
});

test.describe("conversation recovery", () => {
  test("conversation loading failure preserves a visible retry path", async ({ page }) => {
    setFixtureMode(page, "conversation-error");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    const alert = page.getByRole("alert").filter({ hasText: "无法加载会话" });
    await expect(alert).toBeVisible();
    setFixtureMode(page, "default");
    await alert.getByRole("button", { name: "重试" }).click();
    await expect(alert).toBeHidden();
    await expect(page.getByRole("button", { name: /^Fixture DM / })).toBeVisible();
  });
});

test("group A2A and export menus expose named keyboard actions", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /^Fixture Group 不到/ }).click();

  const a2aTrigger = page.getByRole("button", { name: "A2A：@转发" });
  await a2aTrigger.focus();
  await a2aTrigger.press("Enter");
  await expect(page.getByRole("menuitem", { name: /同步调用/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(a2aTrigger).toBeFocused();

  const exportTrigger = page.getByRole("button", { name: "导出" });
  await exportTrigger.focus();
  await exportTrigger.press("Space");
  await expect(page.getByRole("menuitem", { name: "导出为 Markdown" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "导出为 JSON" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(exportTrigger).toBeFocused();
});

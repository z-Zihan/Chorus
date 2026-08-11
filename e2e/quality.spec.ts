import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

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
  await page.addInitScript(() => {
    localStorage.setItem("chorus-lang", "zh-CN");
    localStorage.setItem("chorus-theme", "dark");
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/u, "");
    const method = route.request().method();

    if (path === "/onboarding/status") return json(route, { step: "completed", detections: [] });
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
      return json(route, { backend: "system-keychain", agents: [] });
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
      if (type === "dm") return json(route, [dmConversation]);
      if (type === "group") return json(route, [groupConversation]);
      return json(route, []);
    }
    if (path === "/messages/search") return json(route, []);
    return json(route, {});
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(overflow.page).toBeLessThanOrEqual(overflow.viewport);
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

test.beforeEach(async ({ page }) => {
  await installApiFixture(page);
});

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

  const axe = await new AxeBuilder({ page }).analyze();
  const serious = axe.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(serious).toEqual([]);
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

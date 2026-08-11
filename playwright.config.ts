import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "artifacts/playwright/results",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["line"], ["html", { outputFolder: "artifacts/playwright/report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    locale: "zh-CN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @chorus/web exec vite --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

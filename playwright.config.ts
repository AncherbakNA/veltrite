import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  timeout: 45000,
  reporter: [["list"], ["html", { outputFolder: "../playwright-report", open: "never" }]],
  outputDir: "../test-results",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});

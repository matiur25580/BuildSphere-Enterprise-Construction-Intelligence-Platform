const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run dev --workspace=@buildsphere/api",
      url: "http://127.0.0.1:5000/api/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: "5000",
        DOCUMENT_STORAGE_PROVIDER: "local",
        DOCUMENT_STORAGE_DIR: process.env.DOCUMENT_STORAGE_DIR || "/tmp/buildsphere-e2e-documents",
      },
    },
    {
      command: "npm run dev --workspace=@buildsphere/web -- --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_API_URL: process.env.VITE_API_URL || "http://127.0.0.1:5000/api/v1",
      },
    },
  ],
});

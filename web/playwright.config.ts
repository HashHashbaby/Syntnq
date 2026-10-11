import { defineConfig } from "@playwright/test";

const WEB_PORT = 5174;
// Real GPU in headless Chromium on Windows (software SwiftShader otherwise; frame-rate numbers
// from SwiftShader are not meaningful).
const GPU_ARGS = process.platform === "win32" ? ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--disable-gpu-sandbox"] : [];

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    headless: process.env.HEADED !== "1",
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...GPU_ARGS] },
  },
  webServer: [
    {
      command: `npx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "py -3.12 -m uv run uvicorn synesthesia.api.app:create_app --factory --host 127.0.0.1 --port 8000",
      cwd: "..",
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});

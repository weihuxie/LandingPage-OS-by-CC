import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 配置 · LandingPage
 *
 * - 两个 project:`api`(纯 request)、`e2e`(chromium UI)
 * - test title 以 `<用例ID> · ...` 开头,脚本与用例文档 1:1 对齐
 * - 默认读取 `http://localhost:3000`(Next.js dev server 默认端口)
 * - `webServer` 自动拉起 `npm run dev`,测试结束自动关闭
 *
 * 环境变量:
 *   BASE_URL              — 覆盖默认 baseURL(CI 上可能换端口)
 *   NO_AUTO_WEB_SERVER=1  — 不自动拉起 dev server(自己手动起的场景)
 *   ANTHROPIC_API_KEY     — 带 Claude 的用例才跑
 *   OPENAI_API_KEY        — 带 OpenAI 的用例才跑
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const AUTO_WEB_SERVER = process.env.NO_AUTO_WEB_SERVER !== '1';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // .data/ 是共享文件,串行最稳
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    extraHTTPHeaders: { 'content-type': 'application/json' },
  },
  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      use: { baseURL: BASE_URL },
    },
    {
      name: 'e2e',
      testDir: './tests/e2e',
      // Next.js dev server 第一次编译 /zh-CN/projects/[id] 这条路由可能吃 20-40s
      // (webpack 首次打包 + client hydration)。combined api+e2e 跑时,API 测试
      // 不会触碰 app-router 页面,所以 E2E 第一条用例必然撞到冷编译。给 120s 冗余。
      timeout: 120_000,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL,
        viewport: { width: 1280, height: 800 },
        locale: 'zh-CN',
      },
    },
  ],
  webServer: AUTO_WEB_SERVER
    ? {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});

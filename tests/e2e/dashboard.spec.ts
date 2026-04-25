/**
 * E2E-DASH-* · Dashboard 渲染产品卡片。
 * 对应用例文档:docs/testcases/e2e-testcases.md E2E-DASH 行。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedProject } from '../helpers/seed';

test.describe('E2E-DASH · Dashboard', () => {
  test('E2E-DASH-001 · Dashboard 列出种子产品卡片', async ({ page, request }) => {
    const name = `E2E-DASH-001-${Date.now()}`;
    const tagline = `E2E-DASH-001 tagline ${Date.now()}`;
    const seeded = await seedProject(page.context().request, { name, tagline });
    try {
      await page.goto('/zh-CN/dashboard');
      await expect(page.getByRole('heading', { name: '我的产品' })).toBeVisible();

      // 卡片包含产品名和 tagline
      await expect(page.getByText(name)).toBeVisible();
      await expect(page.getByText(tagline)).toBeVisible();

      // 种子 page 默认 published=false,卡片会显示 "1 页面 · 0 已发布"
      // (Dashboard ProductCard 直接渲染 published 计数而非 "草稿/已发布" 徽章)
      await expect(page.getByText(/1 页面 · 0 已发布/).first()).toBeVisible();
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });
});

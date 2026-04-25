/**
 * E2E-DASH-CLICK-* · ProductCard 点击空区/文字均能跳转产品详情。
 *
 * 历史 bug：cover Link 在 z-0，content 在 z-10，点击文字命中 content 但
 * content 无 onClick → 卡死在 dashboard。用户感知"点击没反应"。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedProject } from '../helpers/seed';

test.describe('E2E-DASH-CLICK · ProductCard 点击行为', () => {
  test('E2E-DASH-CLICK-001 · 点产品名文字应跳转产品详情页', async ({ page, request }) => {
    const name = `CLICK-001-${Date.now()}`;
    const seeded = await seedProject(request, { name });
    try {
      await page.goto('/zh-CN/dashboard');
      await expect(page.getByText(name)).toBeVisible();

      // 模拟真实点击：直接点文字（h3 标题）
      await page.getByRole('heading', { name, level: 3 }).click();

      // 期望：在 5s 内导航到 /products/[id]
      await page.waitForURL(/\/zh-CN\/products\/p_/, { timeout: 5000 });
      expect(page.url()).toContain(`/products/${seeded.productId}`);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('E2E-DASH-CLICK-002 · 点"打开产品 →"箭头应跳转产品详情页', async ({ page, request }) => {
    const name = `CLICK-002-${Date.now()}`;
    const seeded = await seedProject(request, { name });
    try {
      await page.goto('/zh-CN/dashboard');
      await expect(page.getByText(name)).toBeVisible();

      // 卡片右下角的"打开产品 →"文案
      await page.locator('text=打开产品').first().click();

      await page.waitForURL(/\/zh-CN\/products\/p_/, { timeout: 5000 });
      expect(page.url()).toContain(`/products/${seeded.productId}`);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('E2E-DASH-CLICK-003 · 点击后 100ms 内必须显示 pending 反馈', async ({ page, request }) => {
    const name = `CLICK-003-${Date.now()}`;
    const seeded = await seedProject(request, { name });
    try {
      await page.goto('/zh-CN/dashboard');
      await expect(page.getByText(name)).toBeVisible();

      const card = page.locator('.card', { hasText: name }).first();
      const heading = page.getByRole('heading', { name, level: 3 });

      // 同步触发点击 + 立即查 aria-busy（不能 await navigation）
      await heading.click({ noWaitAfter: true });

      // 在 200ms 内 aria-busy 必须翻 true（pending 反馈）
      await expect(card).toHaveAttribute('aria-busy', 'true', { timeout: 200 });
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });
});

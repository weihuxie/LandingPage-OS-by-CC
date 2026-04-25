/**
 * E2E-DASH-CLICK-* · ProductCard 点击行为：每次点击都新开标签页。
 *
 * 历史：原先点 z-10 文字命中 content 但无 onClick → "点击没反应"。
 * 修复后所有点击都走 window.open(_blank)，dashboard 不离开当前 tab，
 * 用户可以连续点开多个产品。cover Link 加 target="_blank" 处理
 * cmd-click / 中键 / 右键"在新标签打开"。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedProject } from '../helpers/seed';

test.describe('E2E-DASH-CLICK · ProductCard 点击行为', () => {
  test('E2E-DASH-CLICK-001 · 点产品名文字应在新标签页打开产品详情', async ({ page, request, context }) => {
    const name = `CLICK-001-${Date.now()}`;
    const seeded = await seedProject(page.context().request, { name });
    try {
      await page.goto('/zh-CN/dashboard');
      await expect(page.getByText(name)).toBeVisible();

      const [newPage] = await Promise.all([
        context.waitForEvent('page', { timeout: 5000 }),
        page.getByRole('heading', { name, level: 3 }).click(),
      ]);

      await newPage.waitForLoadState('domcontentloaded');
      expect(newPage.url()).toContain(`/products/${seeded.productId}`);
      // 原 dashboard 仍然停在当前 tab
      expect(page.url()).toContain('/dashboard');
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });

  test('E2E-DASH-CLICK-002 · 点"新标签页打开"应在新标签页打开产品详情', async ({ page, request, context }) => {
    const name = `CLICK-002-${Date.now()}`;
    const seeded = await seedProject(page.context().request, { name });
    try {
      await page.goto('/zh-CN/dashboard');
      await expect(page.getByText(name)).toBeVisible();

      const [newPage] = await Promise.all([
        context.waitForEvent('page', { timeout: 5000 }),
        page.locator('text=新标签页打开').first().click(),
      ]);

      await newPage.waitForLoadState('domcontentloaded');
      expect(newPage.url()).toContain(`/products/${seeded.productId}`);
      expect(page.url()).toContain('/dashboard');
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });

  test('E2E-DASH-CLICK-003 · 连续点两个产品应打开两个新标签页且 dashboard 不变', async ({ page, request, context }) => {
    const name1 = `CLICK-003a-${Date.now()}`;
    const name2 = `CLICK-003b-${Date.now()}`;
    const seeded1 = await seedProject(page.context().request, { name: name1 });
    const seeded2 = await seedProject(page.context().request, { name: name2 });
    try {
      await page.goto('/zh-CN/dashboard');
      await expect(page.getByText(name1)).toBeVisible();
      await expect(page.getByText(name2)).toBeVisible();

      const [tab1] = await Promise.all([
        context.waitForEvent('page', { timeout: 5000 }),
        page.getByRole('heading', { name: name1, level: 3 }).click(),
      ]);
      const [tab2] = await Promise.all([
        context.waitForEvent('page', { timeout: 5000 }),
        page.getByRole('heading', { name: name2, level: 3 }).click(),
      ]);

      await tab1.waitForLoadState('domcontentloaded');
      await tab2.waitForLoadState('domcontentloaded');
      expect(tab1.url()).toContain(`/products/${seeded1.productId}`);
      expect(tab2.url()).toContain(`/products/${seeded2.productId}`);
      expect(page.url()).toContain('/dashboard');
    } finally {
      await cleanupProject(page.context().request, seeded1.productId);
      await cleanupProject(page.context().request, seeded2.productId);
    }
  });

  test('E2E-DASH-CLICK-004 · 点 kebab 菜单不应打开新标签页', async ({ page, request, context }) => {
    const name = `CLICK-004-${Date.now()}`;
    const seeded = await seedProject(page.context().request, { name });
    try {
      await page.goto('/zh-CN/dashboard');
      await expect(page.getByText(name)).toBeVisible();

      const card = page.locator('.card', { hasText: name }).first();
      const kebab = card.getByRole('button', { name: '更多操作' });

      // 监听 popup,然后点 kebab 不应触发
      let popupCount = 0;
      context.on('page', () => popupCount++);
      await kebab.click();

      // 等 200ms 看有没有意外弹出
      await page.waitForTimeout(200);
      expect(popupCount).toBe(0);
      // dashboard 没动
      expect(page.url()).toContain('/dashboard');
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });
});

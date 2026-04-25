/**
 * E2E-PAGE-001 · 删除 locale tab 后 UI 立即消失。
 * 对应用例文档:docs/testcases/e2e-testcases.md E2E-PAGE-001。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedMultiLocaleProject, getPage } from '../helpers/seed';

test.describe('E2E-PAGE · Delete locale tab', () => {
  test('E2E-PAGE-001 · 删除日文 tab 后立即消失,刷新仍不存在', async ({ page, request }) => {
    const seeded = await seedMultiLocaleProject(page.context().request);
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await expect(page.getByRole('button', { name: /发布|已发布/ })).toBeVisible();

      // 切到日文 tab(删除按钮只在激活 + 非默认 tab 上显示)
      await page.getByRole('button', { name: /日本語/ }).first().click();

      // 拦截 confirm 对话框自动点确认
      page.on('dialog', (d) => d.accept());

      // 点击日文 tab 上的 × 按钮(aria-label 是 "删除 日本語")
      await page.getByRole('button', { name: '删除 日本語' }).click();

      // tab 立即消失
      await expect(page.getByRole('button', { name: /日本語/ })).toHaveCount(0, {
        timeout: 10_000,
      });

      // 刷新后仍不存在
      await page.reload();
      await expect(page.getByRole('button', { name: /日本語/ })).toHaveCount(0);

      // API 落库验证
      const fresh = await getPage(page.context().request, seeded.pageId);
      expect(fresh.availableLocales).not.toContain('ja');
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });
});

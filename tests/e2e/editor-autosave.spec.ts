/**
 * E2E-EDT-* · 编辑器自动保存。
 * 对应用例文档:docs/testcases/e2e-testcases.md E2E-EDT 行。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedProject, getPage } from '../helpers/seed';

test.describe('E2E-EDT · Editor autosave', () => {
  test('E2E-EDT-001 · 编辑 Hero 标题后自动保存并持久化', async ({ page, request }) => {
    const seeded = await seedProject(page.context().request);
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      // 等编辑器加载完成
      await expect(page.getByRole('button', { name: /发布|已发布/ })).toBeVisible();

      // 取初始 page 结构,找到第一个 hero 模块
      const before = await getPage(page.context().request, seeded.pageId);
      const heroIndex = before.variants.A['zh-CN'].findIndex((m: any) => m.type === 'hero');
      expect(heroIndex).toBeGreaterThanOrEqual(0);

      // 左侧模块列表,点中 hero 条目(第 heroIndex+1 个)
      const moduleItem = page.locator('aside ul li').nth(heroIndex);
      await moduleItem.getByRole('button').first().click();

      // 右侧 ModuleEditor 的 Hero headline textarea(ModuleEditor.tsx 的 Field 用 label 包裹)
      const headlineInput = page.locator('label:has-text("Headline") textarea').first();
      await headlineInput.waitFor({ state: 'visible' });

      const newTitle = 'E2E-EDT-001 新标题';
      await headlineInput.fill(newTitle);
      await headlineInput.blur();

      // 等自动保存徽章出现(400ms 防抖 + 网络)
      await expect(
        page.locator('text=/已保存|保存中|●.+已保存/').first(),
      ).toBeVisible({ timeout: 10_000 });

      // 刷新验证持久化
      await page.reload();
      await expect(page.getByRole('button', { name: /发布|已发布/ })).toBeVisible();
      const moduleItemAfter = page.locator('aside ul li').nth(heroIndex);
      await moduleItemAfter.getByRole('button').first().click();
      const headlineAfter = page.locator('label:has-text("Headline") textarea').first();
      await expect(headlineAfter).toHaveValue(newTitle);
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });

  test('E2E-EDT-002 · 编辑实时同步到右侧预览', async ({ page, request }) => {
    const seeded = await seedProject(page.context().request);
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await expect(page.getByRole('button', { name: /发布|已发布/ })).toBeVisible();

      const before = await getPage(page.context().request, seeded.pageId);
      const heroIndex = before.variants.A['zh-CN'].findIndex((m: any) => m.type === 'hero');

      await page.locator('aside ul li').nth(heroIndex).getByRole('button').first().click();
      const headlineInput = page.locator('label:has-text("Headline") textarea').first();
      await headlineInput.waitFor({ state: 'visible' });

      const realtime = 'E2E-EDT-002 实时同步';
      await headlineInput.fill(realtime);

      // 不等防抖 400ms —— preview 应该在 50-100ms 内就反映
      await page.waitForTimeout(100);
      const preview = page.locator('section').getByText(realtime).first();
      await expect(preview).toBeVisible({ timeout: 1_000 });
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });
});

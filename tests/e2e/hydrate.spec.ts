/**
 * E2E-HYD-001/002 · 一键 hydrate(带 key / 无 key 按钮 disabled)。
 * 对应用例文档:docs/testcases/e2e-testcases.md E2E-HYD-001 / E2E-HYD-002。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedProject, patchPageFixture, getPage } from '../helpers/seed';
import { getCapabilities } from '../helpers/capabilities';

test.describe('E2E-HYD · Hydrate banner action', () => {
  test('E2E-HYD-001 · [需 KEY] 从 hydrationFailed 状态一键 hydrate', async ({ page, request }) => {
    const caps = await getCapabilities(request);
    test.skip(!caps.hasClaude, 'requires ANTHROPIC_API_KEY');
    test.setTimeout(180_000);

    const seeded = await seedProject(page.context().request);
    try {
      // 强制 hydrationFailed=true + 可辨识的模板占位 headline
      const page0 = await getPage(page.context().request, seeded.pageId);
      const placeholder = 'TEMPLATE_PLACEHOLDER_HEADLINE_HYD_001';
      const modsA = page0.variants.A['zh-CN'].map((m: any) =>
        m.type === 'hero' ? { ...m, content: { ...m.content, headline: placeholder } } : m,
      );
      const modsB = page0.variants.B['zh-CN'].map((m: any) =>
        m.type === 'hero' ? { ...m, content: { ...m.content, headline: placeholder } } : m,
      );
      await patchPageFixture(seeded.pageId, {
        hydrationFailed: true,
        variants: {
          ...page0.variants,
          A: { ...page0.variants.A, 'zh-CN': modsA },
          B: { ...page0.variants.B, 'zh-CN': modsB },
        },
      });

      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await expect(page.getByRole('button', { name: /发布|已发布/ })).toBeVisible();

      // 顶部红 banner 出现
      await expect(page.getByText('本页 Claude 初始化未成功')).toBeVisible();

      const hydrateBtn = page.getByRole('button', { name: /立即 hydrate/ });
      await expect(hydrateBtn).toBeEnabled();
      await hydrateBtn.click();

      // 等 banner 消失(完成或被 info banner 替换)
      await expect(page.getByText('本页 Claude 初始化未成功')).not.toBeVisible({
        timeout: 120_000,
      });

      // API 层:hero headline 已变
      const fresh = await getPage(page.context().request, seeded.pageId);
      const freshHero = fresh.variants.A['zh-CN'].find((m: any) => m.type === 'hero');
      expect(freshHero.content.headline).not.toBe(placeholder);
      expect(fresh.hydrationFailed).toBe(false);
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });

  test('E2E-HYD-002 · [无 KEY] hydrate 按钮 disabled', async ({ page, request }) => {
    const caps = await getCapabilities(request);
    test.skip(caps.hasClaude, 'only runs when ANTHROPIC_API_KEY is MISSING');

    const seeded = await seedProject(page.context().request);
    try {
      await patchPageFixture(seeded.pageId, { hydrationFailed: true });

      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await expect(page.getByRole('button', { name: /发布|已发布/ })).toBeVisible();

      // 红 banner
      await expect(page.getByText('本页 Claude 初始化未成功')).toBeVisible();

      const hydrateBtn = page.getByRole('button', { name: /立即 hydrate/ });
      await expect(hydrateBtn).toBeDisabled();
      await expect(hydrateBtn).toHaveAttribute(
        'title',
        /需要\s*ANTHROPIC_API_KEY/,
      );

      // 中间区域的"Hero 文案可能仍是模板占位符"黄色警告也存在
      await expect(page.getByText('Hero 文案可能仍是模板占位符')).toBeVisible();

      // API 层 hydrationFailed 未被误触请求刷掉
      const fresh = await getPage(page.context().request, seeded.pageId);
      expect(fresh.hydrationFailed).toBe(true);
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });
});

/**
 * E2E-LOC-003/004 · 添加新语言(带 key / 无 key)。
 * 对应用例文档:docs/testcases/e2e-testcases.md E2E-LOC-003 / E2E-LOC-004。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedProject, getPage } from '../helpers/seed';
import { getCapabilities } from '../helpers/capabilities';

test.describe('E2E-LOC · Add locale', () => {
  test('E2E-LOC-003 · [需 KEY] 端到端加日语', async ({ page, request }) => {
    const caps = await getCapabilities(request);
    test.skip(!caps.ready.addLocale, 'requires ANTHROPIC_API_KEY + OPENAI_API_KEY');
    test.setTimeout(180_000);

    const seeded = await seedProject(request);
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await expect(page.getByRole('button', { name: /发布|已发布/ })).toBeVisible();

      // 展开 + 加语言 下拉
      await page.locator('summary', { hasText: /加语言|生成中/ }).click();
      // 选 日本語
      await page.locator('button', { hasText: '日本語' }).first().click();

      // LocalizationPreviewModal 应打开
      await expect(page.getByText(/为添加 日本語 版本定制本地化策略/)).toBeVisible({
        timeout: 10_000,
      });

      // 审批
      // LocalizationPreviewModal 主 CTA:确认并生成 →
      await page.getByRole('button', { name: /确认并生成/ }).click();

      // 等 "生成中…" 出现并最终消失,日文 tab 出现
      await expect(page.getByRole('button', { name: /日本語/ }).first()).toBeVisible({
        timeout: 120_000,
      });

      // 日文 tab 被激活
      await expect(page.getByRole('button', { name: /日本語/ }).first()).toHaveClass(
        /border-brand-600/,
      );

      // API 层验证落库
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.availableLocales).toContain('ja');
      const heroJa = fresh.variants.A.ja?.find((m: any) => m.type === 'hero');
      const heroZh = fresh.variants.A['zh-CN'].find((m: any) => m.type === 'hero');
      expect(heroJa?.content?.headline).toBeTruthy();
      expect(heroJa.content.headline).not.toBe(heroZh.content.headline);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('E2E-LOC-004 · [无 KEY] 加语言失败 → 红 banner,tab 未被加', async ({ page, request }) => {
    const caps = await getCapabilities(request);
    test.skip(caps.ready.addLocale, 'only runs when Claude/OpenAI key is MISSING');

    const seeded = await seedProject(request);
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await expect(page.getByRole('button', { name: /发布|已发布/ })).toBeVisible();

      await page.locator('summary', { hasText: /加语言|生成中/ }).click();
      await page.locator('button', { hasText: '日本語' }).first().click();

      // Preview modal 出现(preview 不需 key,能正常渲染)
      await expect(page.getByText(/为添加 日本語 版本定制本地化策略/)).toBeVisible({
        timeout: 10_000,
      });

      // 点审批,此时 POST /api/pages/[id]/locales 会 503
      // LocalizationPreviewModal 主 CTA:确认并生成 →
      await page.getByRole('button', { name: /确认并生成/ }).click();

      // 顶部红 banner:需要配置 LLM API Key
      await expect(page.getByText(/需要配置.*API.*Key|LLM API Key/).first()).toBeVisible({
        timeout: 15_000,
      });
      // banner 内含缺少的 key 名称
      await expect(
        page.locator('text=/ANTHROPIC_API_KEY|OPENAI_API_KEY/').first(),
      ).toBeVisible();

      // 日文 tab 未被加入 — 直接走 API 断言,避免与下拉中的同名按钮混淆
      // (UI 层"日本語" button 还会出现在 + 加语言下拉里,只有 API 能区分)
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.availableLocales).toEqual(['zh-CN']);
      expect(fresh.variants.A.ja).toBeUndefined();
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });
});

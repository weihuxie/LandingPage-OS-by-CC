/**
 * E2E-LOC-001/002 · 切 locale tab + 跨 locale 编辑隔离。
 * 对应用例文档:docs/testcases/e2e-testcases.md E2E-LOC-001/002。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedMultiLocaleProject, getPage } from '../helpers/seed';

test.describe('E2E-LOC · Locale switch & isolation', () => {
  test('E2E-LOC-001 · 切到日文 tab,preview + 模块列表显示日文内容', async ({
    page,
    request,
  }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await expect(page.getByRole('button', { name: /发布|已发布/ })).toBeVisible();

      // 默认 tab 是 "简体中文 ★"
      const zhTab = page.getByRole('button', { name: /简体中文.*★/ });
      await expect(zhTab).toBeVisible();

      // 右侧 preview 显示中文主标题
      await expect(page.locator('section').getByText(seeded.zhHeroHeadline)).toBeVisible();

      // 点日文 tab
      const jaTab = page.getByRole('button', { name: /日本語/ }).first();
      await jaTab.click();

      // 日文 tab 激活,preview 换成日文
      await expect(jaTab).toHaveClass(/border-brand-600/);
      await expect(page.locator('section').getByText(seeded.jaHeroHeadline)).toBeVisible();

      // ★ 仍在 zh-CN(默认 locale 位置不变)
      await expect(page.getByRole('button', { name: /简体中文.*★/ })).toBeVisible();
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('E2E-LOC-002 · 在日文 tab 编辑 → 切中文 → 切回日文,编辑隔离', async ({
    page,
    request,
  }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await expect(page.getByRole('button', { name: /发布|已发布/ })).toBeVisible();

      // 切到日文 tab
      await page.getByRole('button', { name: /日本語/ }).first().click();

      // 找到 Hero 模块在列表里的位置(两 variant 的索引可能不同,fixture 构造时 hero 应在首位)
      const before = await getPage(request, seeded.pageId);
      const heroIdx = before.variants.A.ja.findIndex((m: any) => m.type === 'hero');
      expect(heroIdx).toBeGreaterThanOrEqual(0);

      // 点中 hero 模块,改标题
      await page.locator('aside ul li').nth(heroIdx).getByRole('button').first().click();
      const headline = page.locator('label:has-text("Headline") textarea').first();
      await headline.waitFor({ state: 'visible' });

      const newJaTitle = 'E2E-LOC-002 日本語 edit';
      await headline.fill(newJaTitle);
      await headline.blur();

      // 等自动保存徽章 —— 400ms 防抖 + 网络
      await expect(page.locator('text=/已保存|保存中/').first()).toBeVisible({ timeout: 8_000 });
      await page.waitForTimeout(1_500); // 保证落库

      // 切回中文 tab,中文 hero 应未被波及
      await page.getByRole('button', { name: /简体中文/ }).first().click();
      await page.locator('aside ul li').nth(heroIdx).getByRole('button').first().click();
      const zhHeadline = page.locator('label:has-text("Headline") textarea').first();
      await expect(zhHeadline).toHaveValue(seeded.zhHeroHeadline);

      // 切回日文,新标题仍在
      await page.getByRole('button', { name: /日本語/ }).first().click();
      await page.locator('aside ul li').nth(heroIdx).getByRole('button').first().click();
      const jaHeadline = page.locator('label:has-text("Headline") textarea').first();
      await expect(jaHeadline).toHaveValue(newJaTitle);

      // 刷新后仍保持
      await page.reload();
      await expect(page.getByRole('button', { name: /发布|已发布/ })).toBeVisible();
      await page.getByRole('button', { name: /日本語/ }).first().click();
      await page.locator('aside ul li').nth(heroIdx).getByRole('button').first().click();
      const jaAfterReload = page.locator('label:has-text("Headline") textarea').first();
      await expect(jaAfterReload).toHaveValue(newJaTitle);

      // API 层落库验证
      const fresh = await getPage(request, seeded.pageId);
      const jaHero = fresh.variants.A.ja.find((m: any) => m.type === 'hero');
      const zhHero = fresh.variants.A['zh-CN'].find((m: any) => m.type === 'hero');
      expect(jaHero.content.headline).toBe(newJaTitle);
      expect(zhHero.content.headline).toBe(seeded.zhHeroHeadline);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });
});

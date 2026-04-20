/**
 * E2E-VAR-* · A/B variant 切换
 * E2E-PUB-* · 发布流程(无 Vercel 凭据场景 — 回滚 UI)
 * 对应用例文档:docs/testcases/e2e-testcases.md E2E-VAR / E2E-PUB 行。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedProject, getPage } from '../helpers/seed';
import { getCapabilities } from '../helpers/capabilities';

test.describe('E2E-VAR · A/B Variant switch', () => {
  test('E2E-VAR-001 · 切到方案 B,模块顺序切换', async ({ page, request }) => {
    const seeded = await seedProject(request);
    try {
      const before = await getPage(request, seeded.pageId);
      const modsA = before.variants.A['zh-CN'];
      const modsB = before.variants.B['zh-CN'];
      // A 是 10 模块(含 pain),B 是 9 模块(跳过 pain,收益优先)
      // A/B 的顺序在 generateVariants 里 hard-code,length 差异是稳定不变量
      expect(modsA.length).toBeGreaterThan(modsB.length);
      // 且 A 含 pain、B 不含
      expect(modsA.some((m: any) => m.type === 'pain')).toBe(true);
      expect(modsB.some((m: any) => m.type === 'pain')).toBe(false);

      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await expect(page.getByRole('button', { name: /发布|已发布/ })).toBeVisible();

      // 左侧模块列表第二项的 type 标签(i18n 后的人类可读文本)
      // 断言方式:通过 page.evaluate 读取 React state 不现实,改为看
      //   a) 顶部 "方案 B · 收益" 按钮被高亮
      //   b) 左侧模块列表数量变化(B 比 A 少一个 pain 模块)
      await page.getByRole('button', { name: /方案\s*B/ }).click();

      // 按钮进入激活态
      await expect(page.getByRole('button', { name: /方案\s*B/ })).toHaveClass(/bg-ink-900/);

      // 左侧模块列表长度应等于 modsB 的长度
      // Editor 有两个 <aside>:左侧是模块列表,右侧是 ModuleEditor(也含 ul)。
      // 用 "页面模块" label 来定位到左侧的那个。
      const moduleList = page
        .locator('aside')
        .filter({ has: page.locator('.label', { hasText: '页面模块' }) });
      const listItems = moduleList.locator('> div > ul > li');
      await expect(listItems).toHaveCount(modsB.length);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });
});

test.describe('E2E-PUB · Publish', () => {
  test('E2E-PUB-001 · 无 VC_API_TOKEN 场景下 publish 回滚', async ({ page, request }) => {
    const caps = await getCapabilities(request);
    test.skip(caps.hasDeploy, 'only runs when VC_API_TOKEN is MISSING');

    const seeded = await seedProject(request);
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      const publishBtn = page.getByRole('button', { name: /^发布$|发布中|已发布/ });
      await expect(publishBtn).toBeVisible();
      await expect(publishBtn).toHaveText(/发布/);

      await publishBtn.click();

      // 无 key 场景下,deploy 会被质量门挡住:
      //   a) 如果 Claude 没改写过 hero → 触发 409 HERO_IS_TEMPLATE
      //      (editor.tsx readStructuredError → "主视觉文案仍是模板")
      //   b) 如果 hero 已改写但 VC_API_TOKEN 缺 → 503 DEPLOY_REQUIRED
      //      ("需要配置部署凭据")
      // 无论哪条分支都会通过 NoticeBanner(role=alert)展示,且 published 都会被回滚。
      const banner = page.getByRole('alert').first();
      await expect(banner).toBeVisible({ timeout: 10_000 });
      await expect(banner).toContainText(
        /需要配置部署凭据|主视觉文案仍是模板|HERO_IS_TEMPLATE|DEPLOY_REQUIRED/,
      );

      // 按钮回滚到"发布"
      await expect(publishBtn).toHaveText(/^发布$/, { timeout: 10_000 });

      // 服务端 page.published 回滚到 false(因为 deploy 失败后 editor 会二次 PATCH 清回 false)
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.published).toBe(false);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });
});

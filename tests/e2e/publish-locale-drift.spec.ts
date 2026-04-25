/**
 * E2E-PUB-LOC-* · 发布后编辑器不应漂回源语言。
 *
 * Bug: 用户在目标语言 tab（如 ja）点 发布。
 *  1. togglePublish PATCH published=true
 *  2. deployToVercel POST /deploy → 成功 → setProject(data.project)
 *  3. 服务端的 projectViewFromV2 总是用 page.defaultLocale 锚 modules，
 *     于是 project.modules 被 zh-CN 内容覆盖
 *  4. mirror useEffect 把 zh-CN modules 写回 page.variants[A][ja]
 *     ——目标语言 slot 当场被源语言污染
 *  5. UI 重渲染显示中文文案；editingLocale state 不变所以 tab 视觉
 *     还停在 ja，"查看"链接的 ?lang=ja 也不动
 *
 * 现象：用户报"界面被刷新成源语言"+"查看打开的是目标语言"——这就是
 * 这个错位。修复：deploy 响应只能合并 published / deploy / publishedLocales
 * 等发布相关字段，禁止覆盖 modules。
 *
 * 因为本地 dev 没 VC_API_TOKEN，/api/.../deploy 会 503，bug 不会自然
 * 触发。用 page.route mock 一个成功响应，复刻服务端会返回的形状。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedMultiLocaleProject, getPage } from '../helpers/seed';

test.describe('E2E-PUB-LOC · Publish locale drift', () => {
  test('E2E-PUB-LOC-001 · 在 ja tab 发布后，UI 仍停在 ja，hero 仍是日文', async ({
    page,
    request,
  }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await expect(page.getByRole('button', { name: /发布|已发布/ })).toBeVisible();

      // 切到日文 tab
      await page.getByRole('button', { name: /日本語/ }).first().click();
      await expect(
        page.locator('section').getByText(seeded.jaHeroHeadline),
      ).toBeVisible();

      // 用真实 API 先抓出 zh-CN 的 ProjectView 形状（projectViewFromV2 用
      // page.defaultLocale 锚 modules），mock /deploy 时直接复用这份 zh
      // 视图—— 这就是 prod 上服务端 deploy handler 实际返回的内容
      const fakeProjectRes = await request.get(`/api/projects/${seeded.pageId}`);
      const fakeProject = (await fakeProjectRes.json()).project;

      // Mock /deploy 走成功分支，模拟 prod 触发 setProject(data.project)
      await page.route(`**/api/projects/${seeded.pageId}/deploy`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            project: {
              ...fakeProject,
              published: true,
              deploy: {
                url: 'https://example-fake.vercel.app',
                status: 'READY',
                deployedAt: Date.now(),
              },
            },
          }),
        });
      });

      // 点 发布
      const publishBtn = page.getByRole('button', { name: /^发布$/ });
      await publishBtn.click();

      // 等到状态切换到"已发布"——确保 togglePublish 走完了 PATCH+deploy
      await expect(page.getByRole('button', { name: /已发布/ })).toBeVisible({ timeout: 5000 });

      // 1. 日文 tab 仍激活
      const jaTab = page.getByRole('button', { name: /日本語/ }).first();
      await expect(jaTab).toHaveClass(/border-brand-600/);

      // 2. preview 仍显示日文主标题（不应被源语言覆盖）
      await expect(
        page.locator('section').getByText(seeded.jaHeroHeadline),
      ).toBeVisible();

      // 3. 中文主标题不应在当前 preview 出现
      await expect(
        page.locator('section').getByText(seeded.zhHeroHeadline),
      ).not.toBeVisible();
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('E2E-PUB-LOC-002 · 发布后 page.variants[A][ja] 不应被 zh 内容污染', async ({
    page,
    request,
  }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await expect(page.getByRole('button', { name: /发布|已发布/ })).toBeVisible();

      // 切到日文 tab
      await page.getByRole('button', { name: /日本語/ }).first().click();

      const fakeProjectRes = await request.get(`/api/projects/${seeded.pageId}`);
      const fakeProject = (await fakeProjectRes.json()).project;
      await page.route(`**/api/projects/${seeded.pageId}/deploy`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            project: {
              ...fakeProject,
              published: true,
              deploy: {
                url: 'https://example-fake.vercel.app',
                status: 'READY',
                deployedAt: Date.now(),
              },
            },
          }),
        });
      });

      await page.getByRole('button', { name: /^发布$/ }).click();
      await expect(page.getByRole('button', { name: /已发布/ })).toBeVisible({ timeout: 5000 });

      // 等 autosave debounce 落库 —— 如果 mirror useEffect 把 zh-CN
      // modules 写到了 page.variants[A][ja]，autosave 就会把这个污染
      // 落到 KV
      await page.waitForTimeout(2000);

      const after = await getPage(request, seeded.pageId);
      const heroJa = after.variants.A.ja.find((m: any) => m.type === 'hero');
      expect(heroJa?.content?.headline).toBe(seeded.jaHeroHeadline);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });
});

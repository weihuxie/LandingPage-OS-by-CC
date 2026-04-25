/**
 * E2E-LOC-P · 平行-locale 公开页渲染 (P4 of 方案 B · 2026-04 refactor).
 *
 * 覆盖两条路径:
 *   - /p/[slug]/[locale]           直接命中对应 sibling,独立渲染
 *   - /p/[slug]                    当 group 存在时 307 到探测到的 locale
 *
 * 不需要 LLM key —— seedMultiLocaleProject 已把 zh-CN / ja hero 直接写到
 * fixture;迁移走的是结构变换,不跑翻译。所以只需 MULTI_LOCALE_AS_INSTANCES
 * + ADMIN_PASSWORD(用来跑 /api/admin/migrate-locales)。
 */
import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import {
  cleanupProject,
  seedMultiLocaleProject,
  patchPageFixture,
} from '../helpers/seed';
import { getAdminPassword, loginAdminViaContext } from '../helpers/admin';

/**
 * 建一个 zh-CN + ja 都已发布的平行 group,返回两个 sibling 的 id + slug。
 * Primary 的 published 状态在 seedProject 后不确定,统一用 patchPageFixture
 * 打到 published=true,避免 /p/[slug] 的 "未发布 shell" 把测试吞掉。
 */
async function setupTwoPublishedSiblings(
  request: APIRequestContext,
  context: BrowserContext,
) {
  const seeded = await seedMultiLocaleProject(context.request);
  await loginAdminViaContext(context);

  const migrateRes = await context.request.post(
    `/api/admin/migrate-locales?pageId=${seeded.pageId}`,
  );
  expect(migrateRes.status()).toBe(200);
  const migrateBody = await migrateRes.json();
  expect(migrateBody.applied).toHaveLength(1);
  const jaSiblingId: string = migrateBody.applied[0].newSiblingIds[0];
  expect(jaSiblingId).toBeTruthy();

  const now = Date.now();
  await patchPageFixture(seeded.pageId, { published: true, publishedAt: now });
  await patchPageFixture(jaSiblingId, { published: true, publishedAt: now });

  return { ...seeded, jaSiblingId };
}

test.describe('E2E-LOC-P · Parallel locale public render', () => {
  test.skip(
    !process.env.MULTI_LOCALE_AS_INSTANCES,
    'requires MULTI_LOCALE_AS_INSTANCES=1 (dev server must also boot with it)',
  );
  test.skip(
    !getAdminPassword(),
    'requires ADMIN_PASSWORD for /api/admin/migrate-locales',
  );

  test('E2E-LOC-P001 · /p/[slug]/[locale] 独立渲染', async ({ page, context, request }) => {
    const seeded = await setupTwoPublishedSiblings(request, context);
    try {
      await page.goto(`/p/${seeded.slug}/zh-CN`);
      await expect(page.getByText(seeded.zhHeroHeadline).first()).toBeVisible();
      // 反向校验:zh-CN 路径下不应看到日文文案,证明 sibling 真的各自独立。
      await expect(page.getByText(seeded.jaHeroHeadline)).toHaveCount(0);

      await page.goto(`/p/${seeded.slug}/ja`);
      await expect(page.getByText(seeded.jaHeroHeadline).first()).toBeVisible();
      await expect(page.getByText(seeded.zhHeroHeadline)).toHaveCount(0);
    } finally {
      await cleanupProject(context.request, seeded.productId);
    }
  });

  test('E2E-LOC-P002 · /p/[slug] 307 到探测 locale', async ({ page, context, request }) => {
    const seeded = await setupTwoPublishedSiblings(request, context);
    try {
      await page.goto(`/p/${seeded.slug}`);
      // 落点 URL 必须有 /locale 段 —— 不再停留在裸 slug。
      await expect(page).toHaveURL(
        new RegExp(`/p/${seeded.slug}/(zh-CN|ja)(\\?|$)`),
      );
      // 页面体内应出现两个 hero 之一(具体命中哪个受 accept-language / cookie /
      // IP 探测影响,这里不锁定,只校验"渲染了某个 sibling"而不是落到未发布 shell)。
      const bodyText = await page.textContent('body');
      const hasZh = bodyText?.includes(seeded.zhHeroHeadline) ?? false;
      const hasJa = bodyText?.includes(seeded.jaHeroHeadline) ?? false;
      expect(hasZh || hasJa).toBe(true);
    } finally {
      await cleanupProject(context.request, seeded.productId);
    }
  });
});

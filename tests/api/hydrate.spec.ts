/**
 * API-HYD-* · hydrate 端点(Claude 重跑当前 locale)。
 * 对应用例文档:docs/testcases/api-testcases.md API-HYD 行。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedProject, patchPageFixture, getPage } from '../helpers/seed';
import { getCapabilities } from '../helpers/capabilities';

test.describe('API-HYD · Hydrate', () => {
  test('API-HYD-001 · [需 KEY] 重跑 Claude hydrate 当前 locale', async ({ request }) => {
    const caps = await getCapabilities(request);
    test.skip(!caps.hasClaude, 'requires ANTHROPIC_API_KEY');
    test.setTimeout(120_000);

    const seeded = await seedProject(request);
    try {
      // 把 hero headline 强制改成可辨识的占位,hydrationFailed=true
      const page = await getPage(request, seeded.pageId);
      const modsA = page.variants.A['zh-CN'].map((m: any) =>
        m.type === 'hero'
          ? { ...m, content: { ...m.content, headline: 'TEMPLATE_PLACEHOLDER_HEADLINE' } }
          : m,
      );
      const modsB = page.variants.B['zh-CN'].map((m: any) =>
        m.type === 'hero'
          ? { ...m, content: { ...m.content, headline: 'TEMPLATE_PLACEHOLDER_HEADLINE' } }
          : m,
      );
      await patchPageFixture(seeded.pageId, {
        hydrationFailed: true,
        variants: {
          ...page.variants,
          A: { ...page.variants.A, 'zh-CN': modsA },
          B: { ...page.variants.B, 'zh-CN': modsB },
        },
      });

      const res = await request.post(`/api/pages/${seeded.pageId}/hydrate`, {
        data: { locale: 'zh-CN' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.locales).toEqual(['zh-CN']);
      const heroA = body.page.variants.A['zh-CN'].find((m: any) => m.type === 'hero');
      expect(heroA.content.headline).not.toBe('TEMPLATE_PLACEHOLDER_HEADLINE');
      expect(heroA.content.headline).toBeTruthy();

      // 落库
      const fresh = await getPage(request, seeded.pageId);
      const freshHero = fresh.variants.A['zh-CN'].find((m: any) => m.type === 'hero');
      expect(freshHero.content.headline).not.toBe('TEMPLATE_PLACEHOLDER_HEADLINE');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-HYD-002 · [无 KEY] Hydrate 失败走 LLM_REQUIRED', async ({ request }) => {
    const caps = await getCapabilities(request);
    test.skip(caps.hasClaude, 'requires MISSING ANTHROPIC_API_KEY');

    const seeded = await seedProject(request);
    try {
      await patchPageFixture(seeded.pageId, { hydrationFailed: true });

      const before = await getPage(request, seeded.pageId);
      const heroBefore = before.variants.A['zh-CN'].find((m: any) => m.type === 'hero');

      const res = await request.post(`/api/pages/${seeded.pageId}/hydrate`, {
        data: { locale: 'zh-CN' },
      });
      expect(res.status()).toBe(503);
      const body = await res.json();
      expect(body.code).toBe('LLM_REQUIRED');
      expect(body.missing).toBe('ANTHROPIC_API_KEY');

      // 落库未变
      const fresh = await getPage(request, seeded.pageId);
      const heroFresh = fresh.variants.A['zh-CN'].find((m: any) => m.type === 'hero');
      expect(heroFresh.content.headline).toBe(heroBefore.content.headline);
      expect(fresh.hydrationFailed).toBe(true);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-HYD-003 · Hydrate 非法 locale(UNKNOWN_LOCALE)', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const res = await request.post(`/api/pages/${seeded.pageId}/hydrate`, {
        data: { locale: 'ja' }, // ja 未加入 availableLocales
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('UNKNOWN_LOCALE');
      expect(body.error).toBe('unknown-locale');
      expect(body.message).toContain('ja');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });
});

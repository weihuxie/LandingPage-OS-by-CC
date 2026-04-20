/**
 * API-LOC-* · 多语言相关的读/写/删/预览/添加。
 * 对应用例文档:docs/testcases/api-testcases.md API-LOC 行。
 *
 * 其中 LOC-006(带双 key 添加日语)是 [需 KEY] 用例,用 test.skip 守护。
 */
import { test, expect } from '@playwright/test';
import {
  cleanupProject,
  seedProject,
  seedMultiLocaleProject,
  getPage,
  patchPageFixture,
} from '../helpers/seed';
import { getCapabilities } from '../helpers/capabilities';

test.describe('API-LOC · Locales', () => {
  test('API-LOC-001 · 跨 locale 单元格写入隔离', async ({ request }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      const before = await getPage(request, seeded.pageId);
      const zhA = JSON.stringify(before.variants.A['zh-CN']);
      const zhB = JSON.stringify(before.variants.B['zh-CN']);
      const jaB = JSON.stringify(before.variants.B.ja);

      const res = await request.patch(`/api/pages/${seeded.pageId}/modules`, {
        data: {
          variant: 'A',
          locale: 'ja',
          modules: [
            {
              id: 'm_ja',
              type: 'hero',
              content: { headline: '日本語のヘッドライン' },
            },
          ],
        },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.page.variants.A.ja.length).toBe(1);
      expect(body.page.variants.A.ja[0].content.headline).toBe('日本語のヘッドライン');

      // 其他单元格不被波及
      expect(JSON.stringify(body.page.variants.A['zh-CN'])).toBe(zhA);
      expect(JSON.stringify(body.page.variants.B['zh-CN'])).toBe(zhB);
      expect(JSON.stringify(body.page.variants.B.ja)).toBe(jaB);

      // 落库隔离
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.variants.A.ja[0].content.headline).toBe('日本語のヘッドライン');
      expect(JSON.stringify(fresh.variants.A['zh-CN'])).toBe(zhA);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-002 · 切换 defaultLocale', async ({ request }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      // A · 合法
      const okRes = await request.patch(`/api/pages/${seeded.pageId}`, {
        data: { defaultLocale: 'ja' },
      });
      expect(okRes.status()).toBe(200);
      expect((await okRes.json()).page.defaultLocale).toBe('ja');

      // B · 非法 (en 未加到 availableLocales) → 静默忽略,保留上一次值
      const badRes = await request.patch(`/api/pages/${seeded.pageId}`, {
        data: { defaultLocale: 'en' },
      });
      expect(badRes.status()).toBe(200);
      expect((await badRes.json()).page.defaultLocale).toBe('ja');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-003 · 删除非默认语言', async ({ request }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      const res = await request.delete(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'ja' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.page.availableLocales).toEqual(['zh-CN']);
      expect(body.page.variants.A.ja).toBeUndefined();
      expect(body.page.variants.B.ja).toBeUndefined();
      expect(body.page.defaultLocale).toBe('zh-CN');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-004 · 拒绝删除默认语言(仍有其他 locale 时)', async ({ request }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      const res = await request.delete(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'zh-CN' },
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('cannot remove default locale');

      // availableLocales 未变
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.availableLocales.sort()).toEqual(['ja', 'zh-CN']);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-005 · 预览本地化策略(无需 key)', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const res = await request.post(`/api/pages/${seeded.pageId}/locales/preview`, {
        data: { locale: 'ja' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.strategy).toBeTruthy();
      expect(body.strategy.targetLocale).toBe('ja');
      expect(body.strategy.targetMarket).toBe('JP');
      expect(body.strategy.recommendedStyle).toBeDefined();
      expect(Array.isArray(body.strategy.recommendedModuleOrder)).toBe(true);
      expect(body.strategy.formChanges).toBeDefined();

      // availableLocales 未变(preview 只读)
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.availableLocales).toEqual(['zh-CN']);

      // 带自定义 market 再发一次
      const res2 = await request.post(`/api/pages/${seeded.pageId}/locales/preview`, {
        data: { locale: 'ja', market: 'US' },
      });
      const body2 = await res2.json();
      expect(body2.strategy.targetMarket).toBe('US');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-006 · [需 KEY] 添加一门新语言', async ({ request }) => {
    const caps = await getCapabilities(request);
    test.skip(!caps.ready.addLocale, 'requires ANTHROPIC_API_KEY + OPENAI_API_KEY');
    test.setTimeout(120_000);

    const seeded = await seedProject(request);
    try {
      // 先拿策略
      const prev = await request.post(`/api/pages/${seeded.pageId}/locales/preview`, {
        data: { locale: 'ja' },
      });
      const { strategy } = await prev.json();

      const res = await request.post(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'ja', strategy },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.page.availableLocales).toContain('ja');
      expect(Array.isArray(body.page.variants.A.ja)).toBe(true);
      expect(body.page.variants.A.ja.length).toBeGreaterThan(0);
      const heroA = body.page.variants.A.ja.find((m: any) => m.type === 'hero');
      const heroZh = body.page.variants.A['zh-CN'].find((m: any) => m.type === 'hero');
      expect(heroA.content.headline).toBeTruthy();
      expect(heroA.content.headline).not.toBe(heroZh.content.headline);

      // 落库
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.availableLocales).toContain('ja');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-007 · [无 KEY] 添加语言走 LLM_REQUIRED', async ({ request }) => {
    const caps = await getCapabilities(request);
    test.skip(caps.ready.addLocale, 'requires MISSING ANTHROPIC_API_KEY or OPENAI_API_KEY');

    const seeded = await seedProject(request);
    try {
      // 先拿策略(preview 无需 key)
      const prev = await request.post(`/api/pages/${seeded.pageId}/locales/preview`, {
        data: { locale: 'ja' },
      });
      const { strategy } = await prev.json();

      const res = await request.post(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'ja', strategy },
      });
      expect(res.status()).toBe(503);
      const body = await res.json();
      expect(body.code).toBe('LLM_REQUIRED');
      expect(body.missing).toMatch(/ANTHROPIC_API_KEY|OPENAI_API_KEY/);

      // 落库未污染
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.availableLocales).toEqual(['zh-CN']);
      expect(fresh.variants.A.ja).toBeUndefined();
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-008 · 重复添加已存在的 locale(幂等)', async ({ request }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      const res = await request.post(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'ja' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.note).toBe('locale already exists');
      expect(body.page.availableLocales.sort()).toEqual(['ja', 'zh-CN']);

      // 不触发 LLM — 验证方式:即便无 key 也能返回 200(上面的 expect 已覆盖)
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });
});

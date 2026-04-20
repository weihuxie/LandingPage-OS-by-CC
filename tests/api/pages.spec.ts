/**
 * API-PAGE-* · LandingPage 的读/写/删,不依赖 LLM。
 * 对应用例文档:docs/testcases/api-testcases.md API-PAGE 行。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedProject, getPage } from '../helpers/seed';

test.describe('API-PAGE · LandingPage CRUD', () => {
  test('API-PAGE-001 · 通过 compat 入口创建 Product+Page 种子', async ({ request }) => {
    // 这条用例本身就是验证 seed 路径。创建后直接断言返回结构。
    const res = await request.post('/api/projects', {
      data: {
        inputs: {
          name: `API-PAGE-001-${Date.now()}`,
          tagline: 'seed',
          category: 'SaaS',
          value: 'v',
          cta: 'demo',
          market: 'CN',
          locale: 'zh-CN',
          industry: 'SaaS',
          companySize: '10-50',
          role: 'PM',
          source: 'ads',
          pastedContent: '',
          referenceUrls: [],
          uploadedFileNames: [],
        },
        strategy: {
          audience: ['a'],
          goal: ['g'],
          narrative: ['n'],
          local: ['l'],
        },
        tone: 'saas',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toMatch(/^lp_/);
    expect(body.productId).toMatch(/^p_/);
    expect(body.slug).toBeTruthy();

    // 无 key 时,hydrateModulesViaClaude 会抛 → 带 warning;
    // 有 key 时 warning 不存在。两种情况都合法,断言"结构存在即可"。
    const page = await getPage(request, body.id);
    expect(page.id).toBe(body.id);
    if (body.warning) {
      // 无 key 分支:服务端应把 hydrationFailed 置 true
      expect(page.hydrationFailed).toBe(true);
    }

    await request.delete(`/api/products/${body.productId}`);
  });

  test('API-PAGE-002 · 读单个 LandingPage 及其 Product', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const res = await request.get(`/api/pages/${seeded.pageId}`);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.page.id).toBe(seeded.pageId);
      expect(body.page.defaultLocale).toBe('zh-CN');
      expect(body.page.availableLocales).toContain('zh-CN');
      expect(Array.isArray(body.page.variants.A['zh-CN'])).toBe(true);
      expect(body.page.variants.A['zh-CN'].length).toBeGreaterThan(0);
      expect(body.product.id).toBe(body.page.productId);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-PAGE-003 · 写单元格 modules(variant × locale 精确写入)', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const before = await getPage(request, seeded.pageId);
      const bBefore = before.variants.B['zh-CN']; // 基线:B 变体应不被触碰

      const res = await request.patch(`/api/pages/${seeded.pageId}/modules`, {
        data: {
          variant: 'A',
          locale: 'zh-CN',
          modules: [
            {
              id: 'm_edited',
              type: 'hero',
              content: { headline: 'EDITED HEADLINE' },
            },
          ],
        },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.page.variants.A['zh-CN'].length).toBe(1);
      expect(body.page.variants.A['zh-CN'][0].content.headline).toBe('EDITED HEADLINE');
      expect(body.page.variants.A['zh-CN'][0].id).toBe('m_edited');

      // 落库验证
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.variants.A['zh-CN'][0].content.headline).toBe('EDITED HEADLINE');

      // B 变体未被波及
      expect(fresh.variants.B['zh-CN']).toEqual(bBefore);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-PAGE-004 · 更新 tone / theme(合并语义)', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const before = await getPage(request, seeded.pageId);
      const styleBefore = before.theme.styleId;

      const res = await request.patch(`/api/pages/${seeded.pageId}`, {
        data: { tone: 'executive', theme: { primary: '#ff0000' } },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.page.tone).toBe('executive');
      expect(body.page.theme.primary).toBe('#ff0000');
      // theme 应为合并,styleId 不被替换清空
      expect(body.page.theme.styleId).toBe(styleBefore);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-PAGE-005 · 切换 published', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const r1 = await request.patch(`/api/pages/${seeded.pageId}`, {
        data: { published: true },
      });
      expect(r1.status()).toBe(200);
      expect((await r1.json()).page.published).toBe(true);

      const r2 = await request.patch(`/api/pages/${seeded.pageId}`, {
        data: { published: false },
      });
      expect(r2.status()).toBe(200);
      expect((await r2.json()).page.published).toBe(false);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-PAGE-006 · 切换 activeVariant(A↔B)', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const before = await getPage(request, seeded.pageId);
      const varAContent = JSON.stringify(before.variants.A);
      const varBContent = JSON.stringify(before.variants.B);

      const res = await request.patch(`/api/pages/${seeded.pageId}`, {
        data: { switchVariant: 'B' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.page.activeVariant).toBe('B');
      // variants.A / variants.B 内容不变
      expect(JSON.stringify(body.page.variants.A)).toBe(varAContent);
      expect(JSON.stringify(body.page.variants.B)).toBe(varBContent);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-PAGE-007 · 删除单个 LandingPage', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const del = await request.delete(`/api/pages/${seeded.pageId}`);
      expect(del.status()).toBe(200);
      expect(await del.json()).toEqual({ ok: true });

      const miss = await request.get(`/api/pages/${seeded.pageId}`);
      expect(miss.status()).toBe(404);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });
});

/**
 * API-PROJ-* · legacy v1 /api/projects 的 compat 层,不依赖 LLM。
 * 对应用例文档:docs/testcases/api-testcases.md API-PROJ 行。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedProject, getPage } from '../helpers/seed';

test.describe('API-PROJ · Projects compat', () => {
  test('API-PROJ-001 · 列出 compat 项目视图', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const res = await request.get('/api/projects');
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.projects)).toBe(true);
      expect(body.projects.length).toBeGreaterThanOrEqual(1);
      const mine = body.projects.find((p: any) => p.id === seeded.pageId);
      expect(mine).toBeTruthy();
      // compat 视图字段
      expect(Array.isArray(mine.modules)).toBe(true);
      expect(mine.strategy).toBeTruthy();
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-PROJ-002 · 读 compat 项目视图', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const res = await request.get(`/api/projects/${seeded.pageId}`);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.project.id).toBe(seeded.pageId);
      // compat modules 指向 activeVariant × defaultLocale 槽位
      const page = await getPage(request, seeded.pageId);
      const v = page.activeVariant ?? 'A';
      expect(body.project.modules.length).toBe(page.variants[v][page.defaultLocale].length);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-PROJ-003 · PATCH modules (compat 路径同时返回 project + page)', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const res = await request.patch(`/api/projects/${seeded.pageId}`, {
        data: {
          modules: [
            { id: 'm1', type: 'hero', content: { headline: 'Compat Path' } },
          ],
          locale: 'zh-CN',
        },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      // 契约:compat PATCH 必须同时带 project 和 page
      expect(body.project).toBeTruthy();
      expect(body.page).toBeTruthy();
      expect(body.page.variants.A['zh-CN'][0].content.headline).toBe('Compat Path');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-PROJ-004 · 更换 styleId(设置弹窗走的 compat 接口)', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const before = await getPage(request, seeded.pageId);
      // 选一个不同于当前的 styleId,用文档里常见的两个作候选
      const candidates = ['saas-refined', 'jp-premium', 'enterprise-b2b', 'friendly-pop'];
      const target = candidates.find((id) => id !== before.theme.styleId) ?? 'jp-premium';

      const res = await request.patch(`/api/projects/${seeded.pageId}`, {
        data: { newStyleId: target },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.page.theme.styleId).toBe(target);

      // 落库
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.theme.styleId).toBe(target);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });
});

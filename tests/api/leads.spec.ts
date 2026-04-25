/**
 * API-LEAD-* · 线索提交 + 读取 + 非法参数。
 * 对应用例文档:docs/testcases/api-testcases.md API-LEAD 行。
 */
import { test, expect } from '@playwright/test';
import { loginAndEnsureTenant } from '../helpers/user-auth';
import { cleanupProject, seedProject, getPage } from '../helpers/seed';

test.describe('API-LEAD · Leads', () => {

  test.beforeEach(async ({ request }) => {
    await loginAndEnsureTenant(request);
  });
  test('API-LEAD-001 · 公网提交一条线索 + 更新 page.stats', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const before = await getPage(request, seeded.pageId);
      const n0 = before.stats.leads ?? 0;
      const m0 = before.stats.byLocale?.['zh-CN']?.leads ?? 0;
      const ab0 = before.stats.abStats?.A?.leads ?? 0;

      const email = `lead-${Date.now()}@test.com`;
      const res = await request.post('/api/leads', {
        data: {
          slug: seeded.slug,
          name: '张三',
          email,
          locale: 'zh-CN',
          variant: 'A',
        },
      });
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      const after = await getPage(request, seeded.pageId);
      expect(after.stats.leads).toBe(n0 + 1);
      expect(after.stats.byLocale['zh-CN'].leads).toBe(m0 + 1);
      expect(after.stats.abStats.A.leads).toBe(ab0 + 1);

      // 列表里能拿到
      const listRes = await request.get(`/api/leads?projectId=${seeded.pageId}`);
      expect(listRes.status()).toBe(200);
      const { leads } = await listRes.json();
      expect(leads.some((l: any) => l.email === email)).toBe(true);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LEAD-002 · 按 pageId 过滤读取线索', async ({ request }) => {
    const p1 = await seedProject(request);
    const p2 = await seedProject(request);
    try {
      // 各提一条线索
      await request.post('/api/leads', {
        data: { slug: p1.slug, email: 'p1@t.com', locale: 'zh-CN' },
      });
      await request.post('/api/leads', {
        data: { slug: p2.slug, email: 'p2@t.com', locale: 'zh-CN' },
      });

      const res = await request.get(`/api/leads?projectId=${p1.pageId}`);
      expect(res.status()).toBe(200);
      const { leads } = await res.json();
      // 所有返回的 lead 都应属于 p1
      expect(leads.length).toBeGreaterThan(0);
      for (const l of leads) {
        expect(l.projectId).toBe(p1.pageId);
      }
      // 不应含 p2 的
      expect(leads.some((l: any) => l.email === 'p2@t.com')).toBe(false);
    } finally {
      await cleanupProject(request, p1.productId);
      await cleanupProject(request, p2.productId);
    }
  });

  test('API-LEAD-003 · 非法 slug 或缺 slug', async ({ request }) => {
    // A · slug 不存在 → 404
    const resA = await request.post('/api/leads', {
      data: { slug: 'does-not-exist-xyz', name: 'x' },
    });
    expect(resA.status()).toBe(404);
    expect((await resA.json()).error).toBe('page not found');

    // B · 缺 slug → 400
    const resB = await request.post('/api/leads', {
      data: { name: 'x' },
    });
    expect(resB.status()).toBe(400);
    expect((await resB.json()).error).toBe('slug required');
  });
});

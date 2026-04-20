/**
 * API-PROD-* · Product 的读/写/删,不依赖 LLM。
 * 对应用例文档:docs/testcases/api-testcases.md `## 1. 用例清单` API-PROD 行。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedProject, getProduct } from '../helpers/seed';

test.describe('API-PROD · Product CRUD', () => {
  test('API-PROD-001 · 创建产品(最小必填)', async ({ request }) => {
    const name = `API-PROD-001-${Date.now()}`;
    const res = await request.post('/api/products', {
      data: { name, tagline: 'hello', category: 'SaaS', value: 'value-x' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.product).toBeTruthy();
    expect(body.product.id).toMatch(/^p_/);
    expect(body.product.name).toBe(name);
    expect(body.product.theme.primary).toBe('#4861ff');
    expect(body.product.assets).toEqual({ testimonials: [], cases: [], media: [] });
    expect(body.product.landingPageIds).toEqual([]);

    // 边界:name 缺失 → 400
    const bad = await request.post('/api/products', { data: { tagline: 'x' } });
    expect(bad.status()).toBe(400);
    const badBody = await bad.json();
    expect(badBody.error).toBe('name required');

    // 清理
    await request.delete(`/api/products/${body.product.id}`);
  });

  test('API-PROD-002 · 列出产品', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const res = await request.get('/api/products');
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.products)).toBe(true);
      expect(body.products.length).toBeGreaterThanOrEqual(1);
      expect(body.products.find((p: any) => p.id === seeded.productId)).toBeTruthy();
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-PROD-003 · 读产品及其页面列表', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const res = await request.get(`/api/products/${seeded.productId}`);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.product.id).toBe(seeded.productId);
      expect(Array.isArray(body.pages)).toBe(true);
      expect(body.pages.find((p: any) => p.id === seeded.pageId)).toBeTruthy();
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-PROD-004 · 修改产品信息', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const res = await request.patch(`/api/products/${seeded.productId}`, {
        data: { name: 'NewName', tagline: 'NewTag', value: 'NewValue' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.product.name).toBe('NewName');
      expect(body.product.tagline).toBe('NewTag');
      expect(body.product.value).toBe('NewValue');

      // 再拉一次验证真落库
      const fresh = await getProduct(request, seeded.productId);
      expect(fresh.name).toBe('NewName');
      expect(fresh.tagline).toBe('NewTag');
      expect(fresh.value).toBe('NewValue');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-PROD-005 · 删除产品级联删除页面', async ({ request }) => {
    const seeded = await seedProject(request);

    const del = await request.delete(`/api/products/${seeded.productId}`);
    expect(del.status()).toBe(200);
    expect(await del.json()).toEqual({ ok: true });

    const missProd = await request.get(`/api/products/${seeded.productId}`);
    expect(missProd.status()).toBe(404);

    const missPage = await request.get(`/api/pages/${seeded.pageId}`);
    expect(missPage.status()).toBe(404);
  });
});

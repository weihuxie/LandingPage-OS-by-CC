/**
 * API-DYNAMIC-404 / 405 · Runtime confirmation that storage writes
 * are visible to SUBSEQUENT reads — i.e. Data Cache isn't pinning
 * fetch() responses inside route handlers / RSC paths.
 *
 * Companion to the static audit in dynamic-export-audit.spec.ts:
 *   - The static audit catches missing `force-dynamic` / `revalidate=0`
 *     declarations at the source-code level.
 *   - These integration tests catch the SAME bug class at runtime —
 *     covering the case where the declarations exist but a downstream
 *     fetch (e.g. KV via @vercel/kv) is still being cached due to a
 *     framework regression or a missed declaration.
 *
 * The bug we're guarding against (CLAUDE.md §1.4.1, real prod incident
 * 2026-04): user creates a product → SSR `/zh-CN/dashboard` SSR returns
 * the build-time snapshot for ~5 min until cache TTL expires. The fix
 * was `noStore() + revalidate=0` on every storage-reading SSR page;
 * these tests verify that fix still holds.
 *
 * Both tests use the standard single-tenant request fixture (the cache
 * concern is per-route, not cross-tenant).
 */
import { test, expect } from '@playwright/test';
import { loginAndEnsureTenant } from '../helpers/user-auth';
import { seedProject, cleanupProject } from '../helpers/seed';

test.describe('API-DYNAMIC · runtime cache invalidation', () => {

  test.beforeEach(async ({ request }) => {
    await loginAndEnsureTenant(request);
  });

  test('API-DYNAMIC-404 / API-EVENTS-408 · POST /api/events view → /api/analytics +1 immediately', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      // Snapshot baseline counts.
      const beforeRes = await request.get('/api/analytics');
      expect(beforeRes.status()).toBe(200);
      const before = await beforeRes.json();
      const myProdBefore = before.perProduct.find((p: { id: string }) => p.id === seeded.productId);
      const myPageBefore = myProdBefore?.pages?.find((pg: { id: string }) => pg.id === seeded.pageId);
      const baselineViews = myPageBefore?.views ?? 0;
      const baselineKpiViews = before.kpi.totalViews ?? 0;

      // Submit a view event. This route has dynamic='force-dynamic' but
      // (currently) no `revalidate=0` — confirm at runtime that the next
      // analytics read STILL sees the increment regardless of Data Cache
      // behavior on the read side.
      const evRes = await request.post('/api/events', {
        data: {
          slug: seeded.slug,
          type: 'view',
          variant: 'A',
          locale: 'zh-CN',
        },
      });
      expect(evRes.status()).toBe(200);

      // Read analytics. If `revalidate=0` were missing on /api/analytics,
      // the inner KV fetch would still return the pre-event snapshot.
      const afterRes = await request.get('/api/analytics');
      expect(afterRes.status()).toBe(200);
      const after = await afterRes.json();
      const myProdAfter = after.perProduct.find((p: { id: string }) => p.id === seeded.productId);
      const myPageAfter = myProdAfter?.pages?.find((pg: { id: string }) => pg.id === seeded.pageId);

      expect(myPageAfter, 'product+page should still be in analytics after event').toBeDefined();
      expect(
        myPageAfter.views,
        `Page views did not increment. Expected ${baselineViews + 1}, got ${myPageAfter.views}. ` +
          'Likely cause: /api/analytics or /api/events lost its revalidate=0 declaration ' +
          'and Data Cache is pinning KV reads. See CLAUDE.md §1.4.1.',
      ).toBe(baselineViews + 1);
      expect(after.kpi.totalViews).toBe(baselineKpiViews + 1);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-DYNAMIC-405 · create product → SSR /zh-CN/dashboard renders it', async ({ request }) => {
    // Snapshot how many products SSR currently shows for this user.
    const baselineHtml = await (await request.get('/zh-CN/dashboard')).text();
    expect(baselineHtml.length).toBeGreaterThan(100); // sanity: actually rendered

    // Create a fresh product with a distinctive name we can grep for in
    // the rendered HTML. Including a timestamp guarantees uniqueness even
    // across parallel runs that share a tenant cookie jar.
    const distinctName = `DASHBOARD-CACHE-TEST-${Date.now()}`;
    const seeded = await seedProject(request, { name: distinctName });
    try {
      // SSR dashboard. If `noStore()` + `revalidate=0` were missing on
      // src/app/[locale]/dashboard/page.tsx, the inner readProducts()
      // call would return the pre-create KV snapshot for ~5 min.
      const afterRes = await request.get('/zh-CN/dashboard');
      expect(afterRes.status()).toBe(200);
      const html = await afterRes.text();

      expect(
        html.includes(distinctName),
        `SSR /zh-CN/dashboard does NOT contain "${distinctName}" immediately after creation. ` +
          'Likely cause: dashboard page lost `noStore()` or `revalidate=0` (see CLAUDE.md §1.4.1). ' +
          'Static audit (API-DYNAMIC-403) catches the source-code regression; this test catches ' +
          'the same bug class for any storage-reading code path that slips past the static check.',
      ).toBe(true);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });
});

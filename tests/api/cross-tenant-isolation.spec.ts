/**
 * API-TENANT-404-* · Cross-tenant resource isolation.
 *
 * CLAUDE.md §四.5 S2 contract: every tenant-gated route returns **404**
 * (not 403) when a logged-in user from tenant B touches a resource
 * owned by tenant A. 404 doesn't leak existence; 403 does. Routes that
 * already implement this are kept honest by these tests so a future
 * refactor can't silently downgrade to 403.
 *
 * The two reverse cases (-419, -420) assert the OPPOSITE for genuinely
 * public surface — `/p/[slug]` and `POST /api/leads` — to prevent
 * "added auth gate everywhere" from accidentally locking down public
 * lead-collection or the public landing page render.
 *
 * Test plan (audit-2026-05.md §5.2):
 *   401 GET    /api/products/[id]                       → 404
 *   402 PATCH  /api/products/[id]                       → 404
 *   403 DELETE /api/products/[id]                       → 404
 *   404 GET    /api/pages/[id]                          → 404
 *   405 PATCH  /api/pages/[id]                          → 404
 *   406 PATCH  /api/pages/[id]/modules                  → 404
 *   407 DELETE /api/pages/[id]                          → 404
 *   408 POST   /api/pages/[id]/locales                  → 404
 *   409 POST   /api/pages/[id]/hydrate                  → 404
 *   410 POST   /api/pages/[id]/evaluate                 → 404
 *   411 GET    /api/projects/[id]                       → 404
 *   412 PATCH  /api/projects/[id]                       → 404
 *   413 POST   /api/fields/suggest                      → 404
 *   414 GET    /api/leads?projectId=                    → empty array
 *   415 GET    /api/leads/export?pageId=                → empty CSV (header only)
 *   416 PATCH  /api/tenants/[id]/invites/[token]        → 404
 *   417 SSR    /zh-CN/products/[id]                     → 404
 *   418 SSR    /zh-CN/projects/[id]                     → 404
 *   419 PUBLIC /p/[slug]                                → 200 (反向断言)
 *   420 PUBLIC POST /api/leads                          → 200 (反向断言)
 */
import { test, expect } from '@playwright/test';
import { createTwoTenants } from '../helpers/cross-tenant';
import { seedProject, cleanupProject } from '../helpers/seed';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

test.describe('API-TENANT-404 · cross-tenant returns 404 (no leak)', () => {

  test('API-TENANT-404-401 · GET /api/products/[id] → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const res = await t.ctxB.get(`/api/products/${seeded.productId}`);
      expect(res.status()).toBe(404);
      expect((await res.json()).error).toBe('not found');
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-402 · PATCH /api/products/[id] → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const res = await t.ctxB.patch(`/api/products/${seeded.productId}`, {
        data: { name: 'evil-rename' },
      });
      expect(res.status()).toBe(404);
      // Confirm the resource was NOT modified — read back from owner.
      const check = await t.ctxA.get(`/api/products/${seeded.productId}`);
      expect((await check.json()).product.name).not.toBe('evil-rename');
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-403 · DELETE /api/products/[id] → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const res = await t.ctxB.delete(`/api/products/${seeded.productId}`);
      expect(res.status()).toBe(404);
      // Confirm not deleted — owner can still read.
      const check = await t.ctxA.get(`/api/products/${seeded.productId}`);
      expect(check.status()).toBe(200);
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-404 · GET /api/pages/[id] → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const res = await t.ctxB.get(`/api/pages/${seeded.pageId}`);
      expect(res.status()).toBe(404);
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-405 · PATCH /api/pages/[id] → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const res = await t.ctxB.patch(`/api/pages/${seeded.pageId}`, {
        data: { name: 'evil-rename', published: true },
      });
      expect(res.status()).toBe(404);
      const check = await t.ctxA.get(`/api/pages/${seeded.pageId}`);
      const { page } = await check.json();
      expect(page.name).not.toBe('evil-rename');
      expect(page.published).not.toBe(true);
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-406 · PATCH /api/pages/[id]/modules → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const res = await t.ctxB.patch(`/api/pages/${seeded.pageId}/modules`, {
        data: {
          variant: 'A',
          locale: 'zh-CN',
          modules: [{ id: 'evil', type: 'hero', content: { headline: 'PWNED' } }],
        },
      });
      expect(res.status()).toBe(404);
      // Confirm modules unchanged — re-read and check no module has id='evil'.
      const check = await t.ctxA.get(`/api/pages/${seeded.pageId}`);
      const { page } = await check.json();
      const mods = page.variants.A['zh-CN'] as Array<{ id: string }>;
      expect(mods.some((m) => m.id === 'evil')).toBe(false);
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-407 · DELETE /api/pages/[id] → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const res = await t.ctxB.delete(`/api/pages/${seeded.pageId}`);
      expect(res.status()).toBe(404);
      const check = await t.ctxA.get(`/api/pages/${seeded.pageId}`);
      expect(check.status()).toBe(200);
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-408 · POST /api/pages/[id]/locales → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const res = await t.ctxB.post(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'ja' },
      });
      expect(res.status()).toBe(404);
      // Confirm ja was NOT added.
      const check = await t.ctxA.get(`/api/pages/${seeded.pageId}`);
      const { page } = await check.json();
      expect(page.availableLocales).not.toContain('ja');
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-409 · POST /api/pages/[id]/hydrate → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const res = await t.ctxB.post(`/api/pages/${seeded.pageId}/hydrate`, {
        data: { locale: 'zh-CN' },
      });
      expect(res.status()).toBe(404);
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-410 · POST /api/pages/[id]/evaluate → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const res = await t.ctxB.post(`/api/pages/${seeded.pageId}/evaluate`);
      expect(res.status()).toBe(404);
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-411 · GET /api/projects/[id] (compat) → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const res = await t.ctxB.get(`/api/projects/${seeded.pageId}`);
      expect(res.status()).toBe(404);
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-412 · PATCH /api/projects/[id] (compat) → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const res = await t.ctxB.patch(`/api/projects/${seeded.pageId}`, {
        data: { tone: 'executive' },
      });
      expect(res.status()).toBe(404);
      const check = await t.ctxA.get(`/api/pages/${seeded.pageId}`);
      const { page } = await check.json();
      expect(page.tone).not.toBe('executive');
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-413 · POST /api/fields/suggest cross-tenant pageId → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const res = await t.ctxB.post('/api/fields/suggest', {
        data: {
          pageId: seeded.pageId,
          locale: 'zh-CN',
          fieldPath: 'hero.headline',
          currentValue: 'whatever',
        },
      });
      expect(res.status()).toBe(404);
      expect((await res.json()).error).toBe('page not found');
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-414 · GET /api/leads?projectId=A → empty (no leak)', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      // Submit a lead via PUBLIC POST so it's actually in storage.
      await t.ctxA.post('/api/leads', {
        data: { slug: seeded.slug, name: '张三', email: 'a@t.com', locale: 'zh-CN' },
      });

      // tenantB asks for tenantA's project's leads → readLeads filters by
      // tenantB.id, so the projectId match yields nothing. Returns empty
      // array (not 404, not 403) — we don't want to leak existence.
      const res = await t.ctxB.get(`/api/leads?projectId=${seeded.pageId}`);
      expect(res.status()).toBe(200);
      const { leads } = await res.json();
      expect(Array.isArray(leads)).toBe(true);
      expect(leads.length).toBe(0);
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-415 · GET /api/leads/export?pageId=A → empty CSV', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      await t.ctxA.post('/api/leads', {
        data: { slug: seeded.slug, name: '张三', email: 'a@t.com', locale: 'zh-CN' },
      });

      const res = await t.ctxB.get(`/api/leads/export?pageId=${seeded.pageId}`);
      expect(res.status()).toBe(200);
      const csv = await res.text();
      // Body = BOM + header line + zero data rows.
      const lines = csv.replace(/^﻿/, '').split('\n').filter(Boolean);
      expect(lines.length).toBe(1); // header only
      expect(lines[0]).toContain('时间'); // header sanity check
      // Critically: does NOT contain any of tenantA's PII.
      expect(csv).not.toContain('张三');
      expect(csv).not.toContain('a@t.com');
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-416 · PATCH /api/tenants/[id]/invites/[token] cross-tenant → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      // Mint an invite under tenantA (owner is sessionA's user).
      const mintRes = await t.ctxA.post(
        `/api/tenants/${t.sessionA.tenantId}/invites`,
        { data: { role: 'editor' } },
      );
      expect(mintRes.status()).toBe(200);
      const { invite } = await mintRes.json();
      const token = invite.token as string;

      // tenantB user tries to disable tenantA's invite via the WRONG
      // tenant id in the path. Source check:
      //   if (!invite || invite.tenantId !== params.id) → 404
      // Path tampering also resolves to 404.
      const res = await t.ctxB.patch(
        `/api/tenants/${t.sessionB.tenantId}/invites/${token}`,
        { data: { disabled: true } },
      );
      expect(res.status()).toBe(404);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-417 · SSR /zh-CN/products/[id] cross-tenant → 404 + no leak', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const distinctName = `XTEN-PROD-LEAK-${Date.now()}`;
      const seeded = await seedProject(t.ctxA, { name: distinctName });
      const res = await t.ctxB.get(`/zh-CN/products/${seeded.productId}`, {
        maxRedirects: 0,
      });
      const body = await res.text();

      // products/[id]/page.tsx must do `getProduct` sequentially before
      // any other await, so notFound() fires before streaming starts —
      // otherwise Next.js commits the 200 status header before the
      // tenant check runs (real bug found by this test, fixed alongside
      // it: the page used Promise.all and shipped 200 + not-found UI).
      // Strict 404 here is the regression sentinel: if a future change
      // re-introduces parallel fetches, this test breaks loudly.
      expect(res.status()).toBe(404);

      // SECURITY contract — body must not leak the product name even
      // though we already asserted the status.
      expect(
        body.includes(distinctName),
        `Cross-tenant SSR leaked the product name "${distinctName}" in body — security regression.`,
      ).toBe(false);
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-418 · SSR /zh-CN/projects/[id] cross-tenant → 404', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const res = await t.ctxB.get(`/zh-CN/projects/${seeded.pageId}`, {
        maxRedirects: 0,
      });
      expect(res.status()).toBe(404);
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });
});

test.describe('API-TENANT-404 · public surface stays public (reverse assertions)', () => {

  test('API-TENANT-404-419 · /p/[slug] is public — no tenant gate', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      // Publish so the public page is renderable. ctxA owns the page
      // and can flip published.
      await t.ctxA.patch(`/api/pages/${seeded.pageId}`, {
        data: { published: true },
      });

      // Fully unauthenticated request — disposable context with no cookies.
      const anon = await playwright.request.newContext({ baseURL: BASE_URL });
      try {
        const res = await anon.get(`/p/${seeded.slug}`, { maxRedirects: 5 });
        // Public page must serve. If a future change accidentally adds
        // a tenant gate here, leads collection breaks for all visitors.
        expect(res.status()).toBe(200);
      } finally {
        await anon.dispose();
      }
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });

  test('API-TENANT-404-420 · POST /api/leads is public — anon submits 200', async ({ playwright }) => {
    const t = await createTwoTenants(playwright, BASE_URL);
    try {
      const seeded = await seedProject(t.ctxA);
      const anon = await playwright.request.newContext({ baseURL: BASE_URL });
      try {
        const res = await anon.post('/api/leads', {
          data: {
            slug: seeded.slug,
            name: 'visitor',
            email: 'v@anon.test',
            locale: 'zh-CN',
          },
        });
        expect(res.status()).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
      } finally {
        await anon.dispose();
      }
      // Confirm tenantA can see the lead they collected.
      const list = await t.ctxA.get(`/api/leads?projectId=${seeded.pageId}`);
      const { leads } = await list.json();
      expect(leads.some((l: { email: string }) => l.email === 'v@anon.test')).toBe(true);
      await cleanupProject(t.ctxA, seeded.productId);
    } finally {
      await t.dispose();
    }
  });
});

/**
 * Two-tenant fixture for cross-tenant isolation tests.
 *
 * Each call returns two independent APIRequestContexts with their own
 * cookie jars + their own users + their own tenants. Resources created
 * with ctxA must return 404 (not 403) when accessed via ctxB — the
 * multi-tenant security contract from CLAUDE.md §四.5 S2: "跨 tenant
 * 资源访问统一 404（不 leak 资源是否存在）".
 *
 * Why a separate helper instead of using the test's built-in `request`:
 * the test fixture's request shares one cookie jar across the test, so
 * a second `loginAndEnsureTenant` would either no-op (idempotency check)
 * or replace the first user — neither gives us two simultaneous tenants.
 * `request.newContext()` creates fresh cookie jars.
 *
 * Usage:
 *   test('cross-tenant', async ({ playwright }) => {
 *     const t = await createTwoTenants(playwright, BASE_URL);
 *     try {
 *       const seeded = await seedProject(t.ctxA);
 *       const res = await t.ctxB.get(`/api/products/${seeded.productId}`);
 *       expect(res.status()).toBe(404);
 *     } finally {
 *       await t.dispose();
 *     }
 *   });
 */
import type { APIRequestContext } from '@playwright/test';
import { loginAndEnsureTenant, type AuthedSession } from './user-auth';

export interface TwoTenants {
  ctxA: APIRequestContext;
  ctxB: APIRequestContext;
  sessionA: AuthedSession;
  sessionB: AuthedSession;
  /** Free both contexts. Always call in finally{}. */
  dispose: () => Promise<void>;
}

/**
 * Spin up two independent (user + tenant + cookie jar) contexts.
 * `playwright` comes from the test fixture; `baseURL` should match
 * the project's playwright.config (typically http://localhost:3000).
 */
export async function createTwoTenants(
  playwright: { request: { newContext: (opts: { baseURL: string }) => Promise<APIRequestContext> } },
  baseURL: string,
): Promise<TwoTenants> {
  const ctxA = await playwright.request.newContext({ baseURL });
  const ctxB = await playwright.request.newContext({ baseURL });
  const sessionA = await loginAndEnsureTenant(ctxA);
  const sessionB = await loginAndEnsureTenant(ctxB);
  // Defensive: confirm we actually got two distinct tenants. If they
  // collided (shouldn't happen — uniqueTestEmail uses Date.now+counter)
  // the rest of the spec would silently pass on same-tenant access.
  if (sessionA.tenantId === sessionB.tenantId) {
    await Promise.all([ctxA.dispose(), ctxB.dispose()]);
    throw new Error(
      `createTwoTenants: both contexts landed on the same tenant ${sessionA.tenantId}. ` +
        'This means user-auth helper reused an existing session — should be impossible with fresh request contexts.',
    );
  }
  return {
    ctxA,
    ctxB,
    sessionA,
    sessionB,
    dispose: async () => {
      await Promise.all([ctxA.dispose(), ctxB.dispose()]);
    },
  };
}

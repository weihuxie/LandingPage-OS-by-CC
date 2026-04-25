/**
 * Test helper · log a synthetic user in via the dev magic-link flow.
 *
 * After S2 lands, every business API requires `lp_user` cookie. The
 * existing seedProject helper fires `request.post('/api/projects')`
 * directly — no cookie → 401. This helper performs the magic-link
 * round-trip up front, so subsequent API + page calls share the
 * resulting authenticated request context.
 *
 * Flow:
 *   1. POST /api/auth/magic-link { email } → returns { devLink } in dev
 *   2. GET devLink → 303 redirect, sets lp_user cookie via Set-Cookie
 *   3. POST /api/tenants { name } → creates a workspace, sets nothing
 *      additional but ensures requireUserAndTenant won't 409
 *   4. (caller-supplied request context now has the cookie attached)
 *
 * The magic-link route only returns devLink in non-prod (VERCEL!=1), so
 * this helper is local-dev / CI only. Prod e2e would need a different
 * strategy (e.g. seeded session token via a test-only endpoint).
 */
import type { APIRequestContext } from '@playwright/test';

export interface AuthedSession {
  email: string;
  tenantId: string;
  tenantName: string;
}

let counter = 0;

/** Generate a unique test email so parallel runs don't collide. */
function uniqueTestEmail(): string {
  counter += 1;
  return `e2e-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 7)}@test.local`;
}

/**
 * Log in + create-or-reuse a tenant. Returns identifiers so callers can
 * assert tenant scope. Idempotent within a single test: if the request
 * context already has a session, skip the magic-link step.
 */
export async function loginAndEnsureTenant(
  request: APIRequestContext,
  opts: { email?: string; tenantName?: string } = {},
): Promise<AuthedSession> {
  // Idempotency check: if the request context is already authenticated
  // and has at least one tenant, reuse it. Without this, callers that
  // run seedProject multiple times in one test (e.g. comparing two
  // products on the dashboard) would log in as N different users in
  // the same cookie jar — last login wins and earlier products end
  // up in tenants the test no longer "is".
  const existingSession = await request.get('/api/auth/session');
  if (existingSession.ok()) {
    const data = (await existingSession.json()) as {
      user?: { email: string };
      tenants?: Array<{ id: string; name: string }>;
    };
    if (data.user && data.tenants && data.tenants.length > 0) {
      return {
        email: data.user.email,
        tenantId: data.tenants[0].id,
        tenantName: data.tenants[0].name,
      };
    }
  }

  const email = opts.email ?? uniqueTestEmail();
  const tenantName = opts.tenantName ?? `e2e-tenant-${Date.now()}`;

  // 1. Magic link
  const mlRes = await request.post('/api/auth/magic-link', {
    data: { email, returnTo: '/app' },
  });
  if (!mlRes.ok()) {
    throw new Error(
      `loginAndEnsureTenant: magic-link failed ${mlRes.status()} ${await mlRes.text()}`,
    );
  }
  const { devLink } = (await mlRes.json()) as { devLink?: string };
  if (!devLink) {
    throw new Error(
      'loginAndEnsureTenant: no devLink returned. ' +
        'Either VERCEL=1 in env (helper is dev-only) or magic-link route changed.',
    );
  }

  // 2. Consume devLink — verify route 303s and Set-Cookie's lp_user.
  // We don't follow the redirect (the destination /app would 200 OK
  // even if we did, but skipping the body fetch keeps the helper fast).
  const verifyRes = await request.get(devLink, { maxRedirects: 0 });
  if (verifyRes.status() !== 303 && verifyRes.status() !== 302) {
    throw new Error(
      `loginAndEnsureTenant: verify expected 303, got ${verifyRes.status()}`,
    );
  }

  // 3. Create tenant. If the user already had one (returning tester
  // email), just reuse the first tenant via GET /api/tenants.
  const listRes = await request.get('/api/tenants');
  if (listRes.ok()) {
    const { tenants } = (await listRes.json()) as { tenants: any[] };
    if (tenants.length > 0) {
      return { email, tenantId: tenants[0].id, tenantName: tenants[0].name };
    }
  }
  const createRes = await request.post('/api/tenants', { data: { name: tenantName } });
  if (!createRes.ok()) {
    throw new Error(
      `loginAndEnsureTenant: tenant create failed ${createRes.status()} ${await createRes.text()}`,
    );
  }
  const body = (await createRes.json()) as { tenant: { id: string; name: string } };
  return { email, tenantId: body.tenant.id, tenantName: body.tenant.name };
}

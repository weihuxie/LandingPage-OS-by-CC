/**
 * Admin auth helpers for tests.
 *
 * The admin surface (/admin/* 和 /api/admin/*) is guarded by middleware
 * that verifies an HMAC-signed cookie set via POST /api/admin/login. Tests
 * that want to hit it either:
 *   (a) Use `loginAdminViaContext(context)` — the cookie lands in the
 *       BrowserContext and is shared with `page` + `context.request`. Best
 *       for E2E where we want one auth session across UI + API assertions.
 *   (b) Use `loginAdminViaRequest(request)` — returns a raw Set-Cookie
 *       string that must be forwarded manually via `{ headers: { cookie } }`.
 *       Used by pure API tests.
 *
 * ADMIN_PASSWORD is pulled from `process.env`. If unset, the caller should
 * `test.skip(...)` — same pattern as the ANTHROPIC_API_KEY-gated e2e
 * cases (see tests/helpers/capabilities.ts).
 */
import type { APIRequestContext, BrowserContext } from '@playwright/test';

export function getAdminPassword(): string | null {
  const raw = process.env.ADMIN_PASSWORD;
  return raw && raw.trim().length > 0 ? raw.trim() : null;
}

/**
 * Log in via a detached API request context. Returns the raw Set-Cookie
 * header value so callers can splice it into subsequent `{ headers }`.
 *
 * Throws on failure — admin auth is binary, there's no "partial login".
 */
export async function loginAdminViaRequest(
  request: APIRequestContext,
): Promise<string> {
  const password = getAdminPassword();
  if (!password) {
    throw new Error('ADMIN_PASSWORD env var not set — skip the test instead');
  }
  const res = await request.post('/api/admin/login', {
    data: { password },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`admin login failed: ${res.status()} ${body}`);
  }
  const setCookie = res.headers()['set-cookie'];
  if (!setCookie) throw new Error('admin login returned no Set-Cookie');
  // Playwright may join multiple cookies with `\n`; we only care about the
  // lp_admin one, and the Cookie request header wants `name=value` without
  // attributes. Strip everything past the first `;`.
  const first = setCookie.split('\n').find((c) => c.startsWith('lp_admin='));
  if (!first) throw new Error(`no lp_admin in Set-Cookie: ${setCookie}`);
  return first.split(';')[0];
}

/**
 * Log in such that the cookie lands in the supplied BrowserContext.
 * After this call, `page.goto('/admin/llm')` authenticates, AND
 * `context.request.get('/api/admin/...')` also carries the cookie.
 */
export async function loginAdminViaContext(
  context: BrowserContext,
): Promise<void> {
  const password = getAdminPassword();
  if (!password) {
    throw new Error('ADMIN_PASSWORD env var not set — skip the test instead');
  }
  const res = await context.request.post('/api/admin/login', {
    data: { password },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`admin login failed: ${res.status()} ${body}`);
  }
}

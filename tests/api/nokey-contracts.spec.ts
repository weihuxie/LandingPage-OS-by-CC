/**
 * E2E-NOKEY-* · API-level no-key contract tests.
 *
 * Covers from audit-2026-05.md §5.5 — the *API contracts* that drive
 * the no-key UX (the corresponding visual UI pieces are tested in
 * tests/e2e/nokey-ux.spec.ts).
 *
 *   402b  POST /api/strategy with no LLM key → 503 LLM_REQUIRED
 *         (this is what makes the dashboard / wizard "create" button
 *         end up disabled — the capability check looks for hasAnyLLM)
 *   403   POST /api/projects/[id]/deploy with no VC_API_TOKEN → 503
 *         DEPLOY_REQUIRED (publish button's underlying contract)
 *   405   POST /api/auth/magic-link with no RESEND_API_KEY in dev →
 *         returns `devLink` field in body (fail-loud in prod, dev-pass-
 *         through in local; this is what every E2E test relies on for
 *         the magic-link flow without sending real emails)
 *
 * Some parts of §5.5 are already covered by other specs:
 *   401  dashboard banner — partially via E2E-NOKEY-401-UI in the e2e
 *        spec; the banner content is driven by /api/capabilities
 *   402  editor add-locale button — covered by E2E-LOC-004 (existing)
 *   404  no BLOB token + VERCEL=1 → 503 — env-locked to prod, not
 *        testable without a parallel dev server with VERCEL=1
 *   406  fallback chain auto-promotion on Anthropic credit-empty —
 *        partially covered by API-FALLBACK-402 (synthetic 429-quota
 *        scenario); full integration would need real Anthropic credit-
 *        empty error injection, deferred
 */
import { test, expect } from '@playwright/test';
import { loginAndEnsureTenant } from '../helpers/user-auth';
import { getCapabilities } from '../helpers/capabilities';

test.describe('NOKEY · API contracts', () => {

  test('E2E-NOKEY-402b · POST /api/strategy with no LLM key → 503 LLM_REQUIRED', async ({ request }) => {
    const caps = await getCapabilities(request);
    test.skip(
      caps.ready.createProject,
      'requires NO LLM key configured (any of ANTHROPIC/DEEPSEEK present makes ready.createProject true)',
    );
    await loginAndEnsureTenant(request);
    // Default mode='claude' (the AI strategy path). With no LLM keys
    // the route should fail loud rather than fall back to template
    // (which is the explicit `mode='template'` opt-in).
    const res = await request.post('/api/strategy', {
      data: {
        inputs: {
          name: 'X', tagline: 't', category: 'SaaS', value: 'v',
          cta: 'demo', market: 'CN', locale: 'zh-CN',
          industry: 'SaaS', companySize: '10-50', role: 'PM', source: 'ads',
          pastedContent: '', referenceUrls: [], uploadedFileNames: [],
        },
      },
    });
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('LLM_REQUIRED');
    // The route should also tell the operator WHICH key is missing —
    // either a specific provider's env var, or 'any-llm' if it can't
    // narrow down. Either is acceptable; the contract is "named, not
    // generic 'something failed'".
    expect(body.missing).toBeTruthy();
  });

  test('E2E-NOKEY-405 · POST /api/auth/magic-link in dev → returns devLink (no Resend required)', async ({ request }) => {
    // The magic-link route returns `devLink` whenever the request is
    // not running on Vercel (VERCEL !== '1'). The whole test suite
    // depends on this — every loginAndEnsureTenant call walks the
    // devLink. So this test is BOTH a contract assertion AND a
    // canary: if a future change accidentally suppresses devLink in
    // local dev (e.g. by tightening the prod check), every other
    // E2E spec would break in confusing ways. Failing this spec
    // first surfaces the regression directly.
    const email = `nokey-405-${Date.now()}@test.local`;
    const res = await request.post('/api/auth/magic-link', {
      data: { email, returnTo: '/app' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // devLink shape: '/api/auth/verify?token=...'
    expect(typeof body.devLink).toBe('string');
    expect(body.devLink).toContain('/api/auth/verify?token=');
  });

  // Note: E2E-NOKEY-403 (deploy route 503 with no VC_API_TOKEN) is
  // intentionally NOT tested here. The route blocks earlier on a hero-
  // is-template 409 (the test seed pages start with template hero
  // copy), so reaching the deploy-credential check from the route entry
  // requires hydrating the page first — which itself needs an LLM key,
  // creating a chicken-and-egg in the no-key scenario. The underlying
  // contract is locked at the adapter level by API-DEPLOY-401 in
  // tests/api/deploy.spec.ts (deployToVercel throws DeployRequiredError
  // before any network call when VC_API_TOKEN is unset). End-to-end
  // route coverage would need either a hydrated-fixture page or a
  // way to bypass the template gate, both deferred.

  test('E2E-NOKEY-405b · magic-link rejects bad email → 400 (basic validation still enforced)', async ({ request }) => {
    // Side test: even though the no-key path returns devLink, basic
    // input validation isn't bypassed. Asserts the validation gate
    // didn't get loosened along with the dev-passthrough.
    const res = await request.post('/api/auth/magic-link', {
      data: { email: 'not an email', returnTo: '/app' },
    });
    // Per existing API-AUTH-006: bad email → 400.
    expect(res.status()).toBe(400);
  });
});

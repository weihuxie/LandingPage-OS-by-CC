/**
 * API-DEPLOY-* · Vercel deploy adapter unit tests.
 *
 * Covers from audit-2026-05.md §3.6:
 *   401  no VC_API_TOKEN → DeployRequiredError
 *   402  mock 200 + READY → status='ready'
 *   403  mock 200 + QUEUED → status='building'
 *   404  mock 4xx → DeployRecord status='error' (NOT thrown)
 *   406  input.teamId precedence over env
 *   407  env VC_TEAM_ID fallback
 *   408  no teamId → URL has no ?teamId=
 *   409  slug truncation: name field ≤ 52 chars
 *   410  request body shape validation (framework=null + files[]+ index.html)
 *   411  post-deploy PATCH disables ssoProtection + passwordProtection
 *   412  PATCH failure doesn't fail the deploy
 *   413  4xx on initial deploy → no PATCH attempted
 *   414  PATCH uses same teamId as deployment
 *
 * Test strategy: monkey-patch globalThis.fetch in beforeEach so the
 * adapter never actually calls Vercel. The mock captures the request
 * URL + body for assertions and returns whatever response shape the
 * test wants. Each test that previously asserted `calls.length === 1`
 * now allows for the trailing PATCH (calls[0] = deploy, calls[1] = PATCH).
 */
import { test, expect } from '@playwright/test';
import { deployToVercel } from '../../src/lib/deploy';
import { DeployRequiredError } from '../../src/lib/errors';

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

let originalFetch: typeof fetch;
let originalToken: string | undefined;
let originalTeamId: string | undefined;
let calls: FetchCall[] = [];

function installFetchMock(
  responder: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    return await responder(url, init);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test.describe('API-DEPLOY · deployToVercel', () => {

  test.beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalToken = process.env.VC_API_TOKEN;
    originalTeamId = process.env.VC_TEAM_ID;
    calls = [];
  });

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.VC_API_TOKEN;
    else process.env.VC_API_TOKEN = originalToken;
    if (originalTeamId === undefined) delete process.env.VC_TEAM_ID;
    else process.env.VC_TEAM_ID = originalTeamId;
  });

  test('API-DEPLOY-401 · no VC_API_TOKEN → DeployRequiredError', async () => {
    delete process.env.VC_API_TOKEN;
    delete process.env.VC_TEAM_ID;
    let caught: unknown = null;
    try {
      await deployToVercel({ slug: 'foo', html: '<html></html>' });
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught instanceof DeployRequiredError).toBe(true);
    // Defensive: confirm we never even tried to call Vercel.
    expect(calls.length).toBe(0);
  });

  test('API-DEPLOY-402 · 200 + READY → status="ready", url prefixed https://', async () => {
    process.env.VC_API_TOKEN = 'tok-test';
    delete process.env.VC_TEAM_ID;
    installFetchMock(() =>
      jsonResponse({
        id: 'dpl_xyz',
        url: 'lp-foo.vercel.app',
        readyState: 'READY',
      }),
    );
    const out = await deployToVercel({ slug: 'foo', html: '<html></html>' });
    expect(out.provider).toBe('vercel');
    expect(out.status).toBe('ready');
    expect(out.url).toBe('https://lp-foo.vercel.app');
    expect(out.deploymentId).toBe('dpl_xyz');
    expect(typeof out.deployedAt).toBe('number');
  });

  test('API-DEPLOY-403 · 200 + QUEUED → status="building"', async () => {
    process.env.VC_API_TOKEN = 'tok-test';
    delete process.env.VC_TEAM_ID;
    installFetchMock(() =>
      jsonResponse({
        id: 'dpl_q',
        url: 'lp-foo.vercel.app',
        readyState: 'QUEUED',
      }),
    );
    const out = await deployToVercel({ slug: 'foo', html: '<html></html>' });
    expect(out.status).toBe('building');
  });

  test('API-DEPLOY-404 · Vercel 4xx → DeployRecord status="error", does NOT throw', async () => {
    process.env.VC_API_TOKEN = 'tok-test';
    delete process.env.VC_TEAM_ID;
    installFetchMock(
      () =>
        new Response('Bad request from Vercel', {
          status: 400,
          headers: { 'content-type': 'text/plain' },
        }),
    );
    const out = await deployToVercel({ slug: 'foo', html: '<html></html>' });
    expect(out.status).toBe('error');
    expect(out.errorMessage).toContain('Vercel API 400');
    expect(out.errorMessage).toContain('Bad request from Vercel');
    expect(out.url).toBe('');
  });

  test('API-DEPLOY-406 · input.teamId wins over VC_TEAM_ID env', async () => {
    process.env.VC_API_TOKEN = 'tok-test';
    process.env.VC_TEAM_ID = 'team-from-env';
    installFetchMock(() => jsonResponse({ id: 'd', url: 'x.vercel.app', readyState: 'READY' }));
    await deployToVercel({ slug: 'foo', html: '<html></html>', teamId: 'team-from-input' });
    expect(calls[0].url).toContain('?teamId=team-from-input');
    expect(calls[0].url).not.toContain('team-from-env');
  });

  test('API-DEPLOY-407 · env VC_TEAM_ID used when input has no teamId', async () => {
    process.env.VC_API_TOKEN = 'tok-test';
    process.env.VC_TEAM_ID = 'team-from-env';
    installFetchMock(() => jsonResponse({ id: 'd', url: 'x.vercel.app', readyState: 'READY' }));
    await deployToVercel({ slug: 'foo', html: '<html></html>' });
    expect(calls[0].url).toContain('?teamId=team-from-env');
  });

  test('API-DEPLOY-408 · no teamId at all → URL has no ?teamId=', async () => {
    process.env.VC_API_TOKEN = 'tok-test';
    delete process.env.VC_TEAM_ID;
    installFetchMock(() => jsonResponse({ id: 'd', url: 'x.vercel.app', readyState: 'READY' }));
    await deployToVercel({ slug: 'foo', html: '<html></html>' });
    expect(calls[0].url).not.toContain('?teamId=');
  });

  test('API-DEPLOY-409 · long slug → name truncated to ≤ 52 chars', async () => {
    process.env.VC_API_TOKEN = 'tok-test';
    delete process.env.VC_TEAM_ID;
    installFetchMock(() => jsonResponse({ id: 'd', url: 'x.vercel.app', readyState: 'READY' }));
    const longSlug = 'a'.repeat(80);
    await deployToVercel({ slug: longSlug, html: '<html></html>' });
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.name.length).toBeLessThanOrEqual(52);
    expect(body.name.startsWith('lp-aaaaa')).toBe(true);
  });

  test('API-DEPLOY-410 · request body schema (target=production, framework=null, files=[index.html])', async () => {
    process.env.VC_API_TOKEN = 'tok-test';
    delete process.env.VC_TEAM_ID;
    installFetchMock(() => jsonResponse({ id: 'd', url: 'x.vercel.app', readyState: 'READY' }));
    const html = '<!doctype html><html><body>hello</body></html>';
    await deployToVercel({ slug: 'foo', html });

    // 2026-05: post-deploy PATCH (disable protection) adds a second call.
    // The deploy itself is calls[0]; calls[1] is the PATCH. Assertions
    // below target calls[0].
    expect(calls.length).toBe(2);
    const init = calls[0].init!;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-test');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.target).toBe('production');
    expect(body.projectSettings).toEqual({
      framework: null,
      devCommand: null,
      buildCommand: null,
      outputDirectory: null,
      installCommand: null,
    });
    expect(body.files).toEqual([{ file: 'index.html', data: html }]);
    expect(body.name).toBe('lp-foo');
  });

  /**
   * 2026-05: every successful deploy is followed by a PATCH that disables
   * deployment protection on the project. Without this, lp-* projects
   * inherit team defaults (which on Pro/Enterprise teams hide preview
   * URLs behind Vercel SSO) — exactly the daisy.liu@hand-china.com
   * symptom reported on 2026-05-12. See file header in src/lib/deploy.ts.
   */
  test('API-DEPLOY-411 · post-deploy PATCH disables ssoProtection + passwordProtection', async () => {
    process.env.VC_API_TOKEN = 'tok-test';
    delete process.env.VC_TEAM_ID;
    installFetchMock(() => jsonResponse({ id: 'd', url: 'lp-foo.vercel.app', readyState: 'READY' }));
    await deployToVercel({ slug: 'foo', html: '<html></html>' });

    expect(calls.length).toBe(2);
    const patchCall = calls[1];
    expect(patchCall.url).toContain('/v9/projects/lp-foo');
    expect(patchCall.init!.method).toBe('PATCH');
    expect((patchCall.init!.headers as Record<string, string>).authorization).toBe('Bearer tok-test');
    const body = JSON.parse(patchCall.init!.body as string);
    // Per Vercel API docs, `null` disables each protection mechanism.
    expect(body.ssoProtection).toBeNull();
    expect(body.passwordProtection).toBeNull();
  });

  test('API-DEPLOY-412 · PATCH failure does NOT fail the deploy', async () => {
    process.env.VC_API_TOKEN = 'tok-test';
    delete process.env.VC_TEAM_ID;
    // Smart responder: deploy returns 200/READY, PATCH returns 500.
    installFetchMock((url) => {
      if (url.includes('/v13/deployments')) {
        return jsonResponse({ id: 'd', url: 'lp-foo.vercel.app', readyState: 'READY' });
      }
      if (url.includes('/v9/projects/')) {
        return new Response('vercel internal error', { status: 500 });
      }
      return new Response('unexpected url', { status: 404 });
    });
    const out = await deployToVercel({ slug: 'foo', html: '<html></html>' });
    // Deploy result must still be the happy path — protection toggle is a
    // UX concern, not a deployment correctness gate.
    expect(out.status).toBe('ready');
    expect(out.url).toBe('https://lp-foo.vercel.app');
    expect(out.deploymentId).toBe('d');
    expect(calls.length).toBe(2);
  });

  test('API-DEPLOY-413 · failed deploy → no PATCH attempted', async () => {
    process.env.VC_API_TOKEN = 'tok-test';
    delete process.env.VC_TEAM_ID;
    installFetchMock(
      () =>
        new Response('Vercel rejected the deployment', {
          status: 400,
          headers: { 'content-type': 'text/plain' },
        }),
    );
    const out = await deployToVercel({ slug: 'foo', html: '<html></html>' });
    expect(out.status).toBe('error');
    // Critical: when /v13/deployments returns 4xx we exit early with
    // status='error'. No project exists to PATCH (Vercel doesn't create
    // it on a 4xx) — calling PATCH would be wrong AND would fail with 404.
    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain('/v13/deployments');
  });

  test('API-DEPLOY-414 · PATCH inherits the same teamId as the deploy call', async () => {
    process.env.VC_API_TOKEN = 'tok-test';
    process.env.VC_TEAM_ID = 'team-abc';
    installFetchMock(() => jsonResponse({ id: 'd', url: 'x.vercel.app', readyState: 'READY' }));
    await deployToVercel({ slug: 'foo', html: '<html></html>' });

    expect(calls.length).toBe(2);
    // Both deploy and PATCH must route through the same team scope —
    // otherwise the PATCH would 404 (project lives in the team).
    expect(calls[0].url).toContain('teamId=team-abc');
    expect(calls[1].url).toContain('teamId=team-abc');
    expect(calls[1].url).toContain('/v9/projects/lp-foo');
  });
});

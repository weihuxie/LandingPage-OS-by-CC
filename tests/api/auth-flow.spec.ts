/**
 * API-AUTH-* · S1 认证地基 happy-path smoke.
 *
 * End-to-end: magic-link → verify (=cookie) → tenant create → invite
 * mint → invite peek → invite accept (with a second user). No email
 * sending here — we grab `devLink` out of the POST response and
 * follow it directly. Production flow is identical except the link
 * arrives via email instead of JSON.
 *
 * Written against the live KV (or local .data fallback) because these
 * endpoints touch storage.ts patterns that the mocked request tests
 * can't cover.
 */
import { test, expect } from '@playwright/test';

async function mintSessionFor(request: any, email: string): Promise<string> {
  // 1. POST /api/auth/magic-link → devLink
  const sendResp = await request.post('/api/auth/magic-link', {
    data: { email },
  });
  expect(sendResp.status(), 'magic-link POST').toBe(200);
  const sendBody = await sendResp.json();
  const devLink: string | undefined = sendBody.devLink;
  expect(devLink, 'devLink present in non-prod').toBeTruthy();

  // 2. GET the verify URL (redirects to /app, sets lp_user cookie)
  //    We disable automatic redirects so we can read the Set-Cookie.
  const verifyResp = await request.get(devLink!, { maxRedirects: 0 });
  expect(verifyResp.status(), 'verify redirect').toBeGreaterThanOrEqual(300);
  expect(verifyResp.status()).toBeLessThan(400);
  const setCookie = verifyResp.headers()['set-cookie'];
  expect(setCookie, 'Set-Cookie on verify').toBeTruthy();
  // Parse the lp_user value out of the Set-Cookie header. Playwright
  // gives us the raw header string; real browsers would handle this
  // automatically via the request context.
  const match = /lp_user=([^;]+)/.exec(setCookie!);
  expect(match, 'lp_user cookie value').toBeTruthy();
  return match![1];
}

test.describe('API-AUTH · S1 auth foundation', () => {
  test('API-AUTH-001 · magic-link → verify → session', async ({ request }) => {
    const email = `test-${Date.now()}@example.com`;
    const cookie = await mintSessionFor(request, email);

    const sessionResp = await request.get('/api/auth/session', {
      headers: { cookie: `lp_user=${cookie}` },
    });
    expect(sessionResp.status()).toBe(200);
    const sessionBody = await sessionResp.json();
    expect(sessionBody.user).toBeTruthy();
    expect(sessionBody.user.email).toBe(email.toLowerCase());
    expect(sessionBody.tenants).toEqual([]);
  });

  test('API-AUTH-002 · reused magic-link rejected (one-time)', async ({ request }) => {
    const email = `test-${Date.now()}-reuse@example.com`;
    const sendResp = await request.post('/api/auth/magic-link', { data: { email } });
    const devLink = (await sendResp.json()).devLink;

    // First click consumes the token.
    const first = await request.get(devLink, { maxRedirects: 0 });
    expect(first.status()).toBeGreaterThanOrEqual(300);
    expect(first.status()).toBeLessThan(400);

    // Second click should redirect to /login?err=INVALID_OR_EXPIRED.
    const second = await request.get(devLink, { maxRedirects: 0 });
    expect(second.status()).toBeGreaterThanOrEqual(300);
    const loc = second.headers()['location']!;
    expect(loc).toContain('/login');
    expect(loc).toContain('INVALID_OR_EXPIRED');
  });

  test('API-AUTH-003 · end-to-end: create tenant → invite → second user accepts', async ({
    request,
  }) => {
    const ownerEmail = `owner-${Date.now()}@example.com`;
    const guestEmail = `guest-${Date.now()}@example.com`;

    // Owner: magic-link + verify
    const ownerCookie = await mintSessionFor(request, ownerEmail);

    // Owner creates a tenant
    const tenantResp = await request.post('/api/tenants', {
      data: { name: `Test Workspace ${Date.now()}` },
      headers: { cookie: `lp_user=${ownerCookie}` },
    });
    expect(tenantResp.status()).toBe(200);
    const { tenant } = await tenantResp.json();
    expect(tenant.ownerId).toBeTruthy();

    // Owner mints an invite (editor role by default)
    const mintResp = await request.post(`/api/tenants/${tenant.id}/invites`, {
      data: {},
      headers: { cookie: `lp_user=${ownerCookie}` },
    });
    expect(mintResp.status()).toBe(200);
    const { invite } = await mintResp.json();
    expect(invite.role).toBe('editor');

    // Anyone (not logged in) can peek the invite
    const peekResp = await request.get(`/api/invites/${invite.token}`);
    expect(peekResp.status()).toBe(200);
    const peekBody = await peekResp.json();
    expect(peekBody.invite.tenantName).toBe(tenant.name);
    expect(peekBody.invite.valid).toBe(true);

    // Guest signs in, then accepts
    const guestCookie = await mintSessionFor(request, guestEmail);
    const acceptResp = await request.post(`/api/invites/${invite.token}/accept`, {
      headers: { cookie: `lp_user=${guestCookie}` },
    });
    expect(acceptResp.status()).toBe(200);
    const acceptBody = await acceptResp.json();
    expect(acceptBody.alreadyMember).toBe(false);

    // Guest's session now lists the new tenant
    const guestSession = await request.get('/api/auth/session', {
      headers: { cookie: `lp_user=${guestCookie}` },
    });
    const guestSessionBody = await guestSession.json();
    expect(guestSessionBody.tenants.map((t: any) => t.id)).toContain(tenant.id);

    // Accepting again is idempotent (alreadyMember=true, no duplicate row)
    const reacceptResp = await request.post(`/api/invites/${invite.token}/accept`, {
      headers: { cookie: `lp_user=${guestCookie}` },
    });
    expect(reacceptResp.status()).toBe(200);
    expect((await reacceptResp.json()).alreadyMember).toBe(true);
  });

  test('API-AUTH-004 · disabled invite rejects accept (410)', async ({ request }) => {
    const ownerEmail = `owner2-${Date.now()}@example.com`;
    const guestEmail = `guest2-${Date.now()}@example.com`;

    const ownerCookie = await mintSessionFor(request, ownerEmail);
    const tenantResp = await request.post('/api/tenants', {
      data: { name: `Disabled Test ${Date.now()}` },
      headers: { cookie: `lp_user=${ownerCookie}` },
    });
    const { tenant } = await tenantResp.json();
    const mintResp = await request.post(`/api/tenants/${tenant.id}/invites`, {
      data: {},
      headers: { cookie: `lp_user=${ownerCookie}` },
    });
    const { invite } = await mintResp.json();

    // Disable the invite
    const disableResp = await request.patch(
      `/api/tenants/${tenant.id}/invites/${invite.token}`,
      {
        data: { disabled: true },
        headers: { cookie: `lp_user=${ownerCookie}` },
      },
    );
    expect(disableResp.status()).toBe(200);

    // Guest tries to accept → 410
    const guestCookie = await mintSessionFor(request, guestEmail);
    const acceptResp = await request.post(`/api/invites/${invite.token}/accept`, {
      headers: { cookie: `lp_user=${guestCookie}` },
    });
    expect(acceptResp.status()).toBe(410);
    expect((await acceptResp.json()).code).toBe('INVITE_DISABLED');
  });

  test('API-AUTH-005 · non-owner cannot mint invites (403)', async ({ request }) => {
    const ownerEmail = `owner3-${Date.now()}@example.com`;
    const editorEmail = `editor3-${Date.now()}@example.com`;

    const ownerCookie = await mintSessionFor(request, ownerEmail);
    const tenantResp = await request.post('/api/tenants', {
      data: { name: `Perm Test ${Date.now()}` },
      headers: { cookie: `lp_user=${ownerCookie}` },
    });
    const { tenant } = await tenantResp.json();

    // Owner mints invite, editor accepts
    const mintResp = await request.post(`/api/tenants/${tenant.id}/invites`, {
      data: {},
      headers: { cookie: `lp_user=${ownerCookie}` },
    });
    const { invite } = await mintResp.json();
    const editorCookie = await mintSessionFor(request, editorEmail);
    await request.post(`/api/invites/${invite.token}/accept`, {
      headers: { cookie: `lp_user=${editorCookie}` },
    });

    // Editor tries to mint their own invite → 403
    const unauthorizedMint = await request.post(`/api/tenants/${tenant.id}/invites`, {
      data: {},
      headers: { cookie: `lp_user=${editorCookie}` },
    });
    expect(unauthorizedMint.status()).toBe(403);
  });

  test('API-AUTH-006 · bad email → 400', async ({ request }) => {
    const resp = await request.post('/api/auth/magic-link', {
      data: { email: 'not-an-email' },
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).code).toBe('BAD_EMAIL');
  });
});

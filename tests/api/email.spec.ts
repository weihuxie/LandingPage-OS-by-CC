/**
 * API-EMAIL-* · Email module unit tests.
 *
 * Covers from audit-2026-05.md §3.5:
 *   401, 402   isEmailConfigured (env on/off)
 *   403        sendMagicLinkEmail no key → EmailNotConfiguredError
 *   405-408    categorizeResendError (auth / unverified-domain / invalid-recipient / rate-limit)
 *   411        categorizeResendError(undefined) → 'other'
 *   412, 413   renderMagicLinkEmail HTML escapes (XSS guard) — P0
 *   414, 415   getFromAddress (env override + default)
 *
 * Deferred (require Resend SDK mock infrastructure):
 *   404 success no-throw
 *   409 missing data.id
 *   410 SDK throws → wrapped network error
 *   These cases are partially covered by the categorize tests since
 *   that function is the only branch-decision logic in send-failure
 *   handling. Full integration mock is a follow-up — needs `vi.mock`
 *   or a fetch-level interceptor like MSW which the project doesn't
 *   currently install.
 */
import { test, expect } from '@playwright/test';
import {
  EmailNotConfiguredError,
  EmailSendError,
  categorizeResendError,
  isEmailConfigured,
  sendMagicLinkEmail,
  renderMagicLinkEmail,
  getFromAddress,
} from '../../src/lib/email';

test.describe('API-EMAIL · isEmailConfigured', () => {

  // Save + restore env across the suite so other suites' env state isn't
  // disturbed (esp. relevant when running the full project test pass).
  let originalKey: string | undefined;

  test.beforeEach(() => {
    originalKey = process.env.RESEND_API_KEY;
  });

  test.afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  test('API-EMAIL-401 · no env → false', () => {
    delete process.env.RESEND_API_KEY;
    expect(isEmailConfigured()).toBe(false);
  });

  test('API-EMAIL-402 · empty string env → false (length > 0 guard)', () => {
    process.env.RESEND_API_KEY = '';
    expect(isEmailConfigured()).toBe(false);
  });
});

test.describe('API-EMAIL · sendMagicLinkEmail no-key path', () => {

  let originalKey: string | undefined;

  test.beforeEach(() => {
    originalKey = process.env.RESEND_API_KEY;
  });

  test.afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  test('API-EMAIL-403 · no key → EmailNotConfiguredError thrown', async () => {
    delete process.env.RESEND_API_KEY;
    let caught: unknown = null;
    try {
      await sendMagicLinkEmail('a@b.com', 'https://x.test/verify?t=1');
    } catch (e) {
      caught = e;
    }
    expect(caught, 'expected throw, got success').not.toBeNull();
    expect(caught instanceof EmailNotConfiguredError).toBe(true);
    expect((caught as Error).message).toContain('RESEND_API_KEY');
  });
});

test.describe('API-EMAIL · categorizeResendError (pure function)', () => {

  test('API-EMAIL-405 · 401 status → auth', () => {
    expect(categorizeResendError({ statusCode: 401, message: 'invalid api key' })).toBe('auth');
  });

  test('API-EMAIL-405b · 403 status → auth', () => {
    expect(categorizeResendError({ statusCode: 403, message: 'forbidden' })).toBe('auth');
  });

  test('API-EMAIL-405c · name contains api_key → auth (status-less variant)', () => {
    expect(categorizeResendError({ name: 'invalid_api_key', message: 'bad key' })).toBe('auth');
  });

  test('API-EMAIL-406 · "you can only send testing emails to your own email address" → unverified-domain', () => {
    expect(
      categorizeResendError({
        message: 'You can only send testing emails to your own email address',
      }),
    ).toBe('unverified-domain');
  });

  test('API-EMAIL-406b · "verify a domain" message variant → unverified-domain', () => {
    expect(categorizeResendError({ message: 'Please verify a domain first.' })).toBe('unverified-domain');
  });

  test('API-EMAIL-406c · "verified domain" message variant → unverified-domain', () => {
    expect(categorizeResendError({ message: 'Send only allowed from a verified domain.' })).toBe('unverified-domain');
  });

  test('API-EMAIL-407 · 422 + invalid email → invalid-recipient', () => {
    expect(
      categorizeResendError({ statusCode: 422, message: 'invalid email address' }),
    ).toBe('invalid-recipient');
  });

  test('API-EMAIL-408 · 429 → rate-limit', () => {
    expect(categorizeResendError({ statusCode: 429 })).toBe('rate-limit');
  });

  test('API-EMAIL-408b · name contains rate_limit → rate-limit (status-less variant)', () => {
    expect(categorizeResendError({ name: 'rate_limit_exceeded', message: 'too many' })).toBe('rate-limit');
  });

  test('API-EMAIL-411 · undefined input → other', () => {
    expect(categorizeResendError(undefined)).toBe('other');
  });

  test('API-EMAIL-411b · null input → other', () => {
    expect(categorizeResendError(null)).toBe('other');
  });

  test('API-EMAIL-411c · 500 server error w/ generic message → other', () => {
    expect(categorizeResendError({ statusCode: 500, message: 'internal error' })).toBe('other');
  });
});

test.describe('API-EMAIL · renderMagicLinkEmail HTML escape (XSS guard, P0)', () => {

  test('API-EMAIL-412 · URL with & is escaped to &amp;', () => {
    const url = 'https://x.test/verify?token=abc&returnTo=/app';
    const { html, text } = renderMagicLinkEmail(url);

    // The escaped form is what should appear in the rendered HTML.
    expect(html).toContain('https://x.test/verify?token=abc&amp;returnTo=/app');
    // The raw `&returnTo` (without amp;) must NOT appear unescaped — that
    // would be a literal HTML attribute injection vector if the URL ever
    // contained &lt; / &gt; / etc. Conservative escape on URLs is the
    // belt-and-suspenders defense the email source documents.
    expect(html).not.toContain('?token=abc&returnTo=');

    // Text branch is plain — should keep the URL verbatim (no HTML
    // escaping; text/plain has no markup to escape into).
    expect(text).toContain(url);
  });

  test('API-EMAIL-413 · URL with " is escaped to &quot;', () => {
    const url = 'https://x.test/verify?token=ab"cd';
    const { html } = renderMagicLinkEmail(url);

    // Without escape, the `"` would close the href attribute early —
    // textbook HTML attribute injection. Escaped form keeps the quote
    // inside the attribute value.
    expect(html).toContain('https://x.test/verify?token=ab&quot;cd');
    // Make sure the raw double-quote did not survive the escape pass.
    expect(html).not.toContain('?token=ab"cd');
  });

  test('API-EMAIL-413b · URL appears in BOTH the button href and the visible fallback span', () => {
    // The render emits the URL twice (once as <a href=> and once as the
    // visible plain-text fallback). Both occurrences must use the
    // escaped form — a regression that escapes one but not the other
    // would leave a half-protected page that still gets ed in
    // certain webmail clients that strip <a> but render the visible text.
    const url = 'https://x.test/v?a=1&b=2';
    const { html } = renderMagicLinkEmail(url);
    const escaped = 'https://x.test/v?a=1&amp;b=2';
    // Find both occurrences (one href, one inside the visible span).
    const matches = html.split(escaped).length - 1;
    expect(
      matches,
      `Escaped URL should appear at least 2× (href + visible). Found ${matches}.`,
    ).toBeGreaterThanOrEqual(2);
  });
});

test.describe('API-EMAIL · getFromAddress', () => {

  let savedFromEmail: string | undefined;
  let savedFromName: string | undefined;

  test.beforeEach(() => {
    savedFromEmail = process.env.MAGIC_LINK_FROM_EMAIL;
    savedFromName = process.env.MAGIC_LINK_FROM_NAME;
  });

  test.afterEach(() => {
    if (savedFromEmail === undefined) delete process.env.MAGIC_LINK_FROM_EMAIL;
    else process.env.MAGIC_LINK_FROM_EMAIL = savedFromEmail;
    if (savedFromName === undefined) delete process.env.MAGIC_LINK_FROM_NAME;
    else process.env.MAGIC_LINK_FROM_NAME = savedFromName;
  });

  test('API-EMAIL-414 · env overrides → "Acme <hi@my.com>"', () => {
    process.env.MAGIC_LINK_FROM_EMAIL = 'hi@my.com';
    process.env.MAGIC_LINK_FROM_NAME = 'Acme';
    expect(getFromAddress()).toBe('Acme <hi@my.com>');
  });

  test('API-EMAIL-415 · no env → "LandingPage OS <onboarding@resend.dev>" defaults', () => {
    delete process.env.MAGIC_LINK_FROM_EMAIL;
    delete process.env.MAGIC_LINK_FROM_NAME;
    expect(getFromAddress()).toBe('LandingPage OS <onboarding@resend.dev>');
  });
});

test.describe('API-EMAIL · EmailSendError shape', () => {

  test('API-EMAIL-shape · constructor preserves reason + cause + category', () => {
    const cause = new Error('underlying');
    const e = new EmailSendError('send failed for X', cause, 'rate-limit');
    expect(e.name).toBe('EmailSendError');
    expect(e.message).toContain('send failed for X');
    expect(e.cause).toBe(cause);
    expect(e.category).toBe('rate-limit');
    expect(e.reason).toBe('send failed for X');
  });

  test('API-EMAIL-shape-b · default category is "other"', () => {
    const e = new EmailSendError('whatever');
    expect(e.category).toBe('other');
  });
});

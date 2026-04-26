/**
 * GET /app/t/[id] — switch active tenant + redirect to dashboard.
 *
 * The /app workspace list links each tenant card to /app/t/<tenantId>.
 * Clicking should:
 *   1. Verify the user actually belongs to that tenant (defense vs.
 *      hand-crafted URL probing)
 *   2. Set the lp_tenant cookie to that tenant id
 *   3. Redirect to the locale-prefixed dashboard
 *
 * Implemented as a route handler (not a page) because pages in Next.js
 * 14 can read but not write cookies — and the whole point of this URL
 * is to write the cookie. Route handlers can do both.
 */
import { NextRequest, NextResponse } from 'next/server';
import { USER_COOKIE, verifyUserCookie } from '@/lib/user-auth';
import { getMember } from '@/lib/auth-storage';
import { TENANT_COOKIE_NAME, TENANT_COOKIE_MAX_AGE } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const cookie = req.cookies.get(USER_COOKIE.NAME)?.value;
  const userId = await verifyUserCookie(cookie);
  if (!userId) {
    const url = new URL('/login', req.nextUrl.origin);
    url.searchParams.set('returnTo', `/app/t/${params.id}`);
    return NextResponse.redirect(url, { status: 303 });
  }

  // Membership check: refuse to set the tenant cookie for a tenant the
  // user isn't a member of. Without this check, anyone could craft a
  // URL with another tenant's id and (post-cookie-set) be filtered into
  // 404s on every business page anyway — but the loud refusal here
  // surfaces the mistake instead of silently 404ing every subsequent
  // navigation.
  const member = await getMember(params.id, userId);
  if (!member) {
    const url = new URL('/app', req.nextUrl.origin);
    url.searchParams.set('err', 'NOT_A_MEMBER');
    return NextResponse.redirect(url, { status: 303 });
  }

  // Default-locale-prefixed dashboard. We intentionally don't sniff
  // Accept-Language here — the locale routing in the rest of the app
  // is unaffected, and pinning to zh-CN matches the dashboard's home.
  // Users who want a different locale just navigate after landing.
  const dest = new URL('/zh-CN/dashboard', req.nextUrl.origin);
  const resp = NextResponse.redirect(dest, { status: 303 });
  // eslint-disable-next-line dot-notation
  const isProd = process.env['VERCEL'] === '1' || process.env['NODE_ENV'] === 'production';
  resp.cookies.set({
    name: TENANT_COOKIE_NAME,
    value: params.id,
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: TENANT_COOKIE_MAX_AGE,
  });
  return resp;
}

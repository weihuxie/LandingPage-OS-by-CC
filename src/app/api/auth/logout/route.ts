/**
 * POST /api/auth/logout — clear the user session cookie.
 *
 * No server-side session table to invalidate (cookies are stateless
 * HMACs), so this is purely a cookie-expiring header. The cookie is
 * also re-issued with an empty value so a mis-configured client that
 * ignores Max-Age=0 still can't replay the old value.
 */
import { NextResponse } from 'next/server';
import { userCookieHeader } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST() {
  const resp = NextResponse.json({ ok: true });
  resp.headers.set('Set-Cookie', userCookieHeader('', { clear: true }));
  return resp;
}

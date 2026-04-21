import { NextResponse } from 'next/server';
import { adminCookieHeader } from '@/lib/admin-auth';

// Logout is trivial — clear the cookie with Max-Age=0. No server-side
// session to invalidate because the cookie IS the session (signed HMAC,
// stateless).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST() {
  const resp = NextResponse.json({ ok: true });
  resp.headers.set('Set-Cookie', adminCookieHeader('', { clear: true }));
  return resp;
}

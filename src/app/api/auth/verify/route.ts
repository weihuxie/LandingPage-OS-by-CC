/**
 * GET /api/auth/verify?token=xxx
 *
 * Consumes a magic-link token:
 *   · valid?       → find-or-create user, set session cookie, redirect
 *                    to the link's returnTo (or /app by default)
 *   · invalid?     → redirect to /login?err=<code>
 *
 * This is a GET endpoint (not POST) on purpose — the token is in the
 * URL so users click once from email and land logged in. The one-time
 * consume flag on the magic link guards against replay if the email
 * client prefetches the URL (many mail apps do — hence short 15 min
 * TTL so a prefetched-and-never-clicked link expires soon).
 */
import { NextRequest, NextResponse } from 'next/server';
import { consumeMagicLink, getUserByEmail, saveUser, newId } from '@/lib/auth-storage';
import { signUserCookie, userCookieHeader } from '@/lib/user-auth';
import type { User } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function redirectWithErr(req: NextRequest, code: string): NextResponse {
  const url = new URL('/login', req.nextUrl.origin);
  url.searchParams.set('err', code);
  return NextResponse.redirect(url, { status: 303 });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return redirectWithErr(req, 'MISSING_TOKEN');

  const link = await consumeMagicLink(token);
  if (!link) return redirectWithErr(req, 'INVALID_OR_EXPIRED');

  // Find-or-create user. The canonicalized email is the identity key,
  // so alice@GMAIL.com and alice@gmail.com collapse to one record.
  let user = await getUserByEmail(link.email);
  if (!user) {
    const newUser: User = {
      id: newId('usr'),
      email: link.email,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    };
    user = await saveUser(newUser);
  } else {
    // Touch lastLoginAt on each session start — cheap analytics
    // without extra infra.
    user = await saveUser({ ...user, lastLoginAt: Date.now() });
  }

  const cookie = await signUserCookie(user.id);
  // Default landing: /app. If the magic-link was minted while trying
  // to accept an invite, returnTo is set to /invite/<token> so the
  // user resumes that flow instead of bouncing to the generic app.
  const redirectTo = link.returnTo || '/app';
  const resp = NextResponse.redirect(new URL(redirectTo, req.nextUrl.origin), { status: 303 });
  resp.headers.set('Set-Cookie', userCookieHeader(cookie));
  return resp;
}

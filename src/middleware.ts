/**
 * Middleware — two jobs now (2026-04 起):
 *   1. next-intl locale handling for the dashboard UI (same as before).
 *   2. Admin gate for /admin/* and /api/admin/* (new).
 *
 * Previously this file was a thin createMiddleware(...) re-export. When
 * the admin config panel (for LLM routing) was added, we needed an auth
 * gate in front of it. Rather than add a second middleware file (Next.js
 * only supports one), both responsibilities live here and the matcher is
 * widened to include /api/admin paths (the intl matcher explicitly
 * excluded /api).
 *
 * Ordering matters:
 *   - Admin paths get gated FIRST. next-intl would otherwise try to
 *     prefix locale segments onto /admin/ which it shouldn't own.
 *   - Non-admin /api/* gets a pass-through (next()). next-intl never
 *     touched /api before — preserve that.
 *   - Everything else falls to the intl middleware (locale prefixing,
 *     negotiation, etc).
 */
import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale } from './i18n';
import { verifyAdminCookie, adminConfigured, COOKIE } from './lib/admin-auth';

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

const LOGIN_PAGE = '/admin/login';
const SETUP_PAGE = '/admin/setup-required';

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- Admin gate -------------------------------------------------------
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    // Always-reachable entry points — otherwise nobody can log in.
    if (
      pathname === LOGIN_PAGE ||
      pathname === SETUP_PAGE ||
      pathname === '/api/admin/login'
    ) {
      return NextResponse.next();
    }

    // ADMIN_PASSWORD not configured → the panel is unusable until an
    // operator sets it. Serve a clear setup page for UI and a 503 for API
    // calls rather than a generic 401.
    if (!adminConfigured()) {
      if (pathname.startsWith('/api/admin/')) {
        return NextResponse.json(
          {
            error: 'admin-not-configured',
            code: 'ADMIN_NOT_CONFIGURED',
            message:
              'Set ADMIN_PASSWORD env var in Vercel project settings, then redeploy.',
          },
          { status: 503 },
        );
      }
      const url = req.nextUrl.clone();
      url.pathname = SETUP_PAGE;
      return NextResponse.redirect(url);
    }

    // Verify the HMAC-signed cookie. See lib/admin-auth.ts for the format.
    const cookieValue = req.cookies.get(COOKIE.NAME)?.value;
    const ok = await verifyAdminCookie(cookieValue);
    if (ok) return NextResponse.next();

    // Unauthorized — JSON for API, redirect to login for pages.
    if (pathname.startsWith('/api/admin/')) {
      return NextResponse.json(
        {
          error: 'unauthorized',
          code: 'ADMIN_UNAUTHORIZED',
          message: 'Login required. POST /api/admin/login with { password }.',
        },
        { status: 401 },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = LOGIN_PAGE;
    // Only preserve same-origin /admin/* as the next= param so this
    // redirect can't be weaponized to dump users onto an external URL.
    if (pathname.startsWith('/admin/')) {
      url.searchParams.set('next', pathname);
    }
    return NextResponse.redirect(url);
  }

  // --- Non-admin /api/* → pass-through -----------------------------------
  // next-intl never handled /api (the original matcher excluded it). We
  // need an explicit next() here because our widened matcher now catches
  // /api/admin — once we've decided the path is NOT admin-scoped we hand
  // it back to Next.js without any locale negotiation.
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // --- Everything else → next-intl --------------------------------------
  return intlMiddleware(req);
}

export const config = {
  // Widened to include /api/admin while still skipping static assets,
  // _next internals, and the public landing-page renderer at /p/*. The
  // admin gate above short-circuits /api/admin so the rest of /api stays
  // untouched. Note: the public renderer /p/* is intentionally excluded
  // so visitors of the live landing pages don't pay the middleware cost.
  matcher: [
    '/',
    '/((?!_next|_vercel|p|.*\\..*).*)',
  ],
};

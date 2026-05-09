/**
 * PATCH /api/auth/profile
 *
 * Update mutable user-profile fields. Phase 1 (2026-05) supports only
 * `displayLocale` (admin-UI language preference) — extending to
 * displayName / avatar later is a one-line addition per field.
 *
 * Side effects:
 *   - Persist to User record in storage
 *   - Re-bake the lp_display_locale cookie so middleware picks up the
 *     new preference on the very next request without a re-login
 *
 * Auth: requires lp_user session (no tenant required — profile is per-
 * user, not per-tenant). Returns the updated User on success.
 *
 * GET on this same route returns the current user's profile shape — a
 * thin wrapper over /api/auth/session that callers can preload before
 * rendering a profile form. (We intentionally keep /api/auth/session
 * minimal for the legacy session shape.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { saveUser } from '@/lib/auth-storage';
import { displayLocaleCookieHeader } from '@/lib/user-auth';
import { locales } from '@/i18n';
import type { User } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_LOCALES = new Set(locales as readonly string[]);

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'unauthorized', code: 'UNAUTHORIZED', message: 'Login required.' },
      { status: 401 },
    );
  }
  return NextResponse.json({ user });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'unauthorized', code: 'UNAUTHORIZED', message: 'Login required.' },
      { status: 401 },
    );
  }

  let body: { displayLocale?: unknown };
  try {
    body = (await req.json()) as { displayLocale?: unknown };
  } catch {
    return NextResponse.json(
      { error: 'bad-request', code: 'BAD_REQUEST', message: 'JSON body required.' },
      { status: 400 },
    );
  }

  // Validate displayLocale: must be in the closed admin-UI locale list.
  // Reject empty string explicitly so PATCH {displayLocale: ''} doesn't
  // silently clear the field — that's a separate intent (DELETE-style)
  // we'd surface differently if we ever supported it.
  let nextLocale: User['displayLocale'] | undefined;
  if (body.displayLocale !== undefined) {
    if (typeof body.displayLocale !== 'string' || !ALLOWED_LOCALES.has(body.displayLocale)) {
      return NextResponse.json(
        {
          error: 'invalid-locale',
          code: 'INVALID_LOCALE',
          message: `displayLocale must be one of: ${[...ALLOWED_LOCALES].join(', ')}`,
        },
        { status: 400 },
      );
    }
    nextLocale = body.displayLocale as User['displayLocale'];
  }

  // No-op short-circuit: client sent a value but it matches what's already
  // stored. Skip the KV write, just bounce the cookie back so a refresh
  // doesn't lose it.
  const noChange = nextLocale !== undefined && nextLocale === user.displayLocale;

  const updated: User = noChange
    ? user
    : await saveUser({ ...user, displayLocale: nextLocale ?? user.displayLocale });

  const resp = NextResponse.json({ user: updated });
  // Always re-set the cookie when the request mentioned displayLocale
  // (even on no-op) so cookie/DB stay aligned across devices.
  if (nextLocale !== undefined) {
    resp.headers.append('Set-Cookie', displayLocaleCookieHeader(nextLocale));
  }
  return resp;
}

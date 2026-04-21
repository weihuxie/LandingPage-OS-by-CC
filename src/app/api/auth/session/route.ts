/**
 * GET /api/auth/session  — current user + their tenants.
 *
 * Used by the client header / tenant switcher to know who's logged in.
 * Returns 200 with null user when the cookie is absent/invalid — this
 * makes the endpoint polling-friendly (no 401 spam in devtools when a
 * user lands on a public page without a session).
 */
import { NextRequest, NextResponse } from 'next/server';
import { USER_COOKIE, verifyUserCookie } from '@/lib/user-auth';
import { getUser, listTenantsForUser } from '@/lib/auth-storage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(USER_COOKIE.NAME)?.value;
  const userId = await verifyUserCookie(cookie);
  if (!userId) return NextResponse.json({ user: null, tenants: [] });

  const user = await getUser(userId);
  if (!user) {
    // Cookie valid but user row deleted — stale session. Return null
    // so the client knows to log out.
    return NextResponse.json({ user: null, tenants: [] });
  }
  const tenants = await listTenantsForUser(userId);
  return NextResponse.json({
    user: { id: user.id, email: user.email, displayName: user.displayName },
    tenants: tenants.map((t) => ({ id: t.id, name: t.name, ownerId: t.ownerId })),
  });
}

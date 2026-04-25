/**
 * Server-component / route-handler auth helpers.
 *
 * Distinct from `user-auth.ts` (low-level crypto) and `auth-storage.ts`
 * (DB) — this module is the "given a request, who is the user / what
 * tenant should we scope to?" layer. SSR pages and API handlers both
 * call into here so they don't reimplement cookie parsing + tenant
 * resolution five different ways.
 *
 * S2 design (CLAUDE.md §四点五):
 *   · `lp_user` cookie carries userId + signed timestamp
 *   · `lp_tenant` cookie carries the user's currently-selected tenant.
 *     Always validated against tenant_members so a stale cookie can't
 *     grant access to a tenant the user has been kicked out of.
 *   · No tenant cookie → default to user's first tenant (alphabetical
 *     by id; doesn't matter for single-tenant users which is most of
 *     them at first)
 *   · No tenants at all → caller decides (SSR redirects to
 *     /app/onboard, API returns 403)
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { USER_COOKIE, verifyUserCookie } from './user-auth';
import {
  getMember,
  getUser,
  listTenantsForUser,
} from './auth-storage';
import type { User, Tenant, TenantRole } from './types';

export const TENANT_COOKIE_NAME = 'lp_tenant';
export const TENANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, matches user cookie

export interface AuthContext {
  user: User;
  tenant: Tenant;
  role: TenantRole;
  /** All tenants this user belongs to — drives the workspace switcher. */
  allTenants: Tenant[];
}

/**
 * Read the current user from cookies. Returns null when no session,
 * stale cookie, or user record was deleted server-side. Does NOT
 * redirect — the caller decides what to do.
 */
export async function getCurrentUser(): Promise<User | null> {
  const ck = cookies().get(USER_COOKIE.NAME)?.value;
  const userId = await verifyUserCookie(ck);
  if (!userId) return null;
  return await getUser(userId);
}

/**
 * Resolve the active tenant for a user. Read order:
 *   1. lp_tenant cookie if it points at a tenant the user is a member of
 *   2. user's first tenant (sorted by createdAt asc — oldest first)
 *
 * Returns null when the user belongs to no tenants — caller is
 * responsible for routing to onboarding (`/app` shows the create-or-
 * accept-invite UI in that case).
 */
export async function getCurrentTenant(
  user: User,
): Promise<{ tenant: Tenant; role: TenantRole; allTenants: Tenant[] } | null> {
  const allTenants = await listTenantsForUser(user.id);
  if (allTenants.length === 0) return null;
  allTenants.sort((a, b) => a.createdAt - b.createdAt);

  const cookieTenant = cookies().get(TENANT_COOKIE_NAME)?.value;
  let tenant: Tenant | undefined;
  if (cookieTenant) {
    tenant = allTenants.find((t) => t.id === cookieTenant);
  }
  if (!tenant) tenant = allTenants[0];

  // Confirm membership (defense-in-depth: cookie + tenant set should
  // agree, but if the user was removed we still want to refuse rather
  // than serve them stale tenant data).
  const member = await getMember(tenant.id, user.id);
  if (!member) {
    // Cookie pointed at a tenant they no longer belong to. Fall back
    // to the next available one. Don't fail loud — the workspace
    // switcher in the UI will reflect the corrected selection on next
    // render.
    const fallback = allTenants.find((t) => t.id !== tenant!.id);
    if (!fallback) return null;
    const fbMember = await getMember(fallback.id, user.id);
    if (!fbMember) return null;
    return { tenant: fallback, role: fbMember.role, allTenants };
  }
  return { tenant, role: member.role, allTenants };
}

/**
 * SSR helper: redirect to /login if no session, /app if logged in but
 * with no tenants. Returns the resolved AuthContext on success. Use
 * from server components like:
 *   const { user, tenant } = await requireUserAndTenant();
 *
 * The `redirect()` calls throw to abort rendering — never returns past
 * those.
 */
export async function requireUserAndTenant(returnTo?: string): Promise<AuthContext> {
  const user = await getCurrentUser();
  if (!user) {
    // Carry returnTo so /api/auth/verify can route the user back to
    // where they tried to go after the magic link click.
    const qs = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
    redirect(`/login${qs}`);
  }
  const tenantCtx = await getCurrentTenant(user);
  if (!tenantCtx) {
    // Logged in but no workspace yet — `/app` shows the create-tenant
    // CTA and pending invite list.
    redirect('/app');
  }
  return { user, ...tenantCtx };
}

// --- API-handler helper -----------------------------------------------

import { NextResponse } from 'next/server';

/**
 * Result of `requireUserApi`: either the resolved auth context or a
 * NextResponse to return immediately. Caller pattern:
 *
 *   const auth = await requireUserApi(req);
 *   if ('response' in auth) return auth.response;
 *   const { user, tenant } = auth;
 *   ...
 *
 * Different shape from the SSR helper because API handlers can't use
 * Next.js `redirect()` (it's SSR-only) — they need to return a 401
 * with a structured body so the client can react. The chosen pattern
 * keeps the happy path readable without throwing across module
 * boundaries (which would force every caller into try/catch).
 */
export type ApiAuthResult =
  | { response: NextResponse }
  | AuthContext;

export async function requireUserApi(): Promise<ApiAuthResult> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      response: NextResponse.json(
        {
          error: 'unauthorized',
          code: 'UNAUTHORIZED',
          message: 'Login required.',
        },
        { status: 401 },
      ),
    };
  }
  const tenantCtx = await getCurrentTenant(user);
  if (!tenantCtx) {
    // Logged in but no tenants. /app's onboarding handles the human
    // path; APIs return 409 to make it visually distinct from "not
    // logged in" so client-side handlers can route the user to /app
    // instead of /login.
    return {
      response: NextResponse.json(
        {
          error: 'no-tenant',
          code: 'NO_TENANT',
          message: 'You have no workspace yet. Visit /app to create one.',
        },
        { status: 409 },
      ),
    };
  }
  return { user, ...tenantCtx };
}

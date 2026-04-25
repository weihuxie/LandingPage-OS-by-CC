/**
 * POST /api/tenants  { name }
 *
 * Creates a new workspace (tenant) owned by the authenticated user. The
 * caller is automatically added as a tenant_member with role=owner.
 *
 * No cap on tenants-per-user in S1. Revisit when we add billing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { USER_COOKIE, verifyUserCookie } from '@/lib/user-auth';
import {
  getUser,
  saveTenant,
  addMember,
  newId,
  listTenantsForUser,
  countTenants,
} from '@/lib/auth-storage';
import { claimLegacyData } from '@/lib/storage';
import type { Tenant } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(USER_COOKIE.NAME)?.value;
  const userId = await verifyUserCookie(cookie);
  if (!userId) {
    return NextResponse.json(
      { error: 'not-authenticated', code: 'NOT_AUTHENTICATED', message: '请先登录' },
      { status: 401 },
    );
  }
  const user = await getUser(userId);
  if (!user) {
    return NextResponse.json(
      { error: 'user-not-found', code: 'USER_NOT_FOUND', message: '用户不存在' },
      { status: 401 },
    );
  }

  let body: { name?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'bad-body', code: 'BAD_BODY', message: 'expected JSON' },
      { status: 400 },
    );
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) {
    return NextResponse.json(
      {
        error: 'bad-name',
        code: 'BAD_NAME',
        message: 'name 必须是 1-80 字的字符串',
      },
      { status: 400 },
    );
  }

  // Snapshot the tenant count BEFORE creating, so we can detect the
  // "you're the very first tenant" case below for legacy data claim.
  const priorCount = await countTenants();

  const tenant: Tenant = {
    id: newId('tnt'),
    name,
    ownerId: user.id,
    createdAt: Date.now(),
  };
  await saveTenant(tenant);
  await addMember({
    tenantId: tenant.id,
    userId: user.id,
    role: 'owner',
    joinedAt: Date.now(),
    // No invitedVia — self-created tenants have no invite.
  });

  // S2/C4 claim mode: if there were zero tenants before this one, the
  // creator inherits all pre-S2 data (Products / Pages / Leads / Brand
  // currently stamped LEGACY_TENANT_ID='default'). Subsequent tenants
  // start empty as expected.
  let claim:
    | Awaited<ReturnType<typeof claimLegacyData>>
    | null = null;
  if (priorCount === 0) {
    try {
      claim = await claimLegacyData(tenant.id);
      console.warn(
        `[tenants] first-tenant claim: tenant=${tenant.id} ` +
          `products=${claim.productsClaimed} pages=${claim.pagesClaimed} ` +
          `leads=${claim.leadsClaimed} brand=${claim.brandClaimed}`,
      );
    } catch (e) {
      // Don't fail the tenant create if claim hits storage. The tenant
      // exists; admin can re-run claim manually if needed.
      console.error('[tenants] legacy claim failed (tenant created OK):', e);
    }
  }

  return NextResponse.json({ tenant, claim });
}

/**
 * GET /api/tenants — list tenants the caller is a member of.
 *
 * Duplicates what /api/auth/session already returns, but kept as a
 * separate endpoint so non-session consumers (e.g. future admin tools)
 * can query without pulling the session context.
 */
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(USER_COOKIE.NAME)?.value;
  const userId = await verifyUserCookie(cookie);
  if (!userId) {
    return NextResponse.json(
      { error: 'not-authenticated', code: 'NOT_AUTHENTICATED', message: '请先登录' },
      { status: 401 },
    );
  }
  const tenants = await listTenantsForUser(userId);
  return NextResponse.json({ tenants });
}

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
} from '@/lib/auth-storage';
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

  return NextResponse.json({ tenant });
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

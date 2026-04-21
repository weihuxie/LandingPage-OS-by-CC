/**
 * POST /api/tenants/[id]/invites  { role? }   — mint a new invite link
 * GET  /api/tenants/[id]/invites              — list invites for tenant
 * PATCH /api/tenants/[id]/invites/[token]     — see sibling file
 *
 * Both require the caller to be a member of the tenant with role=owner.
 * Editors can't invite in S1 (conservative default; loosen later if
 * customer asks). The tenant owner's identity is always a member with
 * role=owner — this is set by POST /api/tenants which creates them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { USER_COOKIE, verifyUserCookie, generateToken } from '@/lib/user-auth';
import {
  getMember,
  getTenant,
  saveInvite,
  listInvitesForTenant,
  INVITE_TTL_MS,
} from '@/lib/auth-storage';
import type { Invite, TenantRole } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function requireOwner(
  req: NextRequest,
  tenantId: string,
): Promise<{ ok: true; userId: string } | NextResponse> {
  const cookie = req.cookies.get(USER_COOKIE.NAME)?.value;
  const userId = await verifyUserCookie(cookie);
  if (!userId) {
    return NextResponse.json(
      { error: 'not-authenticated', code: 'NOT_AUTHENTICATED', message: '请先登录' },
      { status: 401 },
    );
  }
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    return NextResponse.json(
      { error: 'tenant-not-found', code: 'TENANT_NOT_FOUND', message: '工作空间不存在' },
      { status: 404 },
    );
  }
  const member = await getMember(tenantId, userId);
  if (!member || member.role !== 'owner') {
    return NextResponse.json(
      { error: 'forbidden', code: 'FORBIDDEN', message: '只有工作空间所有者能管理邀请' },
      { status: 403 },
    );
  }
  return { ok: true, userId };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireOwner(req, params.id);
  if (auth instanceof NextResponse) return auth;

  let body: { role?: TenantRole } = {};
  try {
    body = await req.json();
  } catch {
    body = {}; // body is optional; default role=editor
  }
  const role: TenantRole = body.role === 'owner' || body.role === 'editor' ? body.role : 'editor';

  const now = Date.now();
  const invite: Invite = {
    token: generateToken(24),
    tenantId: params.id,
    role,
    invitedBy: auth.userId,
    createdAt: now,
    expiresAt: now + INVITE_TTL_MS,
  };
  await saveInvite(invite);
  return NextResponse.json({ invite });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireOwner(req, params.id);
  if (auth instanceof NextResponse) return auth;
  const invites = await listInvitesForTenant(params.id);
  return NextResponse.json({ invites });
}

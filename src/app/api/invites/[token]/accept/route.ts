/**
 * POST /api/invites/[token]/accept — caller joins the tenant as member.
 *
 * Preconditions:
 *   · caller is authenticated (has lp_user cookie)
 *   · invite exists, not expired, not disabled
 *
 * Idempotent: if the caller is already a member of the tenant, returns
 * 200 with the existing membership — no duplicate row, no upgrade /
 * downgrade of role. (Role promotion must go through an explicit owner-
 * side flow, not "accept the same link again".)
 *
 * Anyone holding the link can call this — 2026-04-21 decision: NOT
 * email-locked. Owner's recourse if a link is being misused is the
 * PATCH ... { disabled: true } endpoint.
 */
import { NextRequest, NextResponse } from 'next/server';
import { USER_COOKIE, verifyUserCookie } from '@/lib/user-auth';
import { addMember, getInvite, getMember } from '@/lib/auth-storage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const cookie = req.cookies.get(USER_COOKIE.NAME)?.value;
  const userId = await verifyUserCookie(cookie);
  if (!userId) {
    return NextResponse.json(
      { error: 'not-authenticated', code: 'NOT_AUTHENTICATED', message: '请先登录' },
      { status: 401 },
    );
  }

  const invite = await getInvite(params.token);
  if (!invite) {
    return NextResponse.json(
      { error: 'invite-not-found', code: 'INVITE_NOT_FOUND', message: '邀请链接不存在' },
      { status: 404 },
    );
  }
  if (invite.expiresAt < Date.now()) {
    return NextResponse.json(
      { error: 'invite-expired', code: 'INVITE_EXPIRED', message: '邀请链接已过期' },
      { status: 410 },
    );
  }
  if (invite.disabled) {
    return NextResponse.json(
      { error: 'invite-disabled', code: 'INVITE_DISABLED', message: '邀请链接已被停用' },
      { status: 410 },
    );
  }

  // Idempotent: already a member → return existing membership and bail.
  const existing = await getMember(invite.tenantId, userId);
  if (existing) {
    return NextResponse.json({
      member: existing,
      tenantId: invite.tenantId,
      alreadyMember: true,
    });
  }

  const member = await addMember({
    tenantId: invite.tenantId,
    userId,
    role: invite.role,
    joinedAt: Date.now(),
    invitedVia: invite.token,
  });
  return NextResponse.json({ member, tenantId: invite.tenantId, alreadyMember: false });
}

/**
 * PATCH /api/tenants/[id]/invites/[token]  { disabled? }
 *
 * Owner-only. Flip the `disabled` kill switch on an invite link without
 * deleting it — keeps the audit trail (who-invited-via-what-link) even
 * after the link is retired.
 */
import { NextRequest, NextResponse } from 'next/server';
import { USER_COOKIE, verifyUserCookie } from '@/lib/user-auth';
import { getInvite, getMember, saveInvite } from '@/lib/auth-storage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; token: string } },
) {
  const cookie = req.cookies.get(USER_COOKIE.NAME)?.value;
  const userId = await verifyUserCookie(cookie);
  if (!userId) {
    return NextResponse.json(
      { error: 'not-authenticated', code: 'NOT_AUTHENTICATED', message: '请先登录' },
      { status: 401 },
    );
  }

  const invite = await getInvite(params.token);
  if (!invite || invite.tenantId !== params.id) {
    return NextResponse.json(
      { error: 'invite-not-found', code: 'INVITE_NOT_FOUND', message: '邀请链接不存在' },
      { status: 404 },
    );
  }
  const member = await getMember(params.id, userId);
  if (!member || member.role !== 'owner') {
    return NextResponse.json(
      { error: 'forbidden', code: 'FORBIDDEN', message: '只有所有者能管理邀请' },
      { status: 403 },
    );
  }

  let body: { disabled?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const next = { ...invite };
  if (typeof body.disabled === 'boolean') next.disabled = body.disabled;
  await saveInvite(next);
  return NextResponse.json({ invite: next });
}

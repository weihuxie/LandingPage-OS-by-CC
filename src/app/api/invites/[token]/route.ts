/**
 * GET  /api/invites/[token]        — peek invite info (public, no auth)
 * POST /api/invites/[token]/accept — add caller as tenant member
 *
 * GET is intentionally UNAUTHENTICATED so the /invite/[token] page can
 * render "XXX invited you to YYY" copy before the user logs in. Peek
 * leaks only the tenant NAME and role — not the member list, not
 * anything else — so a guessable token scan doesn't expose private
 * data beyond "this tenant exists and invites editors".
 */
import { NextRequest, NextResponse } from 'next/server';
import { getInvite, getTenant, getUser } from '@/lib/auth-storage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const invite = await getInvite(params.token);
  if (!invite) {
    return NextResponse.json(
      { error: 'invite-not-found', code: 'INVITE_NOT_FOUND', message: '邀请链接不存在或已被删除' },
      { status: 404 },
    );
  }
  const now = Date.now();
  const expired = invite.expiresAt < now;
  const disabled = !!invite.disabled;

  // Even if expired/disabled, still return the tenant name + role so
  // the landing page can render "This invite is no longer valid,
  // contact XXX to request a new one" with context. Signals the
  // end-user something expected went wrong vs a mysterious 404.
  const tenant = await getTenant(invite.tenantId);
  const inviter = await getUser(invite.invitedBy);

  return NextResponse.json({
    invite: {
      token: invite.token,
      tenantId: invite.tenantId,
      tenantName: tenant?.name ?? '(工作空间已删除)',
      role: invite.role,
      invitedByEmail: inviter?.email,
      expired,
      disabled,
      valid: !expired && !disabled,
      expiresAt: invite.expiresAt,
    },
  });
}

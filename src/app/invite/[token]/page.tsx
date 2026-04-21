/**
 * /invite/[token] — Accept-invite landing page.
 *
 * Three states rendered server-side:
 *   1. Invite invalid / expired / disabled  → explanation + link to home
 *   2. Invite valid, user logged out         → show context + "登录以加入"
 *                                              (link to /login?returnTo=/invite/<token>)
 *   3. Invite valid, user logged in          → show context + "接受/取消"
 *                                              confirmation form (decision 5)
 *
 * Token peek is unauthenticated (GET /api/invites/[token]) — anyone with
 * the link can see tenant name + role before deciding whether to sign
 * up. That's the 2026-04-21 spec ("不 lock").
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getInvite, getTenant, getUser, getMember } from '@/lib/auth-storage';
import { USER_COOKIE, verifyUserCookie } from '@/lib/user-auth';
import AcceptForm from './AcceptForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function InviteLandingPage({
  params,
}: {
  params: { token: string };
}) {
  const invite = await getInvite(params.token);

  if (!invite) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <h1 className="text-2xl font-semibold">邀请链接无效</h1>
        <p className="mt-2 text-sm text-ink-500">
          链接可能已被删除，或者你复制的时候少了几个字符。联系发你链接的人重新要一份。
        </p>
      </div>
    );
  }

  const now = Date.now();
  const expired = invite.expiresAt < now;
  const disabled = !!invite.disabled;
  const tenant = await getTenant(invite.tenantId);
  const inviter = await getUser(invite.invitedBy);

  if (expired || disabled || !tenant) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <h1 className="text-2xl font-semibold">邀请链接不可用</h1>
        <p className="mt-2 text-sm text-ink-500">
          {expired
            ? '这条邀请链接已过期。'
            : disabled
              ? '这条邀请链接已被邀请方停用。'
              : '工作空间已不存在。'}
          &nbsp;
          {inviter?.email ? (
            <>
              请联系 <code className="rounded bg-ink-100 px-1">{inviter.email}</code>{' '}
              重新发一个。
            </>
          ) : (
            '请联系邀请方。'
          )}
        </p>
      </div>
    );
  }

  // Invite valid. Check login state.
  const cookie = cookies().get(USER_COOKIE.NAME)?.value;
  const userId = await verifyUserCookie(cookie);

  if (!userId) {
    // Not logged in — send them through /login with returnTo set so
    // the magic-link verify redirects them BACK here after login.
    const loginHref = `/login?returnTo=${encodeURIComponent(`/invite/${params.token}`)}`;
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <h1 className="text-2xl font-semibold">加入 {tenant.name}</h1>
        <p className="mt-2 text-sm text-ink-500">
          {inviter?.email ? <code className="rounded bg-ink-100 px-1">{inviter.email}</code> : '有人'}{' '}
          邀请你以{' '}
          <span className="font-medium">
            {invite.role === 'owner' ? '所有者' : '编辑'}
          </span>{' '}
          身份加入 <span className="font-medium">{tenant.name}</span> 工作空间。
        </p>
        <p className="mt-4 text-sm text-ink-500">
          先登录或注册，之后会自动回到这里确认加入。
        </p>
        <a href={loginHref} className="btn btn-primary mt-6 block text-center">
          登录以加入
        </a>
      </div>
    );
  }

  // Already a member? Go straight to /app (no confirmation step needed —
  // clicking the same invite twice is idempotent from the user's POV).
  const existing = await getMember(invite.tenantId, userId);
  if (existing) {
    redirect('/app');
  }

  // Logged in, not a member yet — show confirmation (decision 5).
  return (
    <div className="mx-auto max-w-md px-4 py-24">
      <h1 className="text-2xl font-semibold">加入 {tenant.name}?</h1>
      <p className="mt-2 text-sm text-ink-500">
        {inviter?.email ? <code className="rounded bg-ink-100 px-1">{inviter.email}</code> : '有人'}{' '}
        邀请你以{' '}
        <span className="font-medium">
          {invite.role === 'owner' ? '所有者' : '编辑'}
        </span>{' '}
        身份加入 <span className="font-medium">{tenant.name}</span> 工作空间。
      </p>
      <AcceptForm token={params.token} tenantName={tenant.name} />
    </div>
  );
}

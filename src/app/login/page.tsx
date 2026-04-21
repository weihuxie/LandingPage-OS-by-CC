/**
 * /login — Magic-link entry for product-side users.
 *
 * Flow:
 *   1. User types email → POST /api/auth/magic-link
 *   2. In dev, response includes `devLink` which the form shows as a
 *      click-through button (so we can test without SMTP).
 *   3. In prod (Summit 前要做 S1 后续工作), the response is just
 *      `{ ok: true }` and the link gets emailed.
 *
 * `err` query param comes from the /api/auth/verify redirect — surfaces
 * specific reasons (token expired, invalid, etc.) so the user sees a
 * useful message instead of a generic "please log in" every time.
 */
import LoginForm from './LoginForm';

const ERR_MESSAGES: Record<string, string> = {
  MISSING_TOKEN: '登录链接无效。请输入邮箱获取新链接。',
  INVALID_OR_EXPIRED: '登录链接已失效或已被使用。请重新获取。',
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: { err?: string; returnTo?: string };
}) {
  const errMsg = searchParams.err ? ERR_MESSAGES[searchParams.err] ?? null : null;
  const returnTo = searchParams.returnTo?.startsWith('/') ? searchParams.returnTo : undefined;

  return (
    <div className="mx-auto max-w-sm px-4 py-24">
      <h1 className="text-2xl font-semibold">登录 LandingPage OS</h1>
      <p className="mt-2 text-sm text-ink-500">
        输入邮箱，我们会给你发一条一次性登录链接（15 分钟内有效）。
      </p>
      {errMsg && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {errMsg}
        </div>
      )}
      <LoginForm returnTo={returnTo} />
    </div>
  );
}

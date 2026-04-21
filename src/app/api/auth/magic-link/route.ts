/**
 * POST /api/auth/magic-link  { email, returnTo? }
 *
 * Creates a one-time login link for `email`, valid 15 min. In S1 the
 * link is RETURNED IN THE RESPONSE BODY because no email-sending
 * provider is wired up yet — this is explicit and loud so ops don't
 * accidentally ship this to production without first adding Resend /
 * SendGrid / SES. Production: the response should only contain
 * `{ ok: true }` and the link should go out over email.
 *
 * Intentionally does NOT confirm whether the email already has an
 * account. The response shape is identical whether the email is known
 * or new — prevents account enumeration.
 */
import { NextRequest, NextResponse } from 'next/server';
import { canonicalEmail, generateToken } from '@/lib/user-auth';
import { saveMagicLink, MAGIC_LINK_TTL_MS } from '@/lib/auth-storage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: { email?: string; returnTo?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'bad-body', code: 'BAD_BODY', message: 'expected JSON' },
      { status: 400 },
    );
  }

  const rawEmail = typeof body.email === 'string' ? body.email : '';
  if (!EMAIL_RE.test(rawEmail)) {
    return NextResponse.json(
      { error: 'bad-email', code: 'BAD_EMAIL', message: '邮箱格式错误' },
      { status: 400 },
    );
  }
  const email = canonicalEmail(rawEmail);

  // Sanity-clamp returnTo so a user can't be redirected off-origin
  // via a malicious magic-link submission. Only accept same-origin
  // paths starting with /.
  const returnTo =
    typeof body.returnTo === 'string' && body.returnTo.startsWith('/')
      ? body.returnTo
      : undefined;

  const token = generateToken(32);
  const now = Date.now();
  await saveMagicLink({
    token,
    email,
    createdAt: now,
    expiresAt: now + MAGIC_LINK_TTL_MS,
    returnTo,
  });

  // eslint-disable-next-line dot-notation
  const isProd = process.env['VERCEL'] === '1' || process.env['NODE_ENV'] === 'production';
  const origin = req.nextUrl.origin;
  const link = `${origin}/api/auth/verify?token=${encodeURIComponent(token)}`;

  // TODO(S1 follow-up): Plumb into an email provider (Resend likely).
  // Until then, in development we return the link so we can click-test
  // the whole flow without SMTP. In production we refuse to echo the
  // link — better to 503 loud than to silently ship a magic link in
  // the HTTP response body.
  if (isProd) {
    console.error(
      `[magic-link] email sending not configured. Would send link for ${email}. ` +
        `Set MAGIC_LINK_EMAIL_PROVIDER to enable.`,
    );
    return NextResponse.json(
      {
        error: 'email-not-configured',
        code: 'EMAIL_NOT_CONFIGURED',
        message: '服务器未配置邮件发送服务，请联系管理员。',
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    // Only present in non-prod; UI uses it to auto-fill a "click here"
    // shortcut during dogfooding.
    devLink: link,
  });
}

/**
 * POST /api/auth/magic-link  { email, returnTo? }
 *
 * Creates a one-time login link for `email` (15 min TTL) and sends it
 * via Resend. Response shapes:
 *
 *   · dev, Resend configured       → { ok, devLink } + email sent
 *   · dev, Resend NOT configured   → { ok, devLink } (no email)
 *   · prod, Resend configured      → { ok }
 *   · prod, Resend NOT configured  → 503 EMAIL_NOT_CONFIGURED
 *   · send error (any env)         → 502 EMAIL_SEND_FAILED
 *
 * Dev leaves devLink in the body for click-through testing even when
 * Resend is configured — convenient during dogfooding, invisible in
 * prod (the isProd branch drops the field).
 *
 * Intentionally does NOT confirm whether the email already has an
 * account. Response shape is identical whether the email is known or
 * new — prevents account enumeration. For the same reason, email
 * validation errors return 400 (structural) but "unknown email" and
 * "known email" paths look identical to the caller.
 */
import { NextRequest, NextResponse } from 'next/server';
import { canonicalEmail, generateToken } from '@/lib/user-auth';
import { saveMagicLink, MAGIC_LINK_TTL_MS } from '@/lib/auth-storage';
import {
  sendMagicLinkEmail,
  isEmailConfigured,
  EmailNotConfiguredError,
  EmailSendError,
} from '@/lib/email';

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

  // Prod with no Resend configured: refuse loud. Better to 503 than to
  // silently write a magic link to KV that nobody can ever click.
  if (isProd && !isEmailConfigured()) {
    console.error(
      `[magic-link] RESEND_API_KEY not set. Would send link for ${email}. ` +
        `Set RESEND_API_KEY in Vercel env to enable email delivery.`,
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

  // Attempt to send. Dev without Resend: skip the send and return
  // devLink — this lets `npm run dev` work without any env setup.
  if (isEmailConfigured()) {
    try {
      await sendMagicLinkEmail(email, link);
    } catch (e) {
      if (e instanceof EmailNotConfiguredError) {
        // Race: isEmailConfigured() returned true above but the key
        // vanished between check and send. Should be impossible, but
        // if it does happen treat as 503 — same UX as the initial
        // check would have produced.
        return NextResponse.json(
          {
            error: 'email-not-configured',
            code: 'EMAIL_NOT_CONFIGURED',
            message: '服务器未配置邮件发送服务，请联系管理员。',
          },
          { status: 503 },
        );
      }
      if (e instanceof EmailSendError) {
        console.error(`[magic-link] Resend send failed for ${email}:`, e);
        return NextResponse.json(
          {
            error: 'email-send-failed',
            code: 'EMAIL_SEND_FAILED',
            message: '邮件发送失败，请稍后重试。',
          },
          { status: 502 },
        );
      }
      throw e;
    }
  }

  return NextResponse.json({
    ok: true,
    // devLink is present only in non-prod so dogfooding doesn't require
    // checking a mailbox. Dropped in prod even when Resend is configured.
    ...(isProd ? {} : { devLink: link }),
  });
}

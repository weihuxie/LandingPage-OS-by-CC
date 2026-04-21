/**
 * Transactional email sending via Resend (S1 follow-up).
 *
 * Environment:
 *   RESEND_API_KEY            — required in prod; absent in dev lets the
 *                               magic-link route return `devLink` inline
 *                               instead of attempting to send.
 *   MAGIC_LINK_FROM_EMAIL     — defaults to `onboarding@resend.dev` so a
 *                               fresh install works without domain setup.
 *                               Upgrade to a verified domain before Summit.
 *   MAGIC_LINK_FROM_NAME      — display name on the From header (default
 *                               "LandingPage OS").
 *
 * Design decisions:
 *   · One function per email template (sendMagicLinkEmail). Keeps the
 *     API surface tiny and obvious; if we add password-reset or team-
 *     invite emails later, add siblings, don't generalize prematurely.
 *   · Errors are typed (EmailNotConfiguredError / EmailSendError) so
 *     the route layer can return a specific status code without
 *     string-matching message text.
 *   · No retry logic here — Resend is reliable at the SLA tier, and
 *     retrying a transient failure client-side risks sending twice.
 *     Ops should watch Resend dashboard for elevated error rates.
 */
import { Resend } from 'resend';

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('RESEND_API_KEY not configured');
    this.name = 'EmailNotConfiguredError';
  }
}

export class EmailSendError extends Error {
  constructor(public reason: string, public cause?: unknown) {
    super(`Email send failed: ${reason}`);
    this.name = 'EmailSendError';
  }
}

function getApiKey(): string | null {
  // eslint-disable-next-line dot-notation
  const k = process.env['RESEND_API_KEY'];
  return k && k.length > 0 ? k : null;
}

function getFromAddress(): string {
  // eslint-disable-next-line dot-notation
  const email = process.env['MAGIC_LINK_FROM_EMAIL'] || 'onboarding@resend.dev';
  // eslint-disable-next-line dot-notation
  const name = process.env['MAGIC_LINK_FROM_NAME'] || 'LandingPage OS';
  return `${name} <${email}>`;
}

export function isEmailConfigured(): boolean {
  return getApiKey() !== null;
}

/**
 * Send a one-click login link to `to`. Throws on missing config or
 * Resend failure; the caller decides how to surface to the end-user.
 *
 * `loginUrl` is the absolute URL the recipient clicks — typically
 * `<origin>/api/auth/verify?token=<token>`. Caller constructs it to
 * keep this function origin-agnostic (test with a fake origin, staging
 * with a preview origin, prod with the canonical origin).
 */
export async function sendMagicLinkEmail(to: string, loginUrl: string): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) throw new EmailNotConfiguredError();

  const resend = new Resend(apiKey);
  const from = getFromAddress();
  const { html, text } = renderMagicLinkEmail(loginUrl);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject: '登录 LandingPage OS',
      html,
      text,
    });
    if (error) {
      throw new EmailSendError(error.message ?? 'resend returned error', error);
    }
    if (!data?.id) {
      // Defensive: Resend's happy-path response always has `data.id`.
      // If it ever doesn't, that's a contract change we want to notice.
      throw new EmailSendError('resend response missing data.id');
    }
  } catch (e) {
    if (e instanceof EmailSendError) throw e;
    // Network / SDK-level crash → wrap so the caller sees a typed error.
    throw new EmailSendError(
      e instanceof Error ? e.message : String(e),
      e,
    );
  }
}

/**
 * Minimal HTML + text rendering. Kept inline (not a template file) so
 * there's no build step coupling. If we add more emails later, a
 * `src/lib/email-templates/` folder with per-template modules is the
 * obvious shape — but for one email, one function is fine.
 *
 * The email is intentionally brand-light (no logo image, no marketing
 * footer) because many corporate email clients clip long HTML or hide
 * remote images. Plain text fallback carries the same link — some
 * email clients (mutt, CLI clients) only render text.
 */
function renderMagicLinkEmail(loginUrl: string): { html: string; text: string } {
  // Escape the URL into HTML attribute context just in case. Tokens are
  // URL-safe base64 (no HTML-special chars), but we pay nothing for the
  // defensive encode and it future-proofs against a token format change.
  const safeUrl = loginUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.05)">
      <h1 style="font-size:20px;margin:0 0 16px">登录 LandingPage OS</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 24px;color:#374151">
        点击下方按钮完成登录。链接 15 分钟内有效，只能使用一次。
      </p>
      <p style="margin:0 0 24px">
        <a href="${safeUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">
          登录
        </a>
      </p>
      <p style="font-size:12px;line-height:1.6;margin:0;color:#6b7280">
        如果按钮不工作，复制下面的链接到浏览器打开：<br>
        <span style="word-break:break-all;color:#2563eb">${safeUrl}</span>
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;line-height:1.6;margin:0;color:#9ca3af">
        如果你没有请求登录，忽略这封邮件即可 —— 可能是别人输错了邮箱。
      </p>
    </div>
  </body>
</html>`;
  const text = `登录 LandingPage OS

点击下方链接完成登录。15 分钟内有效，只能使用一次。

${loginUrl}

如果你没有请求登录，忽略这封邮件即可。`;
  return { html, text };
}

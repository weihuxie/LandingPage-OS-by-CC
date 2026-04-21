import { NextRequest, NextResponse } from 'next/server';
import {
  adminConfigured,
  adminCookieHeader,
  signAdminCookie,
  verifyPassword,
} from '@/lib/admin-auth';

// Auth is a dynamic capability — no caching, no prerender.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/admin/login  { password: string }
 *
 * Success: 200 with Set-Cookie `lp_admin=<signed>`. No body fields the
 * client needs beyond the cookie — the form just redirects on ok.
 *
 * Failures (fail loud, specific status codes so the form can show precise
 * messages):
 *   - 400  bad body shape
 *   - 503  ADMIN_PASSWORD not configured in this environment
 *   - 401  wrong password
 *
 * No rate limiting here (see CLAUDE.md §七 note on threat model). A
 * brute-forced password is the failure mode to worry about; mitigation
 * is "use a long random password" via the setup-required page copy.
 */
export async function POST(req: NextRequest) {
  if (!adminConfigured()) {
    return NextResponse.json(
      {
        error: 'admin-not-configured',
        code: 'ADMIN_NOT_CONFIGURED',
        message: 'Set ADMIN_PASSWORD env var first.',
      },
      { status: 503 },
    );
  }

  let body: { password?: string } = {};
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json(
      { error: 'bad-body', code: 'BAD_BODY', message: 'expected JSON' },
      { status: 400 },
    );
  }
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) {
    return NextResponse.json(
      { error: 'missing-password', code: 'MISSING_PASSWORD', message: 'password required' },
      { status: 400 },
    );
  }

  const ok = await verifyPassword(password);
  if (!ok) {
    return NextResponse.json(
      { error: 'wrong-password', code: 'WRONG_PASSWORD', message: '密码不对' },
      { status: 401 },
    );
  }

  const cookieValue = await signAdminCookie();
  const resp = NextResponse.json({ ok: true });
  resp.headers.set('Set-Cookie', adminCookieHeader(cookieValue));
  return resp;
}

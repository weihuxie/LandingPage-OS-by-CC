/**
 * User-facing auth (S1 of 2026-06 Summit 多租户权限改造).
 *
 * Distinct from admin-auth.ts:
 *   - admin-auth.ts gates ONE operator (you) on /admin/*
 *   - this module gates MANY product-side customers on /app/*, /tenants/*
 *
 * Design: signed stateless session cookie (like admin-auth.ts) — no
 * server-side session table. Cookie carries `{userId}.{issuedAt}.{hmac}`,
 * verifier re-computes HMAC and rejects old / tampered cookies. Password-
 * less: users log in via magic link emailed to them, S3 adds Google +
 * Microsoft OAuth alongside. No plaintext password is ever stored.
 *
 * Cookie name differs from admin (`lp_user` vs `lp_admin`) so both can
 * coexist on the same domain if you ever log in as yourself AND as an
 * admin from the same browser (e.g. Summit dogfooding).
 *
 * HMAC secret: prefers USER_COOKIE_SECRET env, falls back to deriving
 * from the same source as admin. The admin helper already pads short
 * inputs so the minimum-16-byte entropy rule holds.
 */

const COOKIE_NAME = 'lp_user';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days — same as admin

export const USER_COOKIE = {
  NAME: COOKIE_NAME,
  MAX_AGE_SECONDS,
};

/**
 * Get the HMAC secret for user session cookies. Prefers a dedicated
 * USER_COOKIE_SECRET so the admin password can rotate without logging
 * out every customer, falls back to ADMIN_COOKIE_SECRET or the padded
 * admin password as ultimate backstop.
 */
let devFallbackWarned = false;
function getSecret(): string | null {
  // eslint-disable-next-line dot-notation
  const dedicated = process.env['USER_COOKIE_SECRET'];
  if (dedicated && dedicated.length >= 16) return dedicated;
  // eslint-disable-next-line dot-notation
  const adminDedicated = process.env['ADMIN_COOKIE_SECRET'];
  if (adminDedicated && adminDedicated.length >= 16) return adminDedicated;
  // eslint-disable-next-line dot-notation
  const adminPw = process.env['ADMIN_PASSWORD'];
  if (adminPw && adminPw.length > 0) {
    return `lp-user-secret::${adminPw}::${adminPw.length}`;
  }
  // Dev-only fallback: local runs without any env should "just work" so
  // new contributors don't bounce off an opaque 500 the moment they click
  // the magic link. On Vercel (prod or preview) we REFUSE to fall back —
  // missing secrets there are a real configuration bug and the loud 500
  // is the point.
  // eslint-disable-next-line dot-notation
  if (process.env['VERCEL'] === '1') return null;
  if (!devFallbackWarned) {
    console.warn(
      '[user-auth] No USER_COOKIE_SECRET / ADMIN_COOKIE_SECRET / ADMIN_PASSWORD set. ' +
        'Using INSECURE dev fallback. DO NOT ship this to production.',
    );
    devFallbackWarned = true;
  }
  return 'lp-user-dev-secret-insecure-do-not-ship-1234567890';
}

// --- Session cookie sign / verify --------------------------------------

/**
 * Produce a signed session cookie for `userId`. Value format:
 *   `<userId>.<issuedAt>.<hex-hmac>`
 * issuedAt is a unix-ms string so verifyUserCookie can compute age
 * without parsing the payload separately.
 */
export async function signUserCookie(userId: string): Promise<string> {
  const secret = getSecret();
  if (!secret) throw new Error('user auth secret not configured');
  const issuedAt = Date.now().toString();
  const payload = `${userId}.${issuedAt}`;
  const mac = await hmac(secret, payload);
  return `${payload}.${mac}`;
}

/**
 * Verify a session cookie. Returns the `userId` on success, null on
 * any failure (bad format, bad signature, expired, secret not set).
 */
export async function verifyUserCookie(
  cookie: string | undefined,
): Promise<string | null> {
  if (!cookie) return null;
  const secret = getSecret();
  if (!secret) return null;
  const parts = cookie.split('.');
  if (parts.length !== 3) return null;
  const [userId, issuedAtStr, mac] = parts;
  if (!userId || !issuedAtStr) return null;
  const issuedAt = parseInt(issuedAtStr, 10);
  if (!Number.isFinite(issuedAt)) return null;
  const ageSec = (Date.now() - issuedAt) / 1000;
  if (ageSec < 0 || ageSec > MAX_AGE_SECONDS) return null;
  const expectedMac = await hmac(secret, `${userId}.${issuedAtStr}`);
  if (!constantTimeEqual(hexToBytes(mac), hexToBytes(expectedMac))) return null;
  return userId;
}

/**
 * Shape the Set-Cookie header for the user session cookie. `clear=true`
 * produces an immediately-expiring cookie for logout.
 *
 * SameSite=Lax (not Strict like admin) so magic-link click from an email
 * client delivers the cookie on navigation. Strict would drop the cookie
 * because the navigation's referrer (mail.google.com) differs from our
 * domain — user would click the link and land on a logged-out page, very
 * confusing. Lax keeps CSRF protection for all non-GET cross-site
 * requests which is what we actually need.
 */
export function userCookieHeader(value: string, opts: { clear?: boolean } = {}): string {
  const maxAge = opts.clear ? 0 : MAX_AGE_SECONDS;
  // eslint-disable-next-line dot-notation
  const isProd = process.env['VERCEL'] === '1' || process.env['NODE_ENV'] === 'production';
  const secure = isProd ? 'Secure; ' : '';
  return `${COOKIE_NAME}=${opts.clear ? '' : value}; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=${maxAge}`;
}

// --- Token generation for magic links and invites ----------------------

/**
 * 32-byte URL-safe random token. Used for both magic links (one-time,
 * 15min TTL) and invites (multi-use, 14d TTL) — the token space is
 * large enough that collision probability is irrelevant.
 *
 * Uses Web Crypto so this runs in both Edge and Node runtimes.
 */
export function generateToken(bytes: number = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  // URL-safe base64: +→-, /→_, strip =
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// --- Crypto helpers (copy of admin-auth.ts, kept separate so bundle splits cleanly) ---

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const padded = hex.length % 2 === 0 ? hex : hex + '0';
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// --- Email canonicalization --------------------------------------------

/**
 * Normalize email for storage + lookup so alice@GMAIL.com and
 * alice@gmail.com map to the same user. We DO NOT apply Gmail's
 * dot-stripping / plus-tag removal — those are provider-specific
 * behaviors, and applying them here would collapse `a.lice@gmail.com`
 * and `alice@gmail.com` into one account, which is surprising if a
 * user intentionally typed the dotted form.
 */
export function canonicalEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

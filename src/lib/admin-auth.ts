/**
 * Admin-page authentication (2026-04 新增).
 *
 * This is the ONLY gate on the /admin UI and /api/admin/* endpoints. The
 * public app has no user auth — it's a solo-operator tool — but config
 * endpoints (LLM routing, fallback chain, model selection) affect every
 * user, so we don't want them reachable by path-guessing on a public URL.
 *
 * Threat model (be explicit so the next person can judge if this is
 * enough):
 *   - Assumes ADMIN_PASSWORD and ADMIN_COOKIE_SECRET are long random
 *     strings set in Vercel env. If either is weak, everything below is
 *     theater. The UI doesn't rate-limit login attempts — if the app
 *     ever gets real usage this needs upstream help (Vercel edge
 *     middleware rate limiter, or move to a real auth provider).
 *   - Cookie is httpOnly + secure + sameSite=strict so a stolen cookie
 *     needs either server compromise or a sibling-subdomain XSS we don't
 *     have today.
 *   - HMAC is SHA-256 over `issuedAt` so the server can verify without
 *     storing sessions. No revocation list — logout just clears the
 *     cookie client-side. If the password is rotated, every existing
 *     admin session also invalidates (by changing the cookie secret).
 *
 * All crypto goes through Web Crypto so the same code runs in the Edge
 * middleware and in Node API routes. Don't import `crypto` here — it
 * won't run in middleware.
 */

const COOKIE_NAME = 'lp_admin';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface AdminAuthState {
  configured: boolean; // ADMIN_PASSWORD env set
  authenticated: boolean; // cookie valid
}

function getPassword(): string | null {
  // eslint-disable-next-line dot-notation
  const p = process.env['ADMIN_PASSWORD'];
  return p && p.length > 0 ? p : null;
}

/**
 * The HMAC secret for signing cookies. We prefer a dedicated ADMIN_COOKIE_SECRET
 * env so rotating the password doesn't require re-deriving the secret — but
 * fall back to deriving from ADMIN_PASSWORD so the first-time setup is
 * one env var, not two. Admins who care can set both.
 */
function getSecret(): string | null {
  // eslint-disable-next-line dot-notation
  const dedicated = process.env['ADMIN_COOKIE_SECRET'];
  if (dedicated && dedicated.length >= 16) return dedicated;
  const pw = getPassword();
  if (!pw) return null;
  // Pad short passwords so we never drop below 16 bytes of entropy into
  // HMAC — the admin might set a short password if they don't read the
  // warning. This doesn't *create* entropy but makes the derived secret
  // deterministically long.
  return `lp-admin-secret::${pw}::${pw.length}`;
}

export const COOKIE = {
  NAME: COOKIE_NAME,
  MAX_AGE_SECONDS,
};

export function adminConfigured(): boolean {
  return getPassword() !== null;
}

/**
 * Check a submitted password against ADMIN_PASSWORD.
 *
 * Uses a constant-time comparison via Web Crypto subtle.digest + compare
 * so timing attacks can't leak password length. Not critical at this
 * scale but also not expensive.
 */
export async function verifyPassword(submitted: string): Promise<boolean> {
  const expected = getPassword();
  if (!expected) return false;
  const a = await sha256(submitted);
  const b = await sha256(expected);
  return constantTimeEqual(a, b);
}

/**
 * Create a cookie value: `<issuedAt>.<hex-hmac>`. Verifier re-computes
 * the HMAC and rejects mismatches or too-old cookies.
 */
export async function signAdminCookie(): Promise<string> {
  const secret = getSecret();
  if (!secret) throw new Error('admin secret not configured');
  const issuedAt = Date.now().toString();
  const mac = await hmac(secret, issuedAt);
  return `${issuedAt}.${mac}`;
}

/**
 * Verify a cookie string. Returns true if signature matches AND the age
 * is within MAX_AGE_SECONDS.
 */
export async function verifyAdminCookie(cookie: string | undefined): Promise<boolean> {
  if (!cookie) return false;
  const secret = getSecret();
  if (!secret) return false;
  const parts = cookie.split('.');
  if (parts.length !== 2) return false;
  const [issuedAtStr, mac] = parts;
  const issuedAt = parseInt(issuedAtStr, 10);
  if (!Number.isFinite(issuedAt)) return false;
  const ageSec = (Date.now() - issuedAt) / 1000;
  if (ageSec < 0 || ageSec > MAX_AGE_SECONDS) return false;
  const expectedMac = await hmac(secret, issuedAtStr);
  return constantTimeEqual(hexToBytes(mac), hexToBytes(expectedMac));
}

/**
 * Shape the Set-Cookie header string for the admin cookie. `clear=true`
 * produces an immediately-expiring cookie for logout.
 */
export function adminCookieHeader(value: string, opts: { clear?: boolean } = {}): string {
  const maxAge = opts.clear ? 0 : MAX_AGE_SECONDS;
  // sameSite=Strict blocks the cookie on third-party navigation, so no
  // external site that embeds an iframe of /admin can act on behalf of
  // the admin. Secure is fine because Vercel prod is always HTTPS; local
  // dev runs over http://localhost and omits Secure via a runtime check
  // so the dev flow works without self-signed certs.
  // eslint-disable-next-line dot-notation
  const isProd = process.env['VERCEL'] === '1' || process.env['NODE_ENV'] === 'production';
  const secure = isProd ? 'Secure; ' : '';
  return `${COOKIE_NAME}=${opts.clear ? '' : value}; Path=/; HttpOnly; ${secure}SameSite=Strict; Max-Age=${maxAge}`;
}

// --- Crypto helpers -----------------------------------------------------

async function sha256(input: string): Promise<Uint8Array> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(digest);
}

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
  // Tolerate odd length by right-padding with 0; invalid hex chars parse to
  // NaN which constant-time compare will reject downstream.
  const padded = hex.length % 2 === 0 ? hex : hex + '0';
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Pure helpers for the user-badge avatar / display name (2026-05).
 *
 * No external service (no Gravatar) — everything derived from the
 * user's own data. When OAuth lands (S3) and we get real picture URLs
 * from Google / Microsoft, those will take precedence in the badge
 * render path; this file stays as the fallback.
 */

/**
 * Extract the local part of an email — `weih.xie@gmail.com` → `weih.xie`.
 * Returns the original string when there's no `@` (defensive for malformed
 * inputs).
 */
export function emailLocal(email: string): string {
  if (!email) return '';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

/**
 * Resolve the best human-readable name for the badge.
 * Priority: explicit displayName → email local part → '用户'.
 *
 * `displayName` is whitespace-trimmed; empty after trim falls through.
 */
export function displayNameOf(user: {
  displayName?: string;
  email: string;
}): string {
  const dn = user.displayName?.trim();
  if (dn) return dn;
  const local = emailLocal(user.email).trim();
  if (local) return local;
  return '用户';
}

/**
 * First letter of the display name, uppercased. Used as the avatar
 * fallback glyph (when no picture URL is available).
 */
export function avatarLetter(user: {
  displayName?: string;
  email: string;
}): string {
  const name = displayNameOf(user);
  return name.charAt(0).toUpperCase();
}

/**
 * Stable HSL colors for the avatar background. Same email always
 * produces the same hue → user recognizes "their" color across
 * sessions. Saturation/lightness fixed for visual consistency.
 *
 * Hash: FNV-1a 32-bit (cheap, no dep). Not for security, just bucketing.
 */
function fnv1aHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

export interface AvatarColors {
  /** Solid base color (used as fallback when gradients aren't supported). */
  bg: string;
  /** Linear gradient — slightly darker at the bottom-right for depth. */
  gradient: string;
  /** Foreground letter color — white or near-white tuned to bg lightness. */
  fg: string;
}

/**
 * Hue-only deterministic from email; saturation+lightness fixed for
 * visual consistency across all users. The 12% lightness drop on the
 * second gradient stop gives a subtle 3D feel without dropping into
 * "early-2000s skeuomorphism".
 */
export function avatarColors(email: string): AvatarColors {
  const hash = fnv1aHash(email || 'anon');
  const hue = hash % 360;
  const baseSat = 55;
  const baseLight = 52;
  const bg = `hsl(${hue}, ${baseSat}%, ${baseLight}%)`;
  const dark = `hsl(${hue}, ${baseSat}%, ${baseLight - 12}%)`;
  return {
    bg,
    gradient: `linear-gradient(135deg, ${bg}, ${dark})`,
    fg: '#ffffff',
  };
}

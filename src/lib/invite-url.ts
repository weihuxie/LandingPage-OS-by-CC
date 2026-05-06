/**
 * Invite link URL helpers (Phase S4 partial · 2026-05).
 *
 * Pure functions so the modal's "build the URL to copy" + "format
 * remaining time" branches are unit-testable without DOM.
 *
 * Per CLAUDE.md §S1: invite paths live at `/invite/[token]` outside
 * any locale prefix. middleware.ts has explicit pass-through for
 * `/invite/...` so this URL works as-is regardless of the user's
 * admin-UI locale.
 */

export function buildInviteUrl(token: string, origin: string | null): string {
  // origin null = SSR or test context; produce relative path. Caller
  // (the modal) passes window.location.origin in browser.
  if (!origin) return `/invite/${token}`;
  return `${origin}/invite/${token}`;
}

/**
 * Human-friendly "X 天后过期 / X 小时后过期 / 已过期" — for the invite
 * row's secondary line. Returns Chinese; localizing is Phase 2 of the
 * i18n rollout (most invite UIs stay zh-CN until product-side users
 * actually file a translation request).
 */
export function formatRemaining(expiresAt: number, now: number = Date.now()): string {
  const ms = expiresAt - now;
  if (ms <= 0) return '已过期';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days} 天后过期`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours} 小时后过期`;
  const minutes = Math.floor(ms / (60 * 1000));
  return `${minutes} 分钟后过期`;
}

/**
 * "X 分钟前 / X 小时前 / X 天前 / 刚刚" — for the "created at" timestamp.
 * Coarse buckets, no locale-specific formatting.
 */
export function formatRelative(at: number, now: number = Date.now()): string {
  const ms = now - at;
  if (ms < 60 * 1000) return '刚刚';
  const min = Math.floor(ms / (60 * 1000));
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

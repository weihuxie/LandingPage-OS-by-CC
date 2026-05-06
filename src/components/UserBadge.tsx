'use client';
/**
 * User dropdown — right half of the split-badge design (2026-05).
 *
 * Trigger: round avatar with email's first letter (GitHub-style).
 * Items:
 *   · Email (read-only display)
 *   · 界面语言 (radio: 简体中文 / 日本語 / English)
 *   · 退出登录
 *
 * Optimistic locale switch: PATCHes /api/auth/profile in parallel with
 * window.location.assign(/<newLocale>/...). Middleware reads the
 * lp_display_locale cookie that the PATCH bakes — so the new locale
 * sticks across reloads without waiting for the round-trip.
 */
import { useEffect, useRef, useState } from 'react';

type AdminLocale = 'zh-CN' | 'ja' | 'en';

interface Props {
  user: {
    id: string;
    email: string;
    displayName?: string;
    displayLocale?: AdminLocale;
  };
  /** Current URL locale prefix — used as fallback when user hasn't
   *  picked a displayLocale yet, AND for the post-logout returnTo. */
  locale: string;
}

const LOCALE_LABELS: Record<AdminLocale, string> = {
  'zh-CN': '简体中文',
  ja: '日本語',
  en: 'English',
};

/**
 * Strip the leading /<locale>/ prefix from a path so we can re-prefix
 * with a different locale. If the path doesn't start with the current
 * admin locale (e.g. /app, /login), returns it unchanged — middleware
 * passes those through unlocalized.
 */
function pathWithoutLocale(pathname: string, currentLocale: string): string {
  const prefix = `/${currentLocale}`;
  if (pathname === prefix) return '/';
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  return pathname;
}

/** Email's first non-whitespace letter, uppercased; '?' if no email. */
function avatarLetter(email: string): string {
  const trimmed = email.trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : '?';
}

export default function UserBadge({ user, locale }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  const activeLocale: AdminLocale =
    (user.displayLocale as AdminLocale | undefined) ?? (locale as AdminLocale);

  const onLocaleChange = async (next: AdminLocale): Promise<void> => {
    if (next === activeLocale) {
      setOpen(false);
      return;
    }
    try {
      await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayLocale: next }),
      });
    } catch {
      // Network failure — proceed with navigation anyway. Middleware
      // will fall back to defaultLocale on the next cold load if the
      // cookie didn't set, which the user can re-trigger easily.
    }
    const cur = window.location.pathname;
    const stripped = pathWithoutLocale(cur, locale);
    const target = stripped === '/' ? `/${next}` : `/${next}${stripped}`;
    window.location.assign(target + window.location.search + window.location.hash);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-100 text-xs font-medium text-ink-700 transition hover:bg-ink-200"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`用户菜单：${user.email}`}
        title={user.email}
        onClick={() => setOpen((v) => !v)}
      >
        {avatarLetter(user.email)}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-md border border-ink-200 bg-white py-1 shadow-lg"
        >
          <div className="px-3 py-2 text-[11px] text-ink-500">
            {user.email}
          </div>
          <div className="border-t border-ink-100" />
          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-ink-400">
            界面语言
          </div>
          {(['zh-CN', 'ja', 'en'] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={activeLocale === l}
              onClick={() => onLocaleChange(l)}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-ink-50 ${
                activeLocale === l ? 'text-ink-900 font-medium' : 'text-ink-700'
              }`}
            >
              <span>{LOCALE_LABELS[l]}</span>
              {activeLocale === l && <span aria-hidden className="text-emerald-600">✓</span>}
            </button>
          ))}
          <div className="px-3 pb-2 pt-0.5 text-[10px] text-ink-400">
            落地页 locale 独立 · 不受影响
          </div>
          <div className="border-t border-ink-100" />
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50"
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location.href = `/login?returnTo=/${locale}/dashboard`;
            }}
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}

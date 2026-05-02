/**
 * Tiny client-side identity pill for the global header.
 *
 * Reads /api/auth/session lazily after mount. When logged-out — renders
 * a "登录" link. When logged-in — renders the active tenant name and a
 * compact menu (switch tenant / 退出). Kept on the header (not on every
 * page) so users always see which workspace they're operating in,
 * regardless of which screen they're on.
 *
 * Why client-side rather than passed down from a server component:
 *   · Header is rendered by the locale layout which doesn't currently
 *     gate behind requireUser. We want this badge to render on the
 *     marketing /[locale] page too (so visitors see "登录") without
 *     dragging an auth check into every public route.
 *   · The session endpoint is cheap (one cookie verify + tenant SCAN).
 *     Loading lazily keeps the marketing page TTFB unaffected.
 */
'use client';

import { useEffect, useRef, useState } from 'react';

type AdminLocale = 'zh-CN' | 'ja' | 'en';

interface SessionView {
  user: {
    id: string;
    email: string;
    displayName?: string;
    displayLocale?: AdminLocale;
  } | null;
  tenants: Array<{ id: string; name: string; ownerId: string }>;
}

const LOCALE_LABELS: Record<AdminLocale, string> = {
  'zh-CN': '简体中文',
  ja: '日本語',
  en: 'English',
};

/**
 * Strip the leading /<locale>/ prefix from a path so we can re-prefix
 * with a different locale. If the path doesn't start with a known admin
 * locale (e.g. /app, /login), returns it unchanged — the redirect will
 * still work because middleware passes those through unlocalized.
 */
function pathWithoutLocale(pathname: string, currentLocale: string): string {
  const prefix = `/${currentLocale}`;
  if (pathname === prefix) return '/';
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  return pathname;
}

export default function HeaderAuthBadge({ locale }: { locale: string }) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SessionView | null) => {
        if (!cancelled) setSession(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Close menu on outside click — same pattern as ProductCard kebab.
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

  if (!session) return null; // pre-fetch — empty space avoids layout jank

  if (!session.user) {
    // Logged-out path. Send returnTo so post-login deposit lands at /app.
    return (
      <a href={`/login?returnTo=/${locale}/dashboard`} className="btn btn-ghost text-xs">
        登录
      </a>
    );
  }

  const activeTenant = session.tenants[0];

  if (!activeTenant) {
    // Logged-in but no workspace yet. Direct them to /app to create one.
    return (
      <a href="/app" className="btn btn-ghost text-xs">
        创建工作空间
      </a>
    );
  }

  // Active locale for the switcher: prefer the user's persisted choice,
  // fall back to the current URL locale (so the indicator matches what
  // the user is actually seeing pre-save).
  const activeLocale: AdminLocale =
    (session.user.displayLocale as AdminLocale | undefined) ??
    (locale as AdminLocale);

  const onLocaleChange = async (next: AdminLocale): Promise<void> => {
    if (next === activeLocale) {
      setOpen(false);
      return;
    }
    // Optimistic UX: navigate immediately; the PATCH happens in
    // parallel. If PATCH fails the user still sees the new locale
    // because middleware reads the cookie set by /api/auth/profile.
    // Worst case the cookie wasn't set → next cold load reverts.
    try {
      await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayLocale: next }),
      });
    } catch {
      // Network failure — proceed with navigation anyway. The user
      // ends up on the new locale URL even without the cookie; if
      // they reload from a no-prefix path later they may revert.
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
        className="btn btn-ghost text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="hidden sm:inline">🏢 {activeTenant.name}</span>
        <span className="sm:hidden">🏢</span>
        <span className="ml-1 text-ink-400">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-md border border-ink-200 bg-white py-1 shadow-lg"
        >
          <div className="px-3 py-2 text-[11px] text-ink-500">
            登录身份：{session.user.email}
          </div>
          <div className="border-t border-ink-100" />
          {/* Admin UI language switcher (2026-05). Disambiguated from
              page locale in the section header — users already think
              about page-level locale tabs in the editor, this is a
              separate concept. */}
          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-ink-400">
            管理界面语言
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
          <a href="/app" className="block px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50">
            切换 / 新建工作空间
          </a>
          <button
            type="button"
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

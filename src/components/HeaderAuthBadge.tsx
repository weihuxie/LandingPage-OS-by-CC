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

interface SessionView {
  user: { id: string; email: string; displayName?: string } | null;
  tenants: Array<{ id: string; name: string; ownerId: string }>;
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
          className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-ink-200 bg-white py-1 shadow-lg"
        >
          <div className="px-3 py-2 text-[11px] text-ink-500">
            登录身份：{session.user.email}
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

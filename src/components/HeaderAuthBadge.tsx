/**
 * Header identity wrapper — fetches session once + delegates to two
 * sub-dropdowns (TenantBadge + UserBadge).
 *
 * 2026-05-03 split rationale: the old combined dropdown mixed workspace
 * actions (switch / invite) with user prefs (language / logout) under
 * a single trigger labeled with the tenant name — confusing because
 * trigger ≠ content. Now:
 *
 *   [🏢 <tenant> ▾]  [⊕]
 *    └─ TenantBadge   └─ UserBadge (avatar with email's first letter)
 *
 * Logged-out / no-tenant fallbacks unchanged from the previous design.
 *
 * Why client-side rather than server props (per the original comment):
 *   · Header renders on the marketing /[locale] page too (so visitors
 *     see "登录") without dragging an auth check into every public route
 *   · /api/auth/session is cheap (one cookie verify + tenant SCAN)
 *   · Lazy fetch keeps marketing-page TTFB unaffected
 */
'use client';

import { useEffect, useState } from 'react';
import TenantBadge from './TenantBadge';
import UserBadge from './UserBadge';

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

export default function HeaderAuthBadge({ locale }: { locale: string }) {
  const [session, setSession] = useState<SessionView | null>(null);

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

  if (!session) return null; // pre-fetch — empty space avoids layout jank

  if (!session.user) {
    return (
      <a href={`/login?returnTo=/${locale}/dashboard`} className="btn btn-ghost text-xs">
        登录
      </a>
    );
  }

  // Active tenant — chain[0] heuristic, kept from the old design. When
  // S4 ships per-tenant routes the active tenant will come from the
  // lp_tenant cookie via /api/auth/session, but that's a server-side
  // change and beyond this commit's scope.
  const activeTenant = session.tenants[0];

  if (!activeTenant) {
    return (
      <a href="/app" className="btn btn-ghost text-xs">
        创建工作空间
      </a>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <TenantBadge user={session.user} tenant={activeTenant} />
      <UserBadge user={session.user} locale={locale} />
    </div>
  );
}

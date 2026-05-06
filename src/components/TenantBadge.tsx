'use client';
/**
 * Workspace dropdown — left half of the split-badge design (2026-05).
 *
 * Replaced the old combined HeaderAuthBadge dropdown which mixed
 * workspace + user prefs in one menu (user feedback: "迷惑").
 *
 * Trigger: 🏢 <tenant name> ▾
 * Items:
 *   · Tenant header (name + role)
 *   · Owner-only: 🔗 邀请同事 → opens InviteModal in-place
 *   · 🔄 切换 / 新建工作空间 → /app
 *
 * Member listing / kick / settings deferred to S4 full management page
 * (per user 拍板 2026-05-03 in invite-UI work).
 *
 * Session is fetched once by parent HeaderAuthBadge and passed down so
 * we don't hit /api/auth/session twice.
 */
import { useEffect, useRef, useState } from 'react';
import InviteModal from './InviteModal';

interface Tenant {
  id: string;
  name: string;
  ownerId: string;
}

interface Props {
  user: { id: string };
  tenant: Tenant;
}

export default function TenantBadge({ user, tenant }: Props) {
  const [open, setOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const isOwner = tenant.ownerId === user.id;

  // Close menu on outside click — same pattern as the old HeaderAuthBadge.
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

  return (
    <>
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          className="btn btn-ghost text-xs"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`工作空间菜单：${tenant.name}`}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="hidden sm:inline">🏢 {tenant.name}</span>
          <span className="sm:hidden" aria-hidden>
            🏢
          </span>
          <span className="ml-1 text-ink-400" aria-hidden>
            ▾
          </span>
        </button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-ink-200 bg-white py-1 shadow-lg"
          >
            {/* Header — current workspace + role */}
            <div className="px-3 py-2">
              <div className="truncate text-sm font-medium text-ink-900">{tenant.name}</div>
              <div className="text-[11px] text-ink-500">{isOwner ? '所有者' : '成员'}</div>
            </div>

            {/* Owner actions */}
            {isOwner && (
              <>
                <div className="border-t border-ink-100" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setInviteOpen(true);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-ink-700 hover:bg-ink-50"
                >
                  🔗 邀请同事
                </button>
              </>
            )}

            {/* Switch / create */}
            <div className="border-t border-ink-100" />
            <a
              href="/app"
              role="menuitem"
              className="block px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50"
            >
              🔄 切换 / 新建工作空间
            </a>
          </div>
        )}
      </div>

      {/* Invite modal lives outside the dropdown so it survives the
          dropdown closing on outside-click. The 'click → close menu →
          open modal' sequence above sets both states in one tick. */}
      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        tenantId={tenant.id}
        tenantName={tenant.name}
      />
    </>
  );
}

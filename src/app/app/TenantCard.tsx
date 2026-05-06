'use client';
/**
 * Tenant card with owner-only invite button (S4 partial · 2026-05).
 *
 * The card itself is a Link that navigates to the per-tenant workspace
 * route. The "邀请" button is rendered INSIDE the Link with explicit
 * stopPropagation + preventDefault so clicking it opens the modal
 * instead of navigating (CLAUDE.md §7.1.6 documents this exact pattern
 * — buttons inside Link covers must intercept events).
 *
 * Owner gating is computed server-side (page.tsx passes isOwner) so we
 * don't make a separate /api/auth/session call from this component.
 */
import Link from 'next/link';
import { useState } from 'react';
import InviteModal from '@/components/InviteModal';

interface Props {
  tenantId: string;
  tenantName: string;
  isOwner: boolean;
}

export default function TenantCard({ tenantId, tenantName, isOwner }: Props) {
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <li>
      <Link
        href={`/app/t/${tenantId}`}
        className="block rounded-lg border border-ink-200 bg-white px-4 py-3 hover:border-brand-500"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-medium">{tenantName}</div>
            <div className="text-xs text-ink-500">{isOwner ? '所有者' : '成员'}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isOwner && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setInviteOpen(true);
                }}
                className="rounded-md border border-ink-200 px-2.5 py-1 text-xs text-ink-700 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700"
                aria-label={`邀请同事加入 ${tenantName}`}
              >
                🔗 邀请
              </button>
            )}
            <span className="text-xs text-ink-400">编辑器在 S2 上线</span>
          </div>
        </div>
      </Link>
      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        tenantId={tenantId}
        tenantName={tenantName}
      />
    </li>
  );
}

'use client';

/**
 * Shared destructive-action button.
 *
 * Used by every UI entry point that needs to delete a Product or
 * LandingPage. Centralising it here means:
 *   - One confirmation style (native confirm() — matches the existing
 *     `deleteLocale` flow in Editor.tsx, so users don't see three
 *     different delete-confirmation conventions across the app).
 *   - One error surface (alert on non-2xx) — we refuse to silently
 *     pretend a delete succeeded when the server returned 500, because
 *     the whole app is fail-loud by policy (see CLAUDE.md §四).
 *   - One place to eventually upgrade to a nicer modal / undo toast.
 *
 * We deliberately stop propagation and prevent default because the most
 * common caller is a card that is itself wrapped in a <Link> cover —
 * a naive click would fire both the destructive action AND the
 * navigation, landing the user on a detail page for the thing they
 * just deleted.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface DeleteButtonProps {
  /** DELETE endpoint, e.g. `/api/products/p_xxx` or `/api/pages/pg_xxx`. */
  endpoint: string;
  /** First line of the confirm dialog, e.g. `删除产品「XX」？`. */
  confirmTitle: string;
  /** Optional body listing cascade effects so users can brace themselves. */
  confirmDetail?: string;
  /** If provided, navigate here on success. If omitted, router.refresh(). */
  onDeletedHref?: string;
  className?: string;
  children: React.ReactNode;
}

export default function DeleteButton({
  endpoint,
  confirmTitle,
  confirmDetail,
  onDeletedHref,
  className,
  children,
}: DeleteButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    // The button may be nested under a cover <Link> (e.g. dashboard
    // product card). Without both of these, a click would delete the
    // thing AND navigate into it.
    e.stopPropagation();
    e.preventDefault();

    const message = confirmDetail
      ? `${confirmTitle}\n\n${confirmDetail}\n\n此操作不可撤销。`
      : `${confirmTitle}\n\n此操作不可撤销。`;
    if (!window.confirm(message)) return;

    setBusy(true);
    try {
      const res = await fetch(endpoint, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(`删除失败：${body?.error ?? res.statusText}`);
        setBusy(false);
        return;
      }
      if (onDeletedHref) {
        router.push(onDeletedHref);
      } else {
        router.refresh();
      }
    } catch (err: any) {
      alert(`删除失败：${err?.message ?? err}`);
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={className}
    >
      {busy ? '删除中…' : children}
    </button>
  );
}

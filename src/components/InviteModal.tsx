'use client';
/**
 * Owner-only invite management modal (S4 partial · 2026-05).
 *
 * Backend (already shipped, see /api/tenants/[id]/invites/route.ts):
 *   POST   { role: 'editor' } → { invite }   create
 *   GET                       → { invites }  list (owner-only enforced server-side)
 *   PATCH .../[token] { disabled } → { invite }  disable
 *
 * Phase 1 scope (per user 2026-05-03 拍板):
 *   · Generate (always role=editor; owner promotion not exposed)
 *   · List, copy, disable
 *   · NO member listing / kick (deferred to S4 full management page)
 *   · NO transfer-owner (same)
 *
 * UX:
 *   · Backdrop click + ESC = close
 *   · Pure client-side cache; reload-on-open keeps sync simple
 */
import { useEffect, useState } from 'react';
import {
  buildInviteUrl,
  formatRelative,
  formatRemaining,
} from '@/lib/invite-url';
import type { Invite } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  tenantName: string;
}

export default function InviteModal({ open, onClose, tenantId, tenantName }: Props) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Re-fetch every time the modal opens — owner may have made changes
  // in another tab. Cheap (one KV SCAN), no need to optimize with a
  // shared store yet.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/tenants/${tenantId}/invites`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.message ?? `加载失败 (${r.status})`);
        return body as { invites: Invite[] };
      })
      .then((data) => {
        if (!cancelled) setInvites(data.invites ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tenantId]);

  // ESC closes — kept inline since this is the only modal in /app today.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'editor' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message ?? `生成失败 (${res.status})`);
      const newInvite = body.invite as Invite;
      setInvites((prev) => [newInvite, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDisable = async (token: string) => {
    setError(null);
    // Optimistic flip — rollback on failure so the row reverts visually.
    const prevSnap = invites;
    setInvites((prev) =>
      prev.map((inv) => (inv.token === token ? { ...inv, disabled: true } : inv)),
    );
    try {
      const res = await fetch(`/api/tenants/${tenantId}/invites/${token}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ disabled: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `停用失败 (${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '停用失败');
      setInvites(prevSnap); // rollback
    }
  };

  const handleCopy = async (token: string) => {
    const url = buildInviteUrl(token, window.location.origin);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      window.setTimeout(() => setCopiedToken((t) => (t === token ? null : t)), 2000);
    } catch {
      // Clipboard API may be unavailable in iframes / insecure contexts.
      // Fall back: tell the user to copy manually from the visible URL.
      setError('复制失败，请手动选中链接复制。');
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`邀请同事加入 ${tenantName}`}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <h2 className="truncate text-base font-semibold">
            邀请同事加入 <span className="text-brand-700">{tenantName}</span>
          </h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="-mr-1 rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-900"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          <p className="text-xs leading-relaxed text-ink-500">
            生成邀请链接后转发给同事。链接 <strong>14 天</strong>内有效，可被多人使用。
            被邀请人会成为<strong>编辑者</strong>。链接泄露时点"停用"即可作废。
          </p>

          <button
            onClick={handleCreate}
            disabled={creating}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
          >
            {creating ? '⟳ 生成中…' : '+ 生成邀请链接'}
          </button>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <h3 className="mb-2 text-xs font-medium text-ink-500">现有邀请链接</h3>
            {loading ? (
              <div className="text-xs text-ink-400">⟳ 加载中…</div>
            ) : invites.length === 0 ? (
              <div className="text-xs text-ink-400">
                暂无邀请链接。点击上方按钮生成第一个。
              </div>
            ) : (
              <ul className="space-y-2">
                {invites.map((inv) => {
                  const url = buildInviteUrl(
                    inv.token,
                    typeof window !== 'undefined' ? window.location.origin : null,
                  );
                  const expired = inv.expiresAt <= Date.now();
                  const disabled = !!inv.disabled || expired;
                  return (
                    <li
                      key={inv.token}
                      className={`rounded border p-2.5 text-xs ${
                        disabled
                          ? 'border-ink-100 bg-ink-50 opacity-60'
                          : 'border-ink-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[11px] text-ink-700">
                            {url}
                          </div>
                          <div className="mt-1 text-[10px] text-ink-400">
                            {inv.disabled
                              ? '🚫 已停用'
                              : expired
                                ? '⏰ 已过期'
                                : `${formatRemaining(inv.expiresAt)} · 创建于 ${formatRelative(inv.createdAt)}`}
                          </div>
                        </div>
                        {!disabled && (
                          <div className="flex shrink-0 gap-1">
                            <button
                              onClick={() => handleCopy(inv.token)}
                              className="rounded border border-ink-200 px-2 py-0.5 text-[11px] hover:bg-ink-100"
                            >
                              {copiedToken === inv.token ? '✓ 已复制' : '复制'}
                            </button>
                            <button
                              onClick={() => handleDisable(inv.token)}
                              className="rounded border border-red-200 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50"
                            >
                              停用
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-ink-100 px-5 py-3 text-[10px] text-ink-400">
          完整成员管理（看现有成员 / 移除成员）会在 S4 上线。
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';

export default function AcceptForm({
  token,
  tenantName,
}: {
  token: string;
  tenantName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
      });
      const body = (await resp.json().catch(() => null)) as { message?: string; tenantId?: string } | null;
      if (!resp.ok) {
        setError(body?.message ?? `加入失败（HTTP ${resp.status}）`);
        return;
      }
      // Hard navigate so server components re-fetch the new session
      // with the added tenant membership.
      window.location.href = '/app';
    } catch (err: any) {
      setError(err?.message ?? '网络错误，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-3">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={handleAccept}
        disabled={busy}
        className="btn btn-primary w-full disabled:opacity-50"
      >
        {busy ? '处理中…' : `加入 ${tenantName}`}
      </button>
      <a
        href="/"
        className="block w-full rounded-lg border border-ink-200 px-3 py-2 text-center text-sm text-ink-600 hover:bg-ink-50"
      >
        不加入，返回
      </a>
    </div>
  );
}

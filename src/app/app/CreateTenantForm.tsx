'use client';

import { useState } from 'react';

export default function CreateTenantForm() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = (await resp.json().catch(() => null)) as { message?: string; tenant?: { id: string } } | null;
      if (!resp.ok) {
        setError(body?.message ?? `创建失败（HTTP ${resp.status}）`);
        return;
      }
      // Hard reload so server components re-fetch tenant list.
      window.location.reload();
    } catch (err: any) {
      setError(err?.message ?? '网络错误，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="工作空间名称"
        maxLength={80}
        required
        className="flex-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="btn btn-primary disabled:opacity-50"
      >
        {busy ? '创建中…' : '创建'}
      </button>
      {error && (
        <div className="mt-2 w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
    </form>
  );
}

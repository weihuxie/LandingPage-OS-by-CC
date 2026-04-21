'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? `登录失败（HTTP ${resp.status}）`);
        return;
      }
      // Hard navigate so the new cookie is picked up by the next SSR.
      // `router.push` alone sometimes uses the cached route and would
      // briefly flash the login page again.
      window.location.href = next && next.startsWith('/admin/') ? next : '/admin/llm';
    } catch (err: any) {
      setError(err?.message ?? '网络错误，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-3">
      <label className="block text-sm">
        <span className="text-ink-700">密码</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus
          required
          className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </label>
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !password}
        className="btn btn-primary w-full disabled:opacity-50"
      >
        {busy ? '登录中…' : '登录'}
      </button>
    </form>
  );
}

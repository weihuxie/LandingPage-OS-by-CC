'use client';

import { useState } from 'react';

export default function LoginForm({ returnTo }: { returnTo?: string }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // In dev the server returns devLink; we show it as a one-click
  // shortcut. In prod this stays null — user checks email.
  const [devLink, setDevLink] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDevLink(null);
    setSent(false);
    try {
      const resp = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, returnTo }),
      });
      const body = (await resp.json().catch(() => null)) as
        | { ok?: boolean; devLink?: string; message?: string }
        | null;
      if (!resp.ok) {
        setError(body?.message ?? `发送失败（HTTP ${resp.status}）`);
        return;
      }
      setSent(true);
      if (body?.devLink) setDevLink(body.devLink);
    } catch (err: any) {
      setError(err?.message ?? '网络错误，请重试');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="mt-6 space-y-3">
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          登录链接已发送。请查收邮件（15 分钟内有效）。
        </div>
        {devLink && (
          <>
            <div className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
              Dev mode：邮件服务未配置，链接直接显示在这里。Summit 前接 Resend 后这块会消失。
            </div>
            <a
              href={devLink}
              className="btn btn-primary block text-center"
            >
              点这里登录（dev shortcut）
            </a>
          </>
        )}
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setDevLink(null);
          }}
          className="text-sm text-ink-500 hover:text-ink-700"
        >
          换个邮箱
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-3">
      <label className="block text-sm">
        <span className="text-ink-700">邮箱</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
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
        disabled={busy || !email}
        className="btn btn-primary w-full disabled:opacity-50"
      >
        {busy ? '发送中…' : '发送登录链接'}
      </button>
    </form>
  );
}

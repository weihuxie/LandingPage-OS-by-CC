'use client';

export default function AppHeader({ email }: { email: string }) {
  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <div className="text-sm font-semibold">LandingPage OS</div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-ink-500">{email}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-ink-200 px-3 py-1 text-xs text-ink-600 hover:bg-ink-50"
          >
            退出
          </button>
        </div>
      </div>
    </header>
  );
}

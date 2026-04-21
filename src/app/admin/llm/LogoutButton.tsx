'use client';

import { useState } from 'react';

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  async function handleClick() {
    setBusy(true);
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  }
  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="btn btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
    >
      {busy ? '…' : '退出登录'}
    </button>
  );
}

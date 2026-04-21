export default function SetupRequiredPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24">
      <h1 className="text-2xl font-semibold">需要先配置管理员密码</h1>
      <p className="mt-3 text-sm text-ink-700">
        这个部署还没设{' '}
        <code className="rounded bg-ink-100 px-1 text-ink-900">ADMIN_PASSWORD</code>
        ，所以管理台无法使用。
      </p>
      <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">在 Vercel 里加两个 env var 后 redeploy：</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            <code className="rounded bg-white px-1">ADMIN_PASSWORD</code> — 你要设的登录密码
          </li>
          <li>
            <code className="rounded bg-white px-1">ADMIN_COOKIE_SECRET</code> — 至少 16 位随机字符串（不配也行，会从密码派生）
          </li>
        </ol>
        <p className="mt-3 text-xs">
          路径：Vercel Dashboard → Project → Settings → Environment Variables → Add → Redeploy
        </p>
      </div>
    </div>
  );
}

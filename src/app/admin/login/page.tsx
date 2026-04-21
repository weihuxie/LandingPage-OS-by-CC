import LoginForm from './LoginForm';

// The setup-required page handles the "no ADMIN_PASSWORD configured"
// case; by the time we get here we know the env var is set (middleware
// already redirected otherwise), so the only remaining state is
// "password attempt".
export default function AdminLoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  return (
    <div className="mx-auto max-w-sm px-4 py-24">
      <h1 className="text-2xl font-semibold">管理员登录</h1>
      <p className="mt-2 text-sm text-ink-500">
        这里是 LandingPage OS 的后台管理面板。输入 Vercel 里配置的{' '}
        <code className="rounded bg-ink-100 px-1">ADMIN_PASSWORD</code> 进入。
      </p>
      <LoginForm next={searchParams.next} />
    </div>
  );
}

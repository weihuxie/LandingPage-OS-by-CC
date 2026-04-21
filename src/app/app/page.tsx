/**
 * /app — Post-login landing for product-side users.
 *
 * MINIMAL scope in S1:
 *   · Show current user's email + a logout button
 *   · List tenants the user belongs to (tenant switcher shape)
 *   · If no tenants: show "Create your first workspace" inline form
 *   · Click a tenant → /app/t/[tenantId]  (NOT wired yet — S2 builds
 *     the per-tenant workspace; for now the tenant card just shows
 *     the name and a "Workspace coming in S2" placeholder)
 *
 * This page is the simplest reasonable place for a logged-in user to
 * land after the magic-link flow. Deliberately boring — we'll add
 * editor / product / page entry points in S2 once per-tenant routes
 * have permission checks.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { USER_COOKIE, verifyUserCookie } from '@/lib/user-auth';
import { getUser, listTenantsForUser } from '@/lib/auth-storage';
import AppHeader from './AppHeader';
import CreateTenantForm from './CreateTenantForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AppPage() {
  const cookie = cookies().get(USER_COOKIE.NAME)?.value;
  const userId = await verifyUserCookie(cookie);
  if (!userId) redirect('/login?returnTo=/app');

  const user = await getUser(userId);
  if (!user) redirect('/login');

  const tenants = await listTenantsForUser(userId);

  return (
    <div className="min-h-screen bg-ink-50">
      <AppHeader email={user.email} />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-semibold">我的工作空间</h1>
        <p className="mt-1 text-sm text-ink-500">
          {tenants.length > 0
            ? `你属于 ${tenants.length} 个工作空间。点击进入（编辑器在 S2 上线）。`
            : '还没有加入任何工作空间 —— 创建第一个或请同事发一条邀请链接。'}
        </p>

        {tenants.length > 0 && (
          <ul className="mt-6 space-y-2">
            {tenants.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/app/t/${t.id}`}
                  className="block rounded-lg border border-ink-200 bg-white px-4 py-3 hover:border-brand-500"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-ink-500">
                        {t.ownerId === userId ? '所有者' : '成员'}
                      </div>
                    </div>
                    <span className="text-xs text-ink-400">编辑器在 S2 上线</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <section className="mt-12">
          <h2 className="text-lg font-semibold">创建新工作空间</h2>
          <p className="mt-1 text-sm text-ink-500">
            创建后你是所有者，可以生成邀请链接让同事加入。
          </p>
          <CreateTenantForm />
        </section>
      </main>
    </div>
  );
}

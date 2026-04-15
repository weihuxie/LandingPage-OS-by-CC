import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { readProjects } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function Dashboard({
  params: { locale },
}: {
  params: { locale: string };
}) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations();
  const projects = await readProjects();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('dashboard.title')}</h1>
        <Link href={`/${locale}/new`} className="btn btn-primary">
          + {t('dashboard.new')}
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="card mt-8 p-10 text-center text-ink-500">
          {t('dashboard.empty')}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div key={p.id} className="card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm text-ink-500">{p.inputs.category || ' '}</div>
                  <h3 className="mt-1 text-lg font-semibold">{p.inputs.name}</h3>
                </div>
                <span
                  className={`pill ${
                    p.published ? 'border-brand-200 bg-brand-50 text-brand-700' : ''
                  }`}
                >
                  {p.published ? t('dashboard.status.published') : t('dashboard.status.draft')}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-ink-500">{p.inputs.tagline}</p>
              <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
                <span className="pill">{t('dashboard.locale')}: {p.inputs.locale}</span>
                <span className="pill">{t('dashboard.market')}: {p.inputs.market}</span>
                <span className="pill">Leads: {p.leadCount ?? 0}</span>
              </div>
              <div className="mt-5 flex items-center justify-between">
                <div className="text-xs text-ink-500">
                  {t('dashboard.createdAt')} {new Date(p.createdAt).toLocaleDateString()}
                </div>
                <div className="flex gap-2">
                  {p.published && (
                    <Link
                      href={`/p/${p.slug}`}
                      className="btn btn-secondary px-3 py-1.5 text-xs"
                      target="_blank"
                    >
                      {t('dashboard.viewLive')}
                    </Link>
                  )}
                  <Link
                    href={`/${locale}/projects/${p.id}`}
                    className="btn btn-primary px-3 py-1.5 text-xs"
                  >
                    {t('dashboard.openEditor')}
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

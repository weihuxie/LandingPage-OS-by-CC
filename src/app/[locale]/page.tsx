import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export default async function HomePage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  const t = await getTranslations();
  return (
    <div className="gradient-hero">
      <section className="mx-auto max-w-7xl px-4 pb-16 pt-20 sm:px-6 sm:pt-28">
        <div className="mx-auto max-w-3xl text-center">
          <span className="pill">{t('meta.tagline')}</span>
          <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-6xl">
            {t('home.headline')}
          </h1>
          <p className="mt-5 text-lg text-ink-500 sm:text-xl">{t('home.sub')}</p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href={`/${locale}/new`} className="btn btn-primary px-5 py-3">
              {t('home.cta')} →
            </Link>
            <Link
              href={`/${locale}/dashboard`}
              className="btn btn-secondary px-5 py-3"
            >
              {t('home.viewProjects')}
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-4 sm:grid-cols-3">
          <FeatureCard
            title={t('home.feature1Title')}
            body={t('home.feature1Body')}
            icon="◉"
          />
          <FeatureCard
            title={t('home.feature2Title')}
            body={t('home.feature2Body')}
            icon="⟁"
          />
          <FeatureCard
            title={t('home.feature3Title')}
            body={t('home.feature3Body')}
            icon="✦"
          />
        </div>
      </section>
    </div>
  );
}

function FeatureCard({ title, body, icon }: { title: string; body: string; icon: string }) {
  return (
    <div className="card p-5">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-700">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-ink-500">{body}</p>
    </div>
  );
}

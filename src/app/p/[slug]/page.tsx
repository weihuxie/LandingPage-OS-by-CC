import { notFound } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import {
  getLandingPageBySlug,
  getProduct,
} from '@/lib/storage';
import { projectViewFromV2 } from '@/lib/migrate-v2';
import PageRenderer from '@/components/PageRenderer';
import TrackView from '@/components/TrackView';
import LanguageSwitcherPublic from '@/components/LanguageSwitcherPublic';
import HrefLangHead from '@/components/HrefLangHead';
import { detectLocale, PAGE_LOCALES } from '@/lib/i18n-detect';
import type { Metadata } from 'next';
import type { NarrativeVariant, PageLocale } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { lang?: string };
}): Promise<Metadata> {
  const page = await getLandingPageBySlug(params.slug);
  if (!page) return { title: 'Not found' };
  const product = await getProduct(page.productId);
  if (!product) return { title: 'Not found' };
  return {
    title: `${product.name} — ${product.tagline}`,
    description: product.value || product.tagline,
    openGraph: {
      title: product.name,
      description: product.tagline,
      locale: page.defaultLocale,
    },
  };
}

export default async function PublicPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { v?: string; lang?: string };
}) {
  const page = await getLandingPageBySlug(params.slug);
  if (!page) notFound();
  if (!page.published) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">This page is not published yet.</h1>
        <p className="mt-2 text-ink-500">The owner needs to click Publish in the editor.</p>
      </div>
    );
  }
  const product = await getProduct(page.productId);
  if (!product) notFound();

  const h = headers();
  const cookieJar = cookies();

  // Detect locale (PRD v5.1 Q3 / §2.1)
  const detect = detectLocale({
    urlLang: searchParams.lang ?? null,
    cookieLang: cookieJar.get('lp_lang')?.value ?? null,
    acceptLanguage: h.get('accept-language'),
    country: h.get('x-vercel-ip-country') ?? h.get('cf-ipcountry'),
    available: page.availableLocales,
    fallback: page.defaultLocale,
  });
  const locale: PageLocale = detect.locale;

  // A/B variant resolution
  let variant: NarrativeVariant = page.activeVariant;
  const forced = searchParams.v?.toUpperCase();
  if (forced === 'A' || forced === 'B') {
    variant = forced as NarrativeVariant;
  } else if (page.publishMode === 'ab-split') {
    const stored = cookieJar.get('lp_v')?.value?.toUpperCase();
    if (stored === 'A' || stored === 'B') variant = stored as NarrativeVariant;
    else variant = Math.random() < 0.5 ? 'A' : 'B';
  }

  // Module set for the resolved (locale, variant) pair — fall back to
  // defaultLocale if the chosen locale somehow isn't present.
  const byVariant = page.variants[variant] ?? page.variants.A;
  const modules = byVariant[locale] ?? byVariant[page.defaultLocale] ?? [];

  // Reuse the legacy Project shape for the renderer (keeps it untouched)
  const projectView = projectViewFromV2(page, product);
  projectView.modules = modules;
  projectView.inputs.locale = locale;
  projectView.activeVariant = variant;

  // Public origin for hreflang
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('host') ?? '';
  const origin = `${proto}://${host}`;

  const referrer = h.get('referer') ?? undefined;

  return (
    <div className="bg-white">
      <HrefLangHead
        slug={page.slug}
        defaultLocale={page.defaultLocale}
        available={page.availableLocales}
        origin={origin}
      />
      <TrackView
        slug={page.slug}
        variant={variant}
        locale={locale}
        referrer={referrer}
      />
      <PageRenderer
        project={projectView}
        device="desktop"
        interactive
        locale={locale}
        variant={variant}
        nav={page.nav}
      />
      <LanguageSwitcherPublic
        slug={page.slug}
        current={locale}
        available={page.availableLocales}
        allLocales={PAGE_LOCALES}
      />
    </div>
  );
}

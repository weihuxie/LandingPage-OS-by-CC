/**
 * Parallel-locale public renderer — P3 of the 2026-04 refactor.
 *
 * Matches URLs like `/p/marketing/ja`, where each (slug, locale) pair is an
 * independent sibling LandingPage row. Resolution walks the locale group
 * index set; missing siblings 404 rather than falling back to the primary
 * (so a typo in the URL is loud, not a silent locale coercion).
 *
 * Legacy (no-groupId) pages hit through this path still render — the
 * `getLandingPageBySlugLocale` helper returns the single row as-is when no
 * group exists. Those pages are kept addressable by `/p/[slug]/[locale]` so
 * hreflang / bookmarks keep working during the migration window; after
 * migration completes the parent `/p/[slug]` entry point will 307 new
 * visitors into the nested URL.
 */
import { notFound } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import {
  getLandingPageBySlugLocale,
  getProduct,
  getSiblings,
} from '@/lib/storage';
import { projectViewFromV2 } from '@/lib/migrate-v2';
import PageRenderer from '@/components/PageRenderer';
import TrackView from '@/components/TrackView';
import LanguageSwitcherPublic from '@/components/LanguageSwitcherPublic';
import HrefLangHead from '@/components/HrefLangHead';
import { PAGE_LOCALES } from '@/lib/i18n-detect';
import type { Metadata } from 'next';
import type { LandingPage, NarrativeVariant, PageLocale } from '@/lib/types';
import { PAGE_LOCALES as ALL_LOCALES } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isPageLocale(raw: string): raw is PageLocale {
  return (ALL_LOCALES as readonly string[]).includes(raw);
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string; locale: string };
}): Promise<Metadata> {
  if (!isPageLocale(params.locale)) return { title: 'Not found' };
  const page = await getLandingPageBySlugLocale(params.slug, params.locale);
  if (!page) return { title: 'Not found' };
  const product = await getProduct(page.productId);
  if (!product) return { title: 'Not found' };
  return {
    title: `${product.name} — ${product.tagline}`,
    description: product.value || product.tagline,
    openGraph: {
      title: product.name,
      description: product.tagline,
      locale: params.locale,
    },
  };
}

export default async function PublicLocalePage({
  params,
  searchParams,
}: {
  params: { slug: string; locale: string };
  searchParams: { v?: string };
}) {
  if (!isPageLocale(params.locale)) notFound();
  const locale: PageLocale = params.locale;

  const page = await getLandingPageBySlugLocale(params.slug, locale);
  if (!page) notFound();

  // Legacy rows returned by getLandingPageBySlugLocale don't have a
  // per-locale guard, so verify the locale is actually one the row serves.
  // For parallel siblings (locale === params.locale already) this is a no-op.
  const servesLocale = page.localeGroupId
    ? page.locale === locale
    : page.availableLocales.includes(locale);
  if (!servesLocale) notFound();

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

  // A/B variant resolution — same rules as the legacy route.
  let variant: NarrativeVariant = page.activeVariant;
  const forced = searchParams.v?.toUpperCase();
  if (forced === 'A' || forced === 'B') {
    variant = forced as NarrativeVariant;
  } else if (page.publishMode === 'ab-split') {
    const stored = cookieJar.get('lp_v')?.value?.toUpperCase();
    if (stored === 'A' || stored === 'B') variant = stored as NarrativeVariant;
    else variant = Math.random() < 0.5 ? 'A' : 'B';
  }

  // Parallel sibling owns exactly one locale in variants.{A|B}; legacy rows
  // still carry the multi-locale map. Either way fall back to defaultLocale.
  const byVariant = page.variants[variant] ?? page.variants.A;
  const modules = byVariant[locale] ?? byVariant[page.defaultLocale] ?? [];

  const projectView = projectViewFromV2(page, product);
  projectView.modules = modules;
  projectView.inputs.locale = locale;
  projectView.activeVariant = variant;

  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('host') ?? '';
  const origin = `${proto}://${host}`;

  // Resolve sibling set for hreflang + the public language switcher. Legacy
  // pages return a single-element list with themselves, so we fall back to
  // the row's own availableLocales in that case.
  const siblings = await getSiblings(page);
  const availableLocales: PageLocale[] = page.localeGroupId
    ? siblings
        .filter((s): s is LandingPage & { locale: PageLocale } => !!s.locale && s.published)
        .map((s) => s.locale)
    : page.availableLocales;

  const urlByLocale: Partial<Record<PageLocale, string>> = {};
  if (page.localeGroupId) {
    for (const s of siblings) {
      if (s.locale && s.published) {
        urlByLocale[s.locale] = `${origin}/p/${params.slug}/${s.locale}`;
      }
    }
  } else {
    for (const l of availableLocales) {
      urlByLocale[l] = `${origin}/p/${params.slug}/${l}`;
    }
  }

  const canonicalUrl = `${origin}/p/${params.slug}/${locale}`;
  const referrer = h.get('referer') ?? undefined;

  return (
    <div className="bg-white">
      <HrefLangHead
        urlsByLocale={urlByLocale}
        canonicalUrl={canonicalUrl}
        defaultLocale={page.defaultLocale}
      />
      <TrackView
        slug={params.slug}
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
        slug={params.slug}
        current={locale}
        available={availableLocales}
        allLocales={PAGE_LOCALES}
        urlByLocale={urlByLocale}
      />
    </div>
  );
}

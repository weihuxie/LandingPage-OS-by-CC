import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales } from '@/i18n';
import Link from 'next/link';
import LocaleHtml from '@/components/LocaleHtml';
import HeaderAuthBadge from '@/components/HeaderAuthBadge';
import LLMStatusFlash from '@/components/LLMStatusFlash';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  if (!locales.includes(locale as (typeof locales)[number])) notFound();
  // Tell next-intl the locale up-front so it doesn't reach for headers() and
  // force all pages into dynamic rendering (fails build prerender on Vercel).
  unstable_setRequestLocale(locale);
  const messages = await getMessages();
  const t = await getTranslations();

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <LocaleHtml locale={locale} />
      <header className="sticky top-0 z-40 border-b border-ink-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href={`/${locale}`} className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-white">
              ✺
            </span>
            <span className="flex items-baseline gap-1">
              <span>LandingPage OS</span>
              <span className="text-[11px] font-normal text-ink-500">by CC</span>
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href={`/${locale}/dashboard`}
              className="btn btn-ghost hidden sm:inline-flex"
            >
              我的产品
            </Link>
            <Link href={`/${locale}/assets`} className="btn btn-ghost hidden sm:inline-flex">
              品牌资产
            </Link>
            <Link href={`/${locale}/analytics`} className="btn btn-ghost hidden sm:inline-flex">
              增长看板
            </Link>
            <Link href={`/${locale}/new`} className="btn btn-primary">
              + 新建
            </Link>
            <HeaderAuthBadge locale={locale} />
          </nav>
        </div>
      </header>
      <main>{children}</main>
      {/* Floating "which LLM answered" toast — fed by dispatchLLMTrace()
          calls in the editor / wizard fetch handlers. */}
      <LLMStatusFlash />
    </NextIntlClientProvider>
  );
}

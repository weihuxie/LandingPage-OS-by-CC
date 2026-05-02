import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales } from '@/i18n';
import Link from 'next/link';
import LocaleHtml from '@/components/LocaleHtml';
import HeaderAuthBadge from '@/components/HeaderAuthBadge';
import LLMStatusFlash from '@/components/LLMStatusFlash';
import FeedbackButton from '@/components/FeedbackButton';

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
            {/* 反馈："dashboard 一个新建一个新建产品两个按钮让人困惑"。
                方案 C：dashboard 的"+ 新建产品"保持蓝色主 CTA（contextual
                primary），header 这个"+ 新建"降级为 btn-secondary 灰白
                次级动作——任何页面都能用作"快速创建"应急入口，但不再
                抢 dashboard 上"+ 新建产品"的蓝色 CTA 视觉权重。 */}
            <Link href={`/${locale}/new`} className="btn btn-secondary">
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
      {/* Bottom-right feedback button (2026-05). Hits a Feishu form
          with prefill query string carrying user.email / page URL /
          deploy commit / submit time. See FeedbackButton.tsx for the
          architecture rationale (form vs API direct write). */}
      <FeedbackButton
        deployedAt={process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? 'local'}
      />
    </NextIntlClientProvider>
  );
}

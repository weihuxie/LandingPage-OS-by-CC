import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';

// Admin UI is Chinese-only per PRD v5.1 §5.1.
// Generated landing pages still support 4 languages via project.inputs.locale.
export const locales = ['zh-CN'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'zh-CN';

// Page-level locales (for generated landing pages, not admin UI)
export const pageLocales = ['zh-CN', 'zh-TW', 'ja', 'en'] as const;
export type PageLocale = (typeof pageLocales)[number];

export default getRequestConfig(async ({ locale }) => {
  if (!locales.includes(locale as Locale)) notFound();
  return {
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});

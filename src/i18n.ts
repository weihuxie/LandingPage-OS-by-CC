import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';

// Admin UI locales — opened up to 3 per user request (2026-05).
// PRD v5.1 §5.1's original "Chinese-only" was reversed because product-side
// users span CN / JP / global markets. Traditional Chinese (zh-TW) is
// intentionally NOT included: maintenance cost (4th JSON to keep in sync,
// 简↔繁 conversion ambiguity in tech terminology) outweighed the benefit
// since Taiwan users can read 简体. Note: this is admin-UI locale only —
// the landing page locale (project.inputs.locale) still supports 4 langs
// independently. A user can pick `en` admin UI and still create a `zh-TW`
// landing page.
export const locales = ['zh-CN', 'ja', 'en'] as const;
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

import type { PageLocale } from './types';
import { PAGE_LOCALES } from './types';

export interface DetectContext {
  urlLang?: string | null;          // ?lang=ja
  cookieLang?: string | null;       // lp_lang
  acceptLanguage?: string | null;   // Accept-Language header
  country?: string | null;          // cf-ipcountry / x-vercel-ip-country
  available: PageLocale[];
  fallback: PageLocale;
}

/**
 * Detect the best locale for the visitor.
 * Priority (high → low): ?lang → cookie → Accept-Language → country → fallback.
 * Only returns a locale that is in `available` (generated). If none of the
 * candidates match, returns `fallback`.
 */
export function detectLocale(ctx: DetectContext): {
  locale: PageLocale;
  source: 'url' | 'cookie' | 'accept-language' | 'country' | 'fallback';
} {
  const has = (l: string | null | undefined) =>
    l && ctx.available.includes(l as PageLocale) ? (l as PageLocale) : null;

  // 1. URL param
  if (ctx.urlLang) {
    const m = has(ctx.urlLang);
    if (m) return { locale: m, source: 'url' };
  }

  // 2. Cookie
  const ck = has(ctx.cookieLang ?? undefined);
  if (ck) return { locale: ck, source: 'cookie' };

  // 3. Accept-Language
  if (ctx.acceptLanguage) {
    const prefs = parseAcceptLanguage(ctx.acceptLanguage);
    for (const pref of prefs) {
      const matched = bestMatch(pref, ctx.available);
      if (matched) return { locale: matched, source: 'accept-language' };
    }
  }

  // 4. Country (IP)
  if (ctx.country) {
    const c = countryToLocale(ctx.country);
    const m = has(c);
    if (m) return { locale: m, source: 'country' };
  }

  return { locale: ctx.fallback, source: 'fallback' };
}

function parseAcceptLanguage(h: string): string[] {
  // "zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7"
  return h
    .split(',')
    .map((part) => {
      const [tag, qStr] = part.trim().split(';');
      const q = qStr?.startsWith('q=') ? parseFloat(qStr.slice(2)) : 1.0;
      return { tag: tag.trim().toLowerCase(), q: isNaN(q) ? 0 : q };
    })
    .sort((a, b) => b.q - a.q)
    .map((x) => x.tag);
}

// Map individual language tag (e.g. 'zh-Hans', 'zh-cn', 'en-us') to one of ours.
function bestMatch(tag: string, available: PageLocale[]): PageLocale | null {
  const lower = tag.toLowerCase();
  // Exact
  for (const av of available) if (av.toLowerCase() === lower) return av;
  // Chinese variants
  if (lower === 'zh' || lower === 'zh-hans' || lower.startsWith('zh-cn') || lower.startsWith('zh-sg')) {
    if (available.includes('zh-CN' as PageLocale)) return 'zh-CN';
  }
  if (lower === 'zh-hant' || lower.startsWith('zh-tw') || lower.startsWith('zh-hk') || lower.startsWith('zh-mo')) {
    if (available.includes('zh-TW' as PageLocale)) return 'zh-TW';
  }
  // English variants
  if (lower.startsWith('en')) {
    if (available.includes('en' as PageLocale)) return 'en';
  }
  // Japanese
  if (lower.startsWith('ja')) {
    if (available.includes('ja' as PageLocale)) return 'ja';
  }
  return null;
}

export function countryToLocale(country: string): PageLocale {
  const c = country.toUpperCase();
  switch (c) {
    case 'JP':
      return 'ja';
    case 'TW':
    case 'HK':
    case 'MO':
      return 'zh-TW';
    case 'CN':
    case 'SG':
      return 'zh-CN';
    case 'US':
    case 'CA':
    case 'GB':
    case 'IE':
    case 'AU':
    case 'NZ':
    case 'IN':
    default:
      return 'en';
  }
}

export function nativeLabel(locale: PageLocale): string {
  switch (locale) {
    case 'ja':
      return '日本語';
    case 'zh-CN':
      return '简体中文';
    case 'zh-TW':
      return '繁體中文';
    case 'en':
    default:
      return 'English';
  }
}

export { PAGE_LOCALES };

import type { PageLocale } from '@/lib/types';

const hreflangMap: Record<PageLocale, string> = {
  ja: 'ja',
  en: 'en',
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
};

/**
 * Emit <link rel="alternate" hreflang="xx" href="..."> tags for SEO so
 * Google treats the multiple locale versions as equivalents. Also emits
 * canonical + x-default.
 *
 * Two call shapes:
 *   · Legacy (single-row multi-locale): pass `slug` + `available` +
 *     `defaultLocale`; URLs are built as `/p/{slug}?lang={locale}` and
 *     canonical points at `/p/{slug}`.
 *   · Parallel (one sibling per locale): pass `urlsByLocale` with explicit
 *     per-locale URLs (e.g. `/p/{slug}/ja`), plus `canonicalUrl`. Used by
 *     the `/p/[slug]/[locale]` render path when the parent page carries a
 *     `localeGroupId`.
 *
 * The two shapes are mutually exclusive — providing both is a bug.
 */
export type HrefLangHeadProps =
  | {
      slug: string;
      defaultLocale: PageLocale;
      available: PageLocale[];
      origin: string;
      urlsByLocale?: undefined;
      canonicalUrl?: undefined;
    }
  | {
      urlsByLocale: Partial<Record<PageLocale, string>>;
      canonicalUrl: string;
      defaultLocale: PageLocale;
      slug?: undefined;
      available?: undefined;
      origin?: undefined;
    };

export default function HrefLangHead(props: HrefLangHeadProps) {
  if (props.urlsByLocale) {
    const entries = Object.entries(props.urlsByLocale) as Array<[PageLocale, string]>;
    const xDefault =
      props.urlsByLocale[props.defaultLocale] ?? entries[0]?.[1] ?? props.canonicalUrl;
    return (
      <>
        <link rel="canonical" href={props.canonicalUrl} />
        <link rel="alternate" hrefLang="x-default" href={xDefault} />
        {entries.map(([l, url]) => (
          <link key={l} rel="alternate" hrefLang={hreflangMap[l]} href={url} />
        ))}
      </>
    );
  }
  const base = `${props.origin}/p/${props.slug}`;
  return (
    <>
      <link rel="canonical" href={base} />
      <link rel="alternate" hrefLang="x-default" href={base} />
      {props.available.map((l) => (
        <link
          key={l}
          rel="alternate"
          hrefLang={hreflangMap[l]}
          href={`${base}?lang=${l}`}
        />
      ))}
    </>
  );
}

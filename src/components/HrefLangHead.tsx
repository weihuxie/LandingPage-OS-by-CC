import type { PageLocale } from '@/lib/types';

const hreflangMap: Record<PageLocale, string> = {
  ja: 'ja',
  en: 'en',
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
};

/**
 * Emit <link rel="alternate" hreflang="xx" href="..."> tags for SEO
 * so Google treats the multiple locale versions as equivalents.
 * Also emits canonical + x-default.
 */
export default function HrefLangHead({
  slug,
  defaultLocale,
  available,
  origin,
}: {
  slug: string;
  defaultLocale: PageLocale;
  available: PageLocale[];
  origin: string;
}) {
  const base = `${origin}/p/${slug}`;
  return (
    <>
      <link rel="canonical" href={base} />
      <link rel="alternate" hrefLang="x-default" href={base} />
      {available.map((l) => (
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

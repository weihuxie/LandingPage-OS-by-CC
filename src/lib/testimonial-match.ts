import type {
  TestimonialAsset,
  PageLocale,
  MarketCode,
  TestimonialContent,
} from './types';

/**
 * Score a testimonial for how well it fits a (locale, market) pair.
 * Higher = better match. Surfaced in the Testimonial module's auto-select
 * at generation time, and also visible in the asset library filter.
 *
 *   +2.0  primaryLocale === target locale  (speaker said it natively)
 *   +0.5  has a translation for target locale (fallback)
 *   +1.0  preferredMarkets includes target market
 *   +0-1  tag match with strategy (future: wire strategy tags in)
 */
export function scoreTestimonial(
  t: TestimonialAsset,
  locale: PageLocale,
  market: MarketCode,
): number {
  let score = 0;
  if (t.primaryLocale === locale) score += 2.0;
  else if (t.localizedQuotes?.[locale]?.quote) score += 0.5;
  if (t.preferredMarkets?.includes(market)) score += 1.0;
  return score;
}

/**
 * Pick the text to display for a testimonial in a given locale.
 * Prefers the original if primaryLocale matches, else the translation,
 * else falls back to the original (with an "originalLocale" hint).
 */
export function pickTestimonialText(
  t: TestimonialAsset,
  locale: PageLocale,
): {
  quote: string;
  role: string;
  isTranslation: boolean;
  aiGenerated: boolean;
  originalLocale?: PageLocale;
} {
  if (!t.primaryLocale || t.primaryLocale === locale) {
    return { quote: t.quote, role: t.role, isTranslation: false, aiGenerated: false };
  }
  const loc = t.localizedQuotes?.[locale];
  if (loc?.quote) {
    return {
      quote: loc.quote,
      role: loc.role ?? t.role,
      isTranslation: true,
      aiGenerated: !!loc.aiGenerated,
      originalLocale: t.primaryLocale,
    };
  }
  return {
    quote: t.quote,
    role: t.role,
    isTranslation: false,
    aiGenerated: false,
    originalLocale: t.primaryLocale,
  };
}

/**
 * Given a pool of testimonials, rank and return the top N for (locale, market).
 */
export function pickTopTestimonials(
  pool: TestimonialAsset[],
  locale: PageLocale,
  market: MarketCode,
  n = 2,
): TestimonialAsset[] {
  return [...pool]
    .map((t) => ({ t, score: scoreTestimonial(t, locale, market) }))
    .sort((a, b) => b.score - a.score)
    .filter((x) => x.score > 0)
    .slice(0, n)
    .map((x) => x.t);
}

/**
 * Convert picked assets into module content items for the Testimonial module.
 */
export function testimonialsToModuleItems(
  assets: TestimonialAsset[],
  locale: PageLocale,
): TestimonialContent['items'] {
  return assets.map((t) => {
    const picked = pickTestimonialText(t, locale);
    return {
      quote: picked.quote,
      author: t.author,
      company: t.company,
    };
  });
}

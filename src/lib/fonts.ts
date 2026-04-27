/**
 * Web font registry · loaded via next/font/google for self-hosted woff2
 * + automatic <link rel="preload">. Each font here exposes a CSS
 * variable name that style stacks reference (see font-presets.ts).
 *
 * Why next/font over <link href="fonts.googleapis.com/...">:
 *   · Self-hosting eliminates the third-party FOIT during cold loads
 *   · Built-in subset selection trims woff2 size (Latin → 30KB,
 *     CJK is heavier but Google still serves only the needed Unicode
 *     ranges via @font-face unicode-range declarations)
 *   · No CLS — Next bakes in size-adjust fallbacks per font
 *   · Local woff2 = no extra DNS / TLS / cache miss on cold visit
 *
 * Subset note for CJK (Noto SC/TC/JP, Zen Kaku, Noto Serif SC):
 *   Google Fonts splits CJK into many @font-face blocks by Unicode
 *   range; the browser only fetches the ranges it actually renders.
 *   So a Latin-only LP with `font-family: 'Noto Sans SC'` declared
 *   doesn't actually download the SC bytes until a CJK glyph appears.
 */
import {
  Inter,
  Manrope,
  Lora,
  Noto_Sans_SC,
  Noto_Sans_TC,
  Noto_Sans_JP,
  Noto_Serif_SC,
  Zen_Kaku_Gothic_New,
} from 'next/font/google';

// ---------- Latin family ----------------------------------------------

export const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
});

export const manrope = Manrope({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-manrope',
});

export const lora = Lora({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-lora',
});

// ---------- CJK family -------------------------------------------------
// next/font auto-handles unicode-range splitting so most visitors only
// pull the ranges they actually render. Weight list kept short — heavy
// weights blow up CJK download size and we only need 400/500/700.

export const notoSansSC = Noto_Sans_SC({
  weight: ['400', '500', '700'],
  display: 'swap',
  preload: false, // CJK is too heavy to preload; lazy-fetch when an SC glyph appears
  variable: '--font-noto-sans-sc',
});

export const notoSansTC = Noto_Sans_TC({
  weight: ['400', '500', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-sans-tc',
});

export const notoSansJP = Noto_Sans_JP({
  weight: ['400', '500', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-sans-jp',
});

export const notoSerifSC = Noto_Serif_SC({
  weight: ['400', '600', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-serif-sc',
});

export const zenKakuGothicNew = Zen_Kaku_Gothic_New({
  weight: ['400', '500', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-zen-kaku-gothic-new',
  // Zen Kaku ships with subset declarations for Japanese, Latin, and the
  // common-symbol range so we don't need to specify subsets explicitly.
});

/**
 * Composite className pulling every font's CSS variable into the page.
 * Apply on <html> so all variables are visible everywhere — both the
 * SaaS app shell and the rendered /p/[slug] pages.
 *
 * The Tailwind `font-sans` class still provides the OS-native fallback
 * stack (see tailwind.config.ts). These vars are only consumed by
 * explicit fontStack declarations (PageRenderer + brand override).
 */
export const fontVariables = [
  inter.variable,
  manrope.variable,
  lora.variable,
  notoSansSC.variable,
  notoSansTC.variable,
  notoSansJP.variable,
  notoSerifSC.variable,
  zenKakuGothicNew.variable,
].join(' ');

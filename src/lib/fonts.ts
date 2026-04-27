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
  // Latin sans
  Inter,
  Manrope,
  Plus_Jakarta_Sans,
  DM_Sans,
  Space_Grotesk,
  // Latin serif / display
  Lora,
  Playfair_Display,
  // CJK SC
  Noto_Sans_SC,
  Noto_Serif_SC,
  ZCOOL_XiaoWei,
  ZCOOL_QingKe_HuangYou,
  Long_Cang,
  // CJK TC
  Noto_Sans_TC,
  Noto_Serif_TC,
  // CJK JP
  Noto_Sans_JP,
  Noto_Serif_JP,
  Zen_Kaku_Gothic_New,
  M_PLUS_1p,
  Shippori_Mincho,
  BIZ_UDPGothic,
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

export const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-plus-jakarta-sans',
});

export const dmSans = DM_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-dm-sans',
});

export const spaceGrotesk = Space_Grotesk({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-space-grotesk',
});

export const lora = Lora({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-lora',
});

export const playfairDisplay = Playfair_Display({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-playfair-display',
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

export const notoSerifSC = Noto_Serif_SC({
  weight: ['400', '600', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-serif-sc',
});

export const zcoolXiaoWei = ZCOOL_XiaoWei({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  preload: false,
  variable: '--font-zcool-xiaowei',
});

export const zcoolQingKeHuangYou = ZCOOL_QingKe_HuangYou({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  preload: false,
  variable: '--font-zcool-qingke-huangyou',
});

export const longCang = Long_Cang({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  preload: false,
  variable: '--font-long-cang',
});

export const notoSansTC = Noto_Sans_TC({
  weight: ['400', '500', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-sans-tc',
});

export const notoSerifTC = Noto_Serif_TC({
  weight: ['400', '600', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-serif-tc',
});

export const notoSansJP = Noto_Sans_JP({
  weight: ['400', '500', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-sans-jp',
});

export const notoSerifJP = Noto_Serif_JP({
  weight: ['400', '600', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-serif-jp',
});

export const zenKakuGothicNew = Zen_Kaku_Gothic_New({
  weight: ['400', '500', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-zen-kaku-gothic-new',
});

export const mPlus1p = M_PLUS_1p({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-m-plus-1p',
});

export const shipporiMincho = Shippori_Mincho({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-shippori-mincho',
});

export const bizUDPGothic = BIZ_UDPGothic({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-biz-udpgothic',
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
  // Latin sans
  inter.variable,
  manrope.variable,
  plusJakartaSans.variable,
  dmSans.variable,
  spaceGrotesk.variable,
  // Latin serif / display
  lora.variable,
  playfairDisplay.variable,
  // CJK SC
  notoSansSC.variable,
  notoSerifSC.variable,
  zcoolXiaoWei.variable,
  zcoolQingKeHuangYou.variable,
  longCang.variable,
  // CJK TC
  notoSansTC.variable,
  notoSerifTC.variable,
  // CJK JP
  notoSansJP.variable,
  notoSerifJP.variable,
  zenKakuGothicNew.variable,
  mPlus1p.variable,
  shipporiMincho.variable,
  bizUDPGothic.variable,
].join(' ');

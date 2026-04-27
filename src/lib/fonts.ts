/**
 * Web font registry · loaded via next/font/google for self-hosted woff2
 * + automatic <link rel="preload">. Each font here exposes a CSS
 * variable name that style stacks reference (see font-presets.ts).
 *
 * Why next/font over <link href="fonts.googleapis.com/...">:
 *   · Self-hosting eliminates the third-party FOIT during cold loads
 *   · Built-in subset selection trims woff2 size
 *   · No CLS — Next bakes in size-adjust fallbacks per font
 *   · Local woff2 = no extra DNS / TLS / cache miss on cold visit
 *
 * Subset note for CJK: Google Fonts splits CJK into many @font-face
 * blocks by Unicode range; the browser only fetches the ranges it
 * actually renders. So a Latin-only LP that declares `Noto Sans SC`
 * doesn't actually download the SC bytes until a CJK glyph appears.
 */
import {
  // Latin sans
  Inter,
  Manrope,
  Plus_Jakarta_Sans,
  DM_Sans,
  Space_Grotesk,
  // Latin serif / display
  Playfair_Display,
  // CJK SC
  Noto_Sans_SC,
  ZCOOL_XiaoWei,
  ZCOOL_QingKe_HuangYou,
  Long_Cang,
  // CJK TC
  Noto_Sans_TC,
  Noto_Serif_TC,
  // CJK JP
  Noto_Sans_JP,
  Zen_Kaku_Gothic_New,
  M_PLUS_1p,
  BIZ_UDPGothic,
  RocknRoll_One,
} from 'next/font/google';

// ---------- Latin sans -------------------------------------------------

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

// ---------- Latin serif / display -------------------------------------

export const playfairDisplay = Playfair_Display({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-playfair-display',
});

// ---------- CJK · 简体中文 --------------------------------------------

export const notoSansSC = Noto_Sans_SC({
  weight: ['400', '500', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-sans-sc',
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

// ---------- CJK · 繁體中文 --------------------------------------------

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

// ---------- CJK · 日本語 ----------------------------------------------

export const notoSansJP = Noto_Sans_JP({
  weight: ['400', '500', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-sans-jp',
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

export const bizUDPGothic = BIZ_UDPGothic({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-biz-udpgothic',
});

export const rocknRollOne = RocknRoll_One({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  preload: false,
  variable: '--font-rocknroll-one',
});

/**
 * Composite className that pulls every font's CSS variable into the
 * page. Apply on <html> so all variables are visible everywhere — both
 * the SaaS app shell and the rendered /p/[slug] pages.
 *
 * The Tailwind `font-sans` class still provides the OS-native fallback
 * stack (see tailwind.config.ts). These vars are only consumed by
 * explicit fontStack declarations (PageRenderer + brand override).
 */
export const fontVariables = [
  // Latin
  inter.variable,
  manrope.variable,
  plusJakartaSans.variable,
  dmSans.variable,
  spaceGrotesk.variable,
  playfairDisplay.variable,
  // CJK SC
  notoSansSC.variable,
  zcoolXiaoWei.variable,
  zcoolQingKeHuangYou.variable,
  longCang.variable,
  // CJK TC
  notoSansTC.variable,
  notoSerifTC.variable,
  // CJK JP
  notoSansJP.variable,
  zenKakuGothicNew.variable,
  mPlus1p.variable,
  bizUDPGothic.variable,
  rocknRollOne.variable,
].join(' ');

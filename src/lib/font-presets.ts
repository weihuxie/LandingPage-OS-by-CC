/**
 * Font presets · 4 locales × 6 curated fonts each.
 *
 * The picker shows 6 options based on the page's current editing locale
 * — Japanese pages see Japanese-friendly fonts, Chinese pages see
 * Chinese-friendly fonts, etc. Each preset's `fontStack` declares the
 * primary face first then cascades into cross-locale fallbacks so even
 * a SC-only display font (ZCOOL XiaoWei) renders correctly on the JP
 * tab via the trailing `Noto Sans JP / Noto Sans SC / sans-serif`
 * fallbacks the browser walks per Unicode range.
 *
 * Precedence (resolveFontStack below):
 *   1. LandingPage.fontPresetId      — user picked in editor
 *   2. Brand.fontStack (custom)      — global asset library override
 *   3. Product.theme.fontStack       — product-level override
 *   4. STYLE_PRESETS[styleId].fontStack  — market default style preset
 *
 * Adding a new preset:
 *   - Pick the locale tab it belongs in (zh-CN / zh-TW / ja / en)
 *   - Append to FONT_PRESETS_BY_LOCALE[locale]
 *   - Make sure the underlying fonts are registered in src/lib/fonts.ts
 *   - Choose a unique `id` (the picker writes only the id; the resolver
 *     looks up the registry)
 */
import type { LocaleCode, MarketCode } from './types';

export type FontPresetId = string;

export interface FontPreset {
  id: FontPresetId;
  /** Display label shown in picker tile */
  label: string;
  /** One-line description for tile hover/help */
  hint: string;
  /** CSS font-family value pasted into the page wrapper. Ordered:
   *  primary face → CJK fallback that complements the primary →
   *  ultimate system fallback. The browser walks left-to-right per
   *  Unicode range so cross-locale rendering stays sane even when the
   *  primary face only covers Latin or only one CJK script. */
  fontStack: string;
}

// Common Latin + CJK fallbacks composed into per-preset stacks.
const LATIN_TAIL = 'ui-sans-serif, system-ui, sans-serif';
const SERIF_TAIL = 'Georgia, "Iowan Old Style", serif';
const CJK_FALLBACK =
  'var(--font-noto-sans-sc), var(--font-noto-sans-tc), var(--font-noto-sans-jp)';

// 4 locales × 5 presets = 20 picks total (plus a "默认" tile in the UI
// = 6 visible per locale). Curated for B2B SaaS landing pages: each
// locale gets one "modern default", one "friendly", one "lively /
// playful", and a couple of locale-flavored alternatives. No "serious /
// editorial" — those killed the energy of LP first impressions when we
// shipped them, and we have zero use cases that needed them.
export const FONT_PRESETS_BY_LOCALE: Record<LocaleCode, FontPreset[]> = {
  // ---------- 简体中文 (5 picks) -------------------------------------
  'zh-CN': [
    {
      id: 'modern-cn',
      label: '现代默认',
      hint: 'Inter + Noto Sans SC · 通用 SaaS 现代风',
      fontStack: `var(--font-inter), var(--font-noto-sans-sc), ${CJK_FALLBACK}, ${LATIN_TAIL}`,
    },
    {
      id: 'friendly',
      label: '友好',
      hint: 'Manrope + Noto Sans SC · 圆润现代，更轻松',
      fontStack: `var(--font-manrope), var(--font-noto-sans-sc), ${CJK_FALLBACK}, ${LATIN_TAIL}`,
    },
    {
      id: 'cn-lively',
      label: '活泼',
      hint: 'ZCOOL QingKe HuangYou · 复古展示字，热情奔放',
      fontStack: `var(--font-inter), var(--font-zcool-qingke-huangyou), var(--font-noto-sans-sc), ${CJK_FALLBACK}, ${LATIN_TAIL}`,
    },
    {
      id: 'cn-zcool-xiaowei',
      label: '文艺',
      hint: 'ZCOOL XiaoWei · 中文编辑展示字',
      fontStack: `var(--font-inter), var(--font-zcool-xiaowei), var(--font-noto-sans-sc), ${CJK_FALLBACK}, ${LATIN_TAIL}`,
    },
    {
      id: 'cn-handwriting',
      label: '手写',
      hint: 'Long Cang · 手写感，品牌更有人情味',
      fontStack: `var(--font-inter), var(--font-long-cang), var(--font-noto-sans-sc), ${CJK_FALLBACK}, ${LATIN_TAIL}`,
    },
  ],

  // ---------- 繁體中文 (5 picks) -------------------------------------
  'zh-TW': [
    {
      id: 'modern-tw',
      label: '現代默認',
      hint: 'Inter + Noto Sans TC · 通用 SaaS 現代風',
      fontStack: `var(--font-inter), var(--font-noto-sans-tc), ${CJK_FALLBACK}, ${LATIN_TAIL}`,
    },
    {
      id: 'tw-friendly',
      label: '友好',
      hint: 'Manrope + Noto Sans TC · 圓潤現代',
      fontStack: `var(--font-manrope), var(--font-noto-sans-tc), ${CJK_FALLBACK}, ${LATIN_TAIL}`,
    },
    {
      id: 'tw-lively',
      label: '活潑',
      hint: 'Plus Jakarta Sans + Noto Sans TC · 跳動圓潤',
      fontStack: `var(--font-plus-jakarta-sans), var(--font-noto-sans-tc), ${CJK_FALLBACK}, ${LATIN_TAIL}`,
    },
    {
      id: 'tw-tech',
      label: '幾何',
      hint: 'Space Grotesk + Noto Sans TC · 科技感',
      fontStack: `var(--font-space-grotesk), var(--font-noto-sans-tc), ${CJK_FALLBACK}, ${LATIN_TAIL}`,
    },
    {
      id: 'tw-display-serif',
      label: '優雅展示',
      hint: 'Playfair Display + Noto Serif TC · 雜誌時尚展示',
      fontStack: `var(--font-playfair-display), var(--font-noto-serif-tc), ${SERIF_TAIL}`,
    },
  ],

  // ---------- 日本語 (5 picks) ---------------------------------------
  ja: [
    {
      id: 'clean-jp',
      label: '通用稳妥',
      hint: 'Inter + Noto Sans JP · 日企标准选择',
      fontStack: `var(--font-inter), var(--font-noto-sans-jp), ${CJK_FALLBACK}, ${LATIN_TAIL}`,
    },
    {
      id: 'startup-jp',
      label: '创业感',
      hint: 'Manrope + Zen Kaku Gothic New · 日本 startup 圈流行',
      fontStack: `var(--font-manrope), var(--font-zen-kaku-gothic-new), var(--font-noto-sans-jp), ${CJK_FALLBACK}, ${LATIN_TAIL}`,
    },
    {
      id: 'jp-friendly',
      label: '友好',
      hint: 'Manrope + M PLUS 1p · 圆润现代',
      fontStack: `var(--font-manrope), var(--font-m-plus-1p), var(--font-noto-sans-jp), ${CJK_FALLBACK}, ${LATIN_TAIL}`,
    },
    {
      id: 'jp-lively',
      label: '活泼',
      hint: 'Inter + RocknRoll One · 蹦跳手感，亲切活泼',
      fontStack: `var(--font-inter), var(--font-rocknroll-one), var(--font-noto-sans-jp), ${CJK_FALLBACK}, ${LATIN_TAIL}`,
    },
    {
      id: 'jp-ud',
      label: 'UD 通用',
      hint: 'Inter + BIZ UDPGothic · 无障碍高可读性',
      fontStack: `var(--font-inter), var(--font-biz-udpgothic), var(--font-noto-sans-jp), ${CJK_FALLBACK}, ${LATIN_TAIL}`,
    },
  ],

  // ---------- English (5 picks) -------------------------------------
  en: [
    {
      id: 'en-inter',
      label: 'Modern',
      hint: 'Inter · workhorse modern sans',
      fontStack: `var(--font-inter), ${LATIN_TAIL}`,
    },
    {
      id: 'en-manrope',
      label: 'Friendly',
      hint: 'Manrope · rounded, approachable',
      fontStack: `var(--font-manrope), ${LATIN_TAIL}`,
    },
    {
      id: 'en-lively',
      label: 'Lively',
      hint: 'DM Sans · geometric & friendly, energetic',
      fontStack: `var(--font-dm-sans), ${LATIN_TAIL}`,
    },
    {
      id: 'en-jakarta',
      label: 'Plus Jakarta',
      hint: 'Plus Jakarta Sans · modern alt',
      fontStack: `var(--font-plus-jakarta-sans), ${LATIN_TAIL}`,
    },
    {
      id: 'en-display',
      label: 'Display',
      hint: 'Playfair Display · serif glamour & headlines',
      fontStack: `var(--font-playfair-display), ${SERIF_TAIL}`,
    },
  ],
};

/**
 * Flat lookup index — maps any preset id to its FontPreset, regardless
 * of which locale tab it lives in. resolveFontStack() reads from here
 * because pages are page-scoped (one fontStack across all locales) and
 * the resolver doesn't care about which tab the user picked from.
 */
export const FONT_PRESET_INDEX: Record<string, FontPreset> = (() => {
  const idx: Record<string, FontPreset> = {};
  for (const presets of Object.values(FONT_PRESETS_BY_LOCALE)) {
    for (const p of presets) {
      if (idx[p.id]) {
        // Catch ID collisions at module load — a duplicated id would
        // make the picker tile show one preset but the resolver pick
        // the other.
        throw new Error(`FONT_PRESETS: duplicate id "${p.id}" across locales`);
      }
      idx[p.id] = p;
    }
  }
  return idx;
})();

/**
 * Pick a sensible default preset for a market. Returns the FIRST preset
 * for the locale most associated with the market — modern-cn for CN/
 * GLOBAL, modern-tw for TW, clean-jp for JP, en-inter for EU/US.
 */
export function defaultFontPresetForMarket(market: MarketCode): FontPresetId {
  switch (market) {
    case 'JP':
      return 'clean-jp';
    case 'TW':
      return 'modern-tw';
    case 'US':
    case 'EU':
      return 'en-inter'; // Modern preset id in en locale
    case 'CN':
    case 'GLOBAL':
    default:
      return 'modern-cn';
  }
}

/**
 * Resolve the actual `font-family` CSS string for a page. Honors the
 * precedence chain documented at the top of this file. Caller passes
 * each layer; the helper returns the first non-empty value, falling
 * through to the existing market-default style preset when none of the
 * overrides apply.
 *
 * Falls back to `null` when nothing is set so the caller can decide
 * whether to inject a font-family at all (PageRenderer keeps using its
 * existing default in that case).
 */
export function resolveFontStack(input: {
  pageFontPresetId?: FontPresetId | string | null;
  brandFontStack?: string | null;
  productFontStack?: string | null;
}): string | null {
  if (input.pageFontPresetId && FONT_PRESET_INDEX[input.pageFontPresetId]) {
    return FONT_PRESET_INDEX[input.pageFontPresetId].fontStack;
  }
  if (input.brandFontStack && input.brandFontStack.trim()) {
    return input.brandFontStack.trim();
  }
  if (input.productFontStack && input.productFontStack.trim()) {
    return input.productFontStack.trim();
  }
  return null;
}

/**
 * Return the 6 presets to show in the picker for a given locale. Used
 * by PageFontPicker to render its tile grid.
 */
export function presetsForLocale(locale: LocaleCode): FontPreset[] {
  return FONT_PRESETS_BY_LOCALE[locale] ?? FONT_PRESETS_BY_LOCALE['zh-CN'];
}

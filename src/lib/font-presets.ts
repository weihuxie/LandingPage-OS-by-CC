/**
 * Font presets · curated 6-pack covering CN / TW / JP / EN markets.
 *
 * Each preset is a Latin + CJK pairing because LP copy regularly mixes
 * scripts (English brand name, English CTA verbs, English company logos
 * in social proof, plus the locale's actual content). Pairing them
 * up-front avoids the common "headline looks great in Inter but social
 * proof logos in Noto SC look mismatched" failure mode.
 *
 * Precedence (resolveFontStack below):
 *   1. LandingPage.fontPresetId      — user picked in editor settings
 *   2. Brand.fontStack (custom)      — global asset library override
 *   3. Product.theme.fontStack       — product-level override
 *   4. STYLE_PRESETS[styleId].fontStack  — market default style preset
 *
 * Adding a new preset: pick a Latin + CJK pair, register here, and make
 * sure the underlying fonts are loaded in src/lib/fonts.ts. The
 * variableFallback chain is what gets injected into `font-family` —
 * order matters (browser walks left-to-right).
 */
import type { MarketCode } from './types';

export type FontPresetId =
  | 'modern-cn'
  | 'modern-tw'
  | 'clean-jp'
  | 'startup-jp'
  | 'friendly'
  | 'editorial';

export interface FontPreset {
  id: FontPresetId;
  /** UI label in zh-CN — appears in editor's font picker dropdown */
  label: string;
  /** One-line description for picker hover/help */
  hint: string;
  /** Markets this preset is most appropriate for. Used to pick the
   *  default for a freshly-created LandingPage. Order matters: the
   *  first market in the list is the "primary fit". */
  marketsFit: MarketCode[];
  /** CSS font-family value pasted into the page. Latin family first
   *  (browser uses it for ASCII), CJK family second (kicks in for the
   *  Unicode ranges Latin doesn't cover), then ultimate system
   *  fallback. */
  fontStack: string;
}

export const FONT_PRESETS: Record<FontPresetId, FontPreset> = {
  'modern-cn': {
    id: 'modern-cn',
    label: '现代 · 简中',
    hint: 'Inter + Noto Sans SC · 通用 SaaS 现代风',
    marketsFit: ['CN', 'GLOBAL'],
    fontStack:
      'var(--font-inter), var(--font-noto-sans-sc), ui-sans-serif, system-ui, sans-serif',
  },
  'modern-tw': {
    id: 'modern-tw',
    label: '现代 · 繁中',
    hint: 'Inter + Noto Sans TC · 同 modern-cn 但用于台/港',
    marketsFit: ['TW'],
    fontStack:
      'var(--font-inter), var(--font-noto-sans-tc), ui-sans-serif, system-ui, sans-serif',
  },
  'clean-jp': {
    id: 'clean-jp',
    label: '通用 · 日文',
    hint: 'Inter + Noto Sans JP · 日企稳妥首选',
    marketsFit: ['JP'],
    fontStack:
      'var(--font-inter), var(--font-noto-sans-jp), ui-sans-serif, system-ui, sans-serif',
  },
  'startup-jp': {
    id: 'startup-jp',
    label: '创业感 · 日文',
    hint: 'Manrope + Zen Kaku Gothic New · 日本 startup / 科技品牌',
    marketsFit: ['JP'],
    fontStack:
      'var(--font-manrope), var(--font-zen-kaku-gothic-new), ui-sans-serif, system-ui, sans-serif',
  },
  friendly: {
    id: 'friendly',
    label: '友好 · 简中',
    hint: 'Manrope + Noto Sans SC · 圆润现代，更轻松',
    marketsFit: ['CN', 'GLOBAL'],
    fontStack:
      'var(--font-manrope), var(--font-noto-sans-sc), ui-sans-serif, system-ui, sans-serif',
  },
  editorial: {
    id: 'editorial',
    label: '编辑严肃风',
    hint: 'Lora + Noto Serif SC · 衬线，咨询 / 媒体 / 高端 EU',
    marketsFit: ['EU', 'GLOBAL'],
    fontStack:
      'var(--font-lora), var(--font-noto-serif-sc), Georgia, "Iowan Old Style", serif',
  },
};

export const FONT_PRESET_IDS = Object.keys(FONT_PRESETS) as FontPresetId[];

/**
 * Pick a sensible default preset for a market. Currently maps each
 * market to its first-fit preset; if multiple presets list the same
 * market, the one declared earliest in FONT_PRESETS wins (object key
 * order is insertion order in modern JS).
 */
export function defaultFontPresetForMarket(market: MarketCode): FontPresetId {
  for (const p of Object.values(FONT_PRESETS)) {
    if (p.marketsFit[0] === market) return p.id;
  }
  // Fallback for any market not explicitly covered (e.g. US currently
  // has no preset that lists it as primary fit).
  return 'modern-cn';
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
  pageFontPresetId?: FontPresetId | null;
  brandFontStack?: string | null;
  productFontStack?: string | null;
}): string | null {
  if (input.pageFontPresetId && FONT_PRESETS[input.pageFontPresetId]) {
    return FONT_PRESETS[input.pageFontPresetId].fontStack;
  }
  if (input.brandFontStack && input.brandFontStack.trim()) {
    return input.brandFontStack.trim();
  }
  if (input.productFontStack && input.productFontStack.trim()) {
    return input.productFontStack.trim();
  }
  return null;
}

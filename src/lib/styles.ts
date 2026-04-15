import type { StylePreset, StyleId, MarketCode } from './types';

export const STYLE_PRESETS: Record<StyleId, StylePreset> = {
  'saas-modern': {
    id: 'saas-modern',
    name: 'SaaS 现代',
    nameEn: 'SaaS Modern',
    mood: '克制留白、柔和渐变、主色适度',
    marketsFit: ['CN', 'US', 'GLOBAL'],
    fontStack:
      '"Inter", "Noto Sans SC", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    headingWeight: 600,
    density: 'medium',
    accent: 'neutral',
    radius: 16,
    hero: 'gradient',
  },
  'minimal-trust': {
    id: 'minimal-trust',
    name: '极简信任（日式）',
    nameEn: 'Minimal Trust (JP)',
    mood: '低饱和、极细分割线、大量留白、Noto Sans JP',
    marketsFit: ['JP'],
    fontStack:
      '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif',
    headingWeight: 500,
    density: 'loose',
    accent: 'soft',
    radius: 4,
    hero: 'flat',
  },
  'enterprise-clean': {
    id: 'enterprise-clean',
    name: '企业稳健（繁中）',
    nameEn: 'Enterprise Clean (TW)',
    mood: '高对比、衬线小标、深色次标、合规感',
    marketsFit: ['TW', 'EU'],
    fontStack:
      '"Source Han Sans TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif',
    headingWeight: 700,
    density: 'medium',
    accent: 'neutral',
    radius: 8,
    hero: 'grid',
  },
  'bold-roi': {
    id: 'bold-roi',
    name: '高转化强 ROI（美式）',
    nameEn: 'Bold ROI (US)',
    mood: '大号标题、亮色块、数据加粗、CTA 前置',
    marketsFit: ['US'],
    fontStack:
      '"Inter", "Helvetica Neue", Arial, sans-serif',
    headingWeight: 800,
    density: 'tight',
    accent: 'bold',
    radius: 12,
    hero: 'gradient',
  },
  'editorial-serious': {
    id: 'editorial-serious',
    name: '编辑严肃风',
    nameEn: 'Editorial Serious',
    mood: '黑白为主、衬线标题、报刊分栏感',
    marketsFit: ['EU', 'GLOBAL'],
    fontStack:
      '"Source Serif 4", "Iowan Old Style", Georgia, "Noto Serif SC", serif',
    headingWeight: 600,
    density: 'loose',
    accent: 'neutral',
    radius: 0,
    hero: 'editorial',
  },
};

export function defaultStyleForMarket(market: MarketCode): StyleId {
  switch (market) {
    case 'JP':
      return 'minimal-trust';
    case 'TW':
      return 'enterprise-clean';
    case 'US':
      return 'bold-roi';
    case 'EU':
      return 'editorial-serious';
    case 'CN':
    case 'GLOBAL':
    default:
      return 'saas-modern';
  }
}

export function cssVarsForStyle(preset: StylePreset, primary: string): Record<string, string> {
  return {
    '--brand': primary,
    '--radius': `${preset.radius}px`,
    '--font-stack': preset.fontStack,
    '--heading-weight': String(preset.headingWeight),
    '--density-y':
      preset.density === 'loose' ? '5rem' : preset.density === 'tight' ? '2.5rem' : '3.5rem',
  };
}

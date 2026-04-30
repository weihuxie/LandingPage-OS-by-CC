/**
 * 页面顶部 nav 锚点裁剪逻辑（pure function）。
 *
 * 拆出来理由：
 * 1. PageRenderer.tsx 是 'use client' + JSX 文件，单元测从 Node 起 import
 *    会撞 JSX。这里是纯 ts 没 JSX，asset-shape.ts 同款模式。
 * 2. nav 有两个分支（用户显式 nav.items / 默认按白名单裁剪），分支边界
 *    很容易回归——单元测覆盖 vs 靠真实页面跑出来抓 bug，前者便宜得多。
 *
 * 设计：默认裁剪到 ≤ 5 个高价值锚点。socialProof / pain / faq / cta
 * 主动剔除（用户视觉浏览自然滚到，不需 nav 锚跳）。用户可通过
 * nav.items 显式指定覆盖默认。
 */
import type { PageLocale, PageModule } from './types';

export const NAV_LABELS: Record<PageLocale, Partial<Record<PageModule['type'], string>>> = {
  'zh-CN': {
    socialProof: '客户', pain: '痛点', solution: '方案', benefits: '价值',
    useCase: '场景', testimonial: '证言', faq: '常见问题', cta: '开始', form: '联系',
    productShowcase: '产品', videoEmbed: '演示',
  },
  'zh-TW': {
    socialProof: '客戶', pain: '痛點', solution: '方案', benefits: '價值',
    useCase: '場景', testimonial: '證言', faq: '常見問題', cta: '開始', form: '聯絡',
    productShowcase: '產品', videoEmbed: '示範',
  },
  'ja': {
    socialProof: '導入企業', pain: '課題', solution: 'ソリューション', benefits: '価値',
    useCase: '活用例', testimonial: 'お客様の声', faq: 'FAQ', cta: '開始', form: 'お問い合わせ',
    productShowcase: '製品', videoEmbed: 'デモ',
  },
  'en': {
    socialProof: 'Customers', pain: 'Problem', solution: 'Solution', benefits: 'Benefits',
    useCase: 'Use cases', testimonial: 'Testimonials', faq: 'FAQ', cta: 'Get started', form: 'Contact',
    productShowcase: 'Product', videoEmbed: 'Demo',
  },
};

/** 高价值 nav 锚点白名单 — 默认只这些进 nav。 */
export const NAV_AUTO_INCLUDE: ReadonlySet<PageModule['type']> = new Set([
  'solution',
  'benefits',
  'useCase',
  'testimonial',
  'productShowcase',
  'videoEmbed',
  'form',
]);

/** 默认 nav 项数硬上限。超出从前往后取，剔除尾部。 */
export const NAV_AUTO_MAX = 5;

export function resolveNavItems(
  modules: PageModule[],
  explicit: Array<{ moduleId: string; label: string }> | undefined,
  locale: PageLocale,
): Array<{ moduleId: string; label: string }> {
  if (explicit && explicit.length > 0) {
    // Filter to modules that still exist and are enabled.
    const ids = new Set(modules.map((m) => m.id));
    return explicit.filter((it) => ids.has(it.moduleId));
  }
  const labels = NAV_LABELS[locale] ?? NAV_LABELS['en'];
  return modules
    .filter((m) => m.type !== 'hero' && labels[m.type] && NAV_AUTO_INCLUDE.has(m.type))
    .slice(0, NAV_AUTO_MAX)
    .map((m) => ({ moduleId: m.id, label: labels[m.type]! }));
}

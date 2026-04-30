/**
 * API-NAV-RESOLVER-* · 顶部 nav 锚点裁剪逻辑（pure function）
 *
 * 覆盖：
 *  - 默认裁剪：超过 5 项时砍尾，剔除低价值类型
 *  - explicit 路径：用户自定义 nav.items 不被白名单过滤
 *  - locale 标签：4 个 locale 都有正确 label
 *
 * 纯函数测试 — 不依赖 KV / API key / DOM。
 */
import { test, expect } from '@playwright/test';
import {
  resolveNavItems,
  NAV_AUTO_INCLUDE,
  NAV_AUTO_MAX,
} from '../../src/lib/nav-resolver';
import type { PageModule, ModuleContent } from '../../src/lib/types';

function mod(type: PageModule['type'], idSuffix = ''): PageModule {
  return {
    id: `${type}${idSuffix}`,
    type,
    enabled: true,
    content: {} as ModuleContent,
  };
}

test.describe('API-NAV-RESOLVER · default cropping', () => {
  test('API-NAV-RESOLVER-001 · hero + socialProof + pain + faq + cta 全部被剔除', () => {
    const items = resolveNavItems(
      [mod('hero'), mod('socialProof'), mod('pain'), mod('faq'), mod('cta')],
      undefined,
      'zh-CN',
    );
    expect(items).toEqual([]);
  });

  test('API-NAV-RESOLVER-002 · 5 项以内全部保留', () => {
    const items = resolveNavItems(
      [mod('solution'), mod('benefits'), mod('useCase')],
      undefined,
      'zh-CN',
    );
    expect(items.map((i) => i.moduleId)).toEqual([
      'solution', 'benefits', 'useCase',
    ]);
    expect(items.map((i) => i.label)).toEqual(['方案', '价值', '场景']);
  });

  test('API-NAV-RESOLVER-003 · 超过 NAV_AUTO_MAX (5) 项时砍尾', () => {
    expect(NAV_AUTO_MAX).toBe(5);
    const items = resolveNavItems(
      [
        mod('solution'),
        mod('benefits'),
        mod('useCase'),
        mod('testimonial'),
        mod('productShowcase'),
        mod('videoEmbed'),  // 第 6 项 — 应被砍
        mod('form'),        // 第 7 项 — 应被砍
      ],
      undefined,
      'zh-CN',
    );
    expect(items).toHaveLength(5);
    expect(items.map((i) => i.moduleId)).not.toContain('videoEmbed');
    expect(items.map((i) => i.moduleId)).not.toContain('form');
  });

  test('API-NAV-RESOLVER-004 · 高低价值混排：低价值剔除后高价值正确填充', () => {
    // pain / faq / cta 应全被过滤掉
    const items = resolveNavItems(
      [
        mod('hero'),
        mod('socialProof'),
        mod('pain'),
        mod('solution'),
        mod('faq'),
        mod('benefits'),
        mod('cta'),
        mod('form'),
      ],
      undefined,
      'en',
    );
    expect(items.map((i) => i.moduleId)).toEqual(['solution', 'benefits', 'form']);
    expect(items.map((i) => i.label)).toEqual(['Solution', 'Benefits', 'Contact']);
  });

  test('API-NAV-RESOLVER-005 · NAV_AUTO_INCLUDE 严格白名单 — pain / socialProof 等明确不在', () => {
    expect(NAV_AUTO_INCLUDE.has('socialProof')).toBe(false);
    expect(NAV_AUTO_INCLUDE.has('pain')).toBe(false);
    expect(NAV_AUTO_INCLUDE.has('faq')).toBe(false);
    expect(NAV_AUTO_INCLUDE.has('cta')).toBe(false);
    expect(NAV_AUTO_INCLUDE.has('hero')).toBe(false);
    // 高价值 7 项都应在
    expect(NAV_AUTO_INCLUDE.has('solution')).toBe(true);
    expect(NAV_AUTO_INCLUDE.has('benefits')).toBe(true);
    expect(NAV_AUTO_INCLUDE.has('useCase')).toBe(true);
    expect(NAV_AUTO_INCLUDE.has('testimonial')).toBe(true);
    expect(NAV_AUTO_INCLUDE.has('productShowcase')).toBe(true);
    expect(NAV_AUTO_INCLUDE.has('videoEmbed')).toBe(true);
    expect(NAV_AUTO_INCLUDE.has('form')).toBe(true);
  });
});

test.describe('API-NAV-RESOLVER · explicit override', () => {
  test('API-NAV-RESOLVER-101 · explicit nav.items 不被白名单过滤', () => {
    // 用户显式指定了 socialProof + pain — 不应被默认白名单剔除
    const items = resolveNavItems(
      [mod('socialProof'), mod('pain'), mod('solution')],
      [
        { moduleId: 'socialProof', label: '客户案例' },
        { moduleId: 'pain', label: '为什么需要' },
      ],
      'zh-CN',
    );
    expect(items.map((i) => i.moduleId)).toEqual(['socialProof', 'pain']);
    expect(items.map((i) => i.label)).toEqual(['客户案例', '为什么需要']);
  });

  test('API-NAV-RESOLVER-102 · explicit 中的 moduleId 在 modules 里不存在 → 被过滤', () => {
    const items = resolveNavItems(
      [mod('solution'), mod('benefits')],
      [
        { moduleId: 'solution', label: 'X' },
        { moduleId: 'orphan-id', label: 'Y' }, // 模块已删
      ],
      'zh-CN',
    );
    expect(items.map((i) => i.moduleId)).toEqual(['solution']);
  });

  test('API-NAV-RESOLVER-103 · 空 explicit → 走默认白名单', () => {
    const items = resolveNavItems([mod('solution'), mod('benefits')], [], 'en');
    // 空数组应走 default 路径 (length === 0 不视为 explicit)
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.label)).toEqual(['Solution', 'Benefits']);
  });
});

test.describe('API-NAV-RESOLVER · locale labels', () => {
  test('API-NAV-RESOLVER-201 · 4 个 locale 各自给出正确 label', () => {
    const modules = [mod('solution'), mod('form')];
    const zhCN = resolveNavItems(modules, undefined, 'zh-CN');
    const zhTW = resolveNavItems(modules, undefined, 'zh-TW');
    const ja = resolveNavItems(modules, undefined, 'ja');
    const en = resolveNavItems(modules, undefined, 'en');

    expect(zhCN.map((i) => i.label)).toEqual(['方案', '联系']);
    expect(zhTW.map((i) => i.label)).toEqual(['方案', '聯絡']);
    expect(ja.map((i) => i.label)).toEqual(['ソリューション', 'お問い合わせ']);
    expect(en.map((i) => i.label)).toEqual(['Solution', 'Contact']);
  });
});

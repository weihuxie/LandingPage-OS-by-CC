/**
 * API-DIAG-* · page-diagnostics rule engine.
 *
 * 纯函数测试 — 不依赖 KV / API key / LLM。
 */
import { test, expect } from '@playwright/test';
import { findIssues } from '../../src/lib/page-diagnostics';
import type { PageModule, HeroContent, CTAContent, PainContent } from '../../src/lib/types';

function heroModule(overrides: Partial<HeroContent> = {}): PageModule {
  const content: HeroContent = {
    eyebrow: 'AI 行业 OS',
    headline: '给 AI 团队的合规底座',
    subhead: '上线第一周拿回 3.8 倍 ROI',
    primaryCta: '免费试用 30 天',
    bullets: ['卖点 A', '卖点 B', '卖点 C'],
    ...overrides,
  };
  return { id: 'm-hero', type: 'hero', enabled: true, content };
}

function ctaModule(overrides: Partial<CTAContent> = {}): PageModule {
  const content: CTAContent = {
    headline: '今天就开始',
    subhead: '30 秒上手',
    button: '免费创建第一页',
    ...overrides,
  };
  return { id: 'm-cta', type: 'cta', enabled: true, content };
}

function painModule(): PageModule {
  const content: PainContent = {
    title: '还在为这些事浪费时间吗？',
    subtitle: '每周都加班的根本原因',
    items: [
      { title: '审核慢', body: '人工查每一笔交易' },
      { title: '错漏多', body: '规则散在各表' },
      { title: '复盘难', body: '日志靠手动整理' },
    ],
  };
  return { id: 'm-pain', type: 'pain', enabled: true, content };
}

test.describe('API-DIAG · 诊断规则', () => {
  test('API-DIAG-001 · 健康页面：无 issue', () => {
    const modules = [heroModule(), painModule(), ctaModule()];
    const issues = findIssues(modules, 'zh-CN', '示例产品');
    // 可能命中 missing-social-proof（low），其他规则不应触发
    const high = issues.filter((i) => i.severity === 'high');
    expect(high.length).toBe(0);
  });

  test('API-DIAG-002 · subhead 缺数字 → 命中 hero-subhead-soft (med)', () => {
    const modules = [heroModule({ subhead: '让你的团队工作得更轻松' })];
    const issues = findIssues(modules, 'zh-CN', '示例产品');
    const hit = issues.find((i) => i.id === 'hero-subhead-soft');
    expect(hit).toBeTruthy();
    expect(hit?.severity).toBe('med');
    expect(hit?.action?.kind).toBe('select-module');
  });

  test('API-DIAG-003 · 弱 CTA 文案（zh-CN "了解更多"）→ 命中 hero-cta-weak', () => {
    const modules = [heroModule({ primaryCta: '了解更多' })];
    const issues = findIssues(modules, 'zh-CN', '示例产品');
    expect(issues.some((i) => i.id === 'hero-cta-weak')).toBe(true);
  });

  test('API-DIAG-004 · 弱 CTA 文案（en "Learn more"）→ 命中', () => {
    const modules = [heroModule({ primaryCta: 'Learn more' })];
    const issues = findIssues(modules, 'en', 'Example Co');
    expect(issues.some((i) => i.id === 'hero-cta-weak')).toBe(true);
  });

  test('API-DIAG-005 · CTA 模块 button 弱 → 命中 cta-module-weak', () => {
    const modules = [heroModule(), ctaModule({ button: '查看详情' })];
    const issues = findIssues(modules, 'zh-CN', '示例产品');
    expect(issues.some((i) => i.id === 'cta-module-weak')).toBe(true);
  });

  test('API-DIAG-006 · en locale 但 Hero 全是中文 → 命中 untranslated-en (high)', () => {
    const modules = [
      heroModule({
        headline: '给 AI 团队的合规底座',
        subhead: '上线第一周拿回 3.8 倍 ROI',
        bullets: ['本地化、合规、安全', '通过 SOC2 / GDPR'],
      }),
    ];
    const issues = findIssues(modules, 'en', '示例产品');
    const hit = issues.find((i) => i.id === 'untranslated-en');
    expect(hit).toBeTruthy();
    expect(hit?.severity).toBe('high');
    expect(hit?.action?.kind).toBe('relocalize');
  });

  test('API-DIAG-007 · ja locale 全是 Han 字符无 kana → 命中 untranslated-ja', () => {
    const modules = [
      heroModule({
        headline: '为 AI 团队打造的合规底座',
        subhead: '上线第一周拿回 3.8 倍回报率',
        bullets: ['本地化、合规、安全', '通过 SOC2 安全认证'],
      }),
    ];
    const issues = findIssues(modules, 'ja', '示例产品');
    expect(issues.some((i) => i.id === 'untranslated-ja')).toBe(true);
  });

  test('API-DIAG-008 · ja locale 含 kana → 不命中 untranslated', () => {
    const modules = [
      heroModule({
        headline: 'AI チームのためのコンプライアンス基盤',
        subhead: '公開週から 3.8 倍の ROI',
        bullets: ['ローカライズ済み', 'SOC2 / GDPR 準拠'],
        primaryCta: '無料トライアル',
      }),
    ];
    const issues = findIssues(modules, 'ja', '示例产品');
    expect(issues.some((i) => i.id.startsWith('untranslated-'))).toBe(false);
  });

  test('API-DIAG-009 · 空 bullets → 命中 hero-bullets-empty (low)', () => {
    const modules = [heroModule({ bullets: [] })];
    const issues = findIssues(modules, 'zh-CN', '示例产品');
    const hit = issues.find((i) => i.id === 'hero-bullets-empty');
    expect(hit).toBeTruthy();
    expect(hit?.severity).toBe('low');
  });

  test('API-DIAG-010 · 严重度排序：high → med → low', () => {
    const modules = [
      heroModule({
        primaryCta: '了解更多', // med
        bullets: [], // low
        // 制造 untranslated-en（high）
        headline: '给 AI 团队打造的合规底座',
        subhead: '上线第一周拿回 3.8 倍 ROI 回报',
      }),
    ];
    const issues = findIssues(modules, 'en', '示例产品');
    // 第一个一定是 high
    expect(issues[0]?.severity).toBe('high');
    // 验证整个序列单调不递减
    const ranks = issues.map((i) => (i.severity === 'high' ? 0 : i.severity === 'med' ? 1 : 2));
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    }
  });

  test('API-DIAG-011 · 空 modules → 空数组', () => {
    expect(findIssues([], 'zh-CN', '示例产品')).toEqual([]);
  });
});

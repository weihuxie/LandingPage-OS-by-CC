/**
 * API-FORBIDDEN-* · forbidden-phrase deterministic post-check (Wave 4 #K).
 *
 * The prompt asks Claude to avoid SaaS-generic boilerplate. Self-check
 * inside the prompt is athlete-refereeing-themselves (CLAUDE.md global
 * §5). This spec exercises the deterministic backstop:
 *   1. findForbiddenPhrases catches each forbidden pattern in text
 *   2. unless the user typed it themselves (silenced)
 *   3. integrated into page-diagnostics findIssues as a med-severity rule
 */
import { test, expect } from '@playwright/test';
import { findForbiddenPhrases, FORBIDDEN_DEFAULTS } from '../../src/lib/forbidden-phrases';
import { findIssues } from '../../src/lib/page-diagnostics';
import type { PageModule } from '../../src/lib/types';

test.describe('API-FORBIDDEN · pure-function detection (Wave 4 #K)', () => {
  test('API-FORBIDDEN-001 · "每周节省 11 小时" caught', () => {
    const hits = findForbiddenPhrases('我们帮你每周节省 11 小时手动操作');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].rule.id).toBe('hours-per-week');
  });

  test('API-FORBIDDEN-002 · "ROI calculator" caught (English)', () => {
    const hits = findForbiddenPhrases('Try our ROI calculator to see your savings');
    expect(hits.some((h) => h.rule.id === 'roi-calculator')).toBe(true);
  });

  test('API-FORBIDDEN-003 · "logo wall" + "trusted by industry leaders" both caught', () => {
    const hits = findForbiddenPhrases('Our logo wall is trusted by industry leaders');
    expect(hits.some((h) => h.rule.id === 'logo-wall')).toBe(true);
  });

  test('API-FORBIDDEN-004 · "3x faster" caught (productivity-boost)', () => {
    const hits = findForbiddenPhrases('Get answers 3x faster than ever');
    expect(hits.some((h) => h.rule.id === 'productivity-boost')).toBe(true);
  });

  test('API-FORBIDDEN-005 · "data-driven decisions" caught', () => {
    const hits = findForbiddenPhrases('Make data-driven decisions in real time');
    expect(hits.some((h) => h.rule.id === 'data-driven')).toBe(true);
  });

  test('API-FORBIDDEN-006 · clean prose has no false positives', () => {
    expect(findForbiddenPhrases('把销售周期从 90 天压到 30 天')).toEqual([]);
    expect(findForbiddenPhrases('帮你把客户服务质量稳定在 NPS 60 以上')).toEqual([]);
  });

  test('API-FORBIDDEN-007 · silenced when user input contains the phrase', () => {
    const hits = findForbiddenPhrases('Try our ROI calculator', {
      tagline: '内置 ROI calculator 帮 CFO 算账',
    });
    expect(hits).toEqual([]);
  });

  test('API-FORBIDDEN-008 · all rules have non-empty reason and id', () => {
    for (const rule of FORBIDDEN_DEFAULTS) {
      expect(rule.id.length, `rule id`).toBeGreaterThan(0);
      expect(rule.reason.length, `rule ${rule.id} reason`).toBeGreaterThan(0);
      expect(rule.pattern, `rule ${rule.id} pattern`).toBeInstanceOf(RegExp);
    }
  });
});

test.describe('API-FORBIDDEN · integrated into page-diagnostics findIssues', () => {
  test('API-FORBIDDEN-101 · forbidden phrase in hero subhead surfaces as Issue', () => {
    const modules: PageModule[] = [
      {
        id: 'h1',
        type: 'hero',
        enabled: true,
        content: {
          eyebrow: '',
          headline: 'Acme CRM',
          subhead: 'Boost productivity by 30% across the team',
          primaryCta: 'Demo',
          bullets: [],
        } as any,
      },
    ];
    const issues = findIssues(modules, 'en', 'Acme CRM');
    const hit = issues.find((i) => i.id.startsWith('forbidden-h1-subhead-productivity-boost'));
    expect(hit, `expected productivity-boost forbidden issue, got: ${issues.map((i) => i.id).join(',')}`).toBeTruthy();
    expect(hit!.severity).toBe('med');
  });

  test('API-FORBIDDEN-102 · silenced via productSurface unless-token', () => {
    const modules: PageModule[] = [
      {
        id: 'h1',
        type: 'hero',
        enabled: true,
        content: {
          eyebrow: '',
          headline: 'Acme',
          subhead: 'Has a built-in ROI calculator',
          primaryCta: 'Demo',
          bullets: [],
        } as any,
      },
    ];
    const issuesNoSurface = findIssues(modules, 'en', 'Acme');
    expect(issuesNoSurface.some((i) => i.id.includes('roi-calculator'))).toBe(true);

    const issuesWithSurface = findIssues(modules, 'en', 'Acme', {
      tagline: 'ROI calculator built into your CRM',
    });
    expect(issuesWithSurface.some((i) => i.id.includes('roi-calculator'))).toBe(false);
  });
});

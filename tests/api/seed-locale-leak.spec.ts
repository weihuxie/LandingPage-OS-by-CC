/**
 * API-SEED-LOCALE-* · seed-phase locale leak audit (Wave 1).
 *
 * The pre-LLM seed code in `ai.ts` historically had hard-coded Chinese
 * labels that leaked into non-Chinese pages. This spec is the regression
 * suite for those leaks — it boots `generateModules()` for each locale
 * and asserts the seeded socialProof.stats labels match the locale's
 * native script (no 简体 in 繁體, no Chinese in en/ja).
 *
 * Pure function — no KV / no LLM key / no DOM.
 */
import { test, expect } from '@playwright/test';
import { generateModules } from '../../src/lib/ai';
import type { ProductInputs, PageLocale, SocialProofContent } from '../../src/lib/types';

function inputsFor(locale: PageLocale): ProductInputs {
  return {
    name: 'Acme CRM',
    tagline: 'Sell more, faster',
    category: 'CRM',
    value: 'Cut sales cycle by 30%',
    cta: 'demo',
    market: 'GLOBAL',
    locale,
    industry: 'SaaS',
    companySize: 'mid',
    role: 'Sales',
    source: 'ads',
    pastedContent: '',
    referenceUrls: [],
    uploadedFileNames: [],
  };
}

function statsLabels(locale: PageLocale): string[] {
  const modules = generateModules(inputsFor(locale), 'saas');
  const sp = modules.find((m) => m.type === 'socialProof');
  if (!sp) throw new Error('socialProof module missing');
  const c = sp.content as SocialProofContent;
  return (c.stats ?? []).map((s) => s.label);
}

test.describe('API-SEED-LOCALE · socialProof.stats labels per locale', () => {
  test('API-SEED-LOCALE-001 · zh-CN gets 简体', () => {
    expect(statsLabels('zh-CN')).toEqual(['团队', '平均 ROI', '每周节省']);
  });

  test('API-SEED-LOCALE-002 · zh-TW gets 繁體 (was leaking 简体)', () => {
    // Regression: nested ternary used to fall through to '团队' / '每周节省'
    // for zh-TW because the default branch was zh-CN.
    expect(statsLabels('zh-TW')).toEqual(['團隊', '平均 ROI', '每週節省']);
  });

  test('API-SEED-LOCALE-003 · ja gets katakana / Japanese kanji', () => {
    expect(statsLabels('ja')).toEqual(['チーム', '平均 ROI', '週あたり削減時間']);
  });

  test('API-SEED-LOCALE-004 · en gets English (no CJK)', () => {
    const labels = statsLabels('en');
    expect(labels).toEqual(['Teams', 'Avg ROI', 'Time saved / wk']);
    // Stricter property: no Han ideographs in any en label.
    for (const l of labels) {
      expect(l).not.toMatch(/[一-鿿]/);
    }
  });
});

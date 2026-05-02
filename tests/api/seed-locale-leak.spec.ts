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
import { generateModules, generateVariants } from '../../src/lib/ai';
import type { ProductInputs, PageLocale, SocialProofContent } from '../../src/lib/types';
import type { ExtractedContext } from '../../src/lib/extract';

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

/**
 * Wave 1 #G — `inferLabelFromMetric` was sprayed Chinese into all locales,
 * mapped `$|¥ → 节省` (semantically wrong: ARR is not "saved"), and
 * defaulted to '' for unrecognized metrics.
 *
 * Drives the function via generateVariants(inputs, ..., context) which
 * sets context.metrics — the only call site of inferLabelFromMetric.
 */
function ctxWithMetrics(metrics: string[]): ExtractedContext {
  return {
    sourceKinds: [],
    namedCustomers: [],
    metrics,
    features: [],
    pains: [],
    personas: [],
    textLength: 0,
  };
}

function statsLabelsFromContext(locale: PageLocale, metrics: string[]): string[] {
  const variants = generateVariants(inputsFor(locale), 'saas', undefined, ctxWithMetrics(metrics));
  const sp = variants.A.find((m) => m.type === 'socialProof');
  if (!sp) throw new Error('socialProof module missing');
  const c = sp.content as SocialProofContent;
  return (c.stats ?? []).map((s) => s.label);
}

test.describe('API-SEED-LOCALE · inferLabelFromMetric per locale (Wave 1 #G)', () => {
  test('API-SEED-LOCALE-101 · en metrics get English labels (no Chinese leak)', () => {
    const labels = statsLabelsFromContext('en', ['3.8x ROI', '11 hours/week', '22%']);
    // Old behavior: ['ROI', '每周节省', '提升'] — Chinese into EN page.
    expect(labels).toEqual(['ROI', 'Time saved', 'Growth']);
    for (const l of labels) expect(l).not.toMatch(/[一-鿿]/);
  });

  test('API-SEED-LOCALE-102 · ja metrics get Japanese labels', () => {
    const labels = statsLabelsFromContext('ja', ['3.8x ROI', '11 hours/week', '22%']);
    expect(labels).toEqual(['ROI', '削減時間', '向上率']);
  });

  test('API-SEED-LOCALE-103 · zh-TW metrics get 繁體 (was leaking 简体)', () => {
    const labels = statsLabelsFromContext('zh-TW', ['11 hours/week', '500 customers']);
    // Old behavior leaked 简体 '客户' for zh-TW; now correctly 客戶
    expect(labels).toEqual(['節省時間', '客戶']);
  });

  test('API-SEED-LOCALE-104 · $-metric no longer wrongly labeled "saved"', () => {
    // $2.4M ARR is revenue, not "节省". Was: '节省' / '节省'.
    const en = statsLabelsFromContext('en', ['$2.4M ARR', '$50M valuation']);
    expect(en).toEqual(['Result', 'Result']); // neutral, not "saved"
    const cn = statsLabelsFromContext('zh-CN', ['$2.4M ARR', '$50M valuation']);
    expect(cn).toEqual(['业绩', '业绩']); // neutral, not "节省"
  });

  test('API-SEED-LOCALE-105 · unrecognized metric gets neutral label, not empty', () => {
    // Old default: '' — empty stats card looked broken.
    const en = statsLabelsFromContext('en', ['Series B', '47 NPS']);
    expect(en).toEqual(['Stat', 'Stat']);
    for (const l of en) expect(l.length).toBeGreaterThan(0);
  });
});

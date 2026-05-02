/**
 * API-JUDGE-VAL-* · judge output validator (Phase 1 + 2 of judge agent).
 *
 * The judge LLM emits suggestions via tool-use, schema-validated by
 * Anthropic / DeepSeek server-side. But shape-valid ≠ semantically
 * valid. The validator drops suggestions failing any of 5 hard
 * constraints — these tests cover each drop path + the happy path.
 */
import { test, expect } from '@playwright/test';
import {
  validateJudgeSuggestions,
  buildAssetPathSet,
} from '../../src/lib/judge-validators';
import type { ProductInputs, PageModule } from '../../src/lib/types';
import type { ExtractedContext } from '../../src/lib/extract';

const inputs: ProductInputs = {
  name: 'Pulse CRM',
  tagline: '把销售周期从 90 天压到 30 天',
  category: '销售自动化',
  value: '客户经理告别手工录入，每天省下 2 小时',
  cta: 'demo',
  market: 'CN',
  locale: 'zh-CN',
  industry: 'SaaS',
  companySize: 'mid',
  role: 'VP Sales',
  source: 'ads',
  pastedContent: '',
  referenceUrls: [],
  uploadedFileNames: [],
};

const context: ExtractedContext = {
  sourceKinds: ['paste'],
  namedCustomers: ['Acme Corp', 'Globex Industries'],
  metrics: ['3.8x ROI', '11 hours/week'],
  features: ['email integration'],
  pains: ['manual data entry takes hours'],
  personas: [],
  textLength: 100,
};

const modules: PageModule[] = [
  {
    id: 'h1',
    type: 'hero',
    enabled: true,
    content: {
      eyebrow: '',
      headline: 'Pulse CRM',
      subhead: '提升你团队的销售效率',
      primaryCta: '了解更多',
      bullets: ['更快的上线速度'],
    } as any,
  },
];

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ruleId: 'cta-specific',
    severity: 'high',
    moduleId: 'h1',
    fieldPath: 'primaryCta',
    reason: '"了解更多" 没有承诺',
    evidenceQuote: '了解更多',
    reusedAssets: ['product.tagline'],
    proposedReplacement: '预约 30 分钟演示',
    ...overrides,
  };
}

test.describe('API-JUDGE-VAL · buildAssetPathSet (Wave Judge Phase 1)', () => {
  test('API-JUDGE-VAL-001 · all input + context entries become asset paths', () => {
    const paths = buildAssetPathSet(inputs, context);
    expect(paths.has('product.name')).toBe(true);
    expect(paths.has('product.tagline')).toBe(true);
    expect(paths.has('product.value')).toBe(true);
    expect(paths.has('product.industry')).toBe(true);
    expect(paths.has('product.role')).toBe(true);
    expect(paths.has('extracted.namedCustomers[0]')).toBe(true);
    expect(paths.has('extracted.namedCustomers[1]')).toBe(true);
    expect(paths.has('extracted.metrics[0]')).toBe(true);
    expect(paths.has('extracted.features[0]')).toBe(true);
    expect(paths.has('extracted.pains[0]')).toBe(true);
  });

  test('API-JUDGE-VAL-002 · empty input → only product.* with values', () => {
    const minimal: ProductInputs = { ...inputs, tagline: '', category: '', value: '', industry: '', role: '' };
    const paths = buildAssetPathSet(minimal);
    expect(paths.has('product.name')).toBe(true);
    expect(paths.has('product.tagline')).toBe(false);
    expect(paths.has('product.industry')).toBe(false);
    expect(paths.size).toBeLessThanOrEqual(2); // name + maybe one more — strict bound
  });
});

test.describe('API-JUDGE-VAL · validateJudgeSuggestions happy path', () => {
  test('API-JUDGE-VAL-101 · well-formed suggestion is kept', () => {
    const r = validateJudgeSuggestions([base()], modules, inputs, context);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
    expect(r.kept[0].id).toMatch(/^js_cta-specific_h1_/);
    expect(r.kept[0].evidenceQuote).toBe('了解更多');
  });
});

test.describe('API-JUDGE-VAL · 5 hard-constraint drops', () => {
  test('API-JUDGE-VAL-201 · unknown ruleId dropped', () => {
    const r = validateJudgeSuggestions([base({ ruleId: 'invented-rule' })], modules, inputs, context);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/unknown ruleId/);
  });

  test('API-JUDGE-VAL-202 · moduleId not in input dropped', () => {
    const r = validateJudgeSuggestions([base({ moduleId: 'mod-does-not-exist' })], modules, inputs, context);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/moduleId not found/);
  });

  test('API-JUDGE-VAL-203 · empty evidenceQuote dropped', () => {
    const r = validateJudgeSuggestions([base({ evidenceQuote: '' })], modules, inputs, context);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/empty evidenceQuote/);
  });

  test('API-JUDGE-VAL-204 · evidenceQuote not appearing in any module text dropped (anti-fabrication)', () => {
    const r = validateJudgeSuggestions(
      [base({ evidenceQuote: '我们承诺月入百万' })], // not in modules
      modules,
      inputs,
      context,
    );
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/evidenceQuote not found/);
  });

  test('API-JUDGE-VAL-205 · evidenceQuote with whitespace/punct variation still matches (normalize)', () => {
    // Original module bullet: '更快的上线速度'. Judge writes with extra space.
    const r = validateJudgeSuggestions(
      [base({ evidenceQuote: ' 更快的 上线速度 ', moduleId: 'h1', fieldPath: 'bullets[0]' })],
      modules,
      inputs,
      context,
    );
    expect(r.kept).toHaveLength(1);
  });

  test('API-JUDGE-VAL-206 · empty proposedReplacement dropped', () => {
    const r = validateJudgeSuggestions([base({ proposedReplacement: '' })], modules, inputs, context);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/empty proposedReplacement/);
  });

  test('API-JUDGE-VAL-207 · proposedReplacement equal to quote dropped (no actual change)', () => {
    const r = validateJudgeSuggestions(
      [base({ proposedReplacement: '了解更多' })],
      modules,
      inputs,
      context,
    );
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/equals evidenceQuote/);
  });

  test('API-JUDGE-VAL-208 · empty reusedAssets dropped (the core anti-fabrication check)', () => {
    const r = validateJudgeSuggestions([base({ reusedAssets: [] })], modules, inputs, context);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/reusedAssets empty/);
  });

  test('API-JUDGE-VAL-209 · fabricated reusedAssets path dropped', () => {
    const r = validateJudgeSuggestions(
      [base({ reusedAssets: ['extracted.namedCustomers[99]'] })], // doesn't exist
      modules,
      inputs,
      context,
    );
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/non-existent paths/);
  });

  test('API-JUDGE-VAL-210 · partial fabrication (one real + one fake) still dropped', () => {
    const r = validateJudgeSuggestions(
      [base({ reusedAssets: ['product.tagline', 'extracted.metrics[42]'] })],
      modules,
      inputs,
      context,
    );
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0].reason).toMatch(/non-existent paths/);
  });
});

test.describe('API-JUDGE-VAL · multi-suggestion and stable ids', () => {
  test('API-JUDGE-VAL-301 · two valid + one invalid = 2 kept, 1 dropped', () => {
    const r = validateJudgeSuggestions(
      [
        base(),
        base({ ruleId: 'hero-anchors-number', evidenceQuote: '提升你团队的销售效率', proposedReplacement: '把销售周期从 90 天压到 30 天', reusedAssets: ['product.tagline'] }),
        base({ reusedAssets: [] }), // invalid
      ],
      modules,
      inputs,
      context,
    );
    expect(r.kept).toHaveLength(2);
    expect(r.dropped).toHaveLength(1);
  });

  test('API-JUDGE-VAL-302 · ids include ruleId and moduleId for traceability', () => {
    const r = validateJudgeSuggestions([base()], modules, inputs, context);
    expect(r.kept[0].id).toContain('cta-specific');
    expect(r.kept[0].id).toContain('h1');
  });
});

/**
 * EVAL-GOLDEN-* · property-based regression for the LLM gen pipeline (Wave 4 ★).
 *
 * Why this exists: prompt tweaks and model upgrades change behaviour
 * subtly. Per CLAUDE.md §5.4 the hardest failures hide where there's no
 * ground truth — relying on vibe-checks regresses silently. This spec
 * pins down PROPERTIES that any valid hydrate output must satisfy:
 *
 *   1. Hero headline contains a digit OR a product-specific token
 *   2. Hero A and B differ on at least one of {eyebrow, headline}
 *   3. Benefits has 3-5 items; no two items have identical title
 *   4. Locale matches script (no Han in en, kana in ja, ...)
 *   5. No flagged template fingerprint after hydrate
 *
 * Properties are pure rules — NOT LLM-as-judge. The LLM only generates;
 * the rule engine grades. Athlete-referee separation is preserved (per
 * CLAUDE.md §5).
 *
 * Cost: 1 profile × 6 hydrate calls + 1 strategy call = ~7 LLM calls per
 * full run. Skipped without ANTHROPIC_API_KEY so CI without quota
 * stays free. Add more profiles by appending to PROFILES below — each
 * adds ~$0.01 in Claude Opus cached costs.
 *
 * Mode: real LLM call, no fixtures. Future enhancement: cache the
 * hydrate output and re-run rules against the cache for cost-free CI.
 */
import { test, expect } from '@playwright/test';
import { generateStrategy, hydrateModulesViaClaude, generateVariants } from '../../src/lib/ai';
import type { ProductInputs, PageModule, HeroContent, BenefitsContent } from '../../src/lib/types';
import { findTemplateModules } from '../../src/lib/template-detection';

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY || !!process.env.DEEPSEEK_API_KEY;

interface GoldenProfile {
  id: string;
  description: string;
  inputs: ProductInputs;
}

const PROFILES: GoldenProfile[] = [
  {
    id: 'zh-CN-saas-crm',
    description: 'Chinese-language B2B SaaS CRM with concrete value prop',
    inputs: {
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
    },
  },
];

// --- Property assertions (deterministic, no LLM) -------------------------

function heroHasNumberOrProductToken(hero: HeroContent, productName: string): boolean {
  const headline = hero.headline ?? '';
  const hasDigit = /\d/.test(headline);
  const hasProductToken = headline.includes(productName);
  return hasDigit || hasProductToken;
}

function variantsDifferInHero(a: HeroContent, b: HeroContent): boolean {
  return a.eyebrow !== b.eyebrow || a.headline !== b.headline;
}

function benefitsItemsAreDistinct(benefits: BenefitsContent): boolean {
  const titles = (benefits.items ?? []).map((it) => it.title?.trim() ?? '');
  return new Set(titles).size === titles.length;
}

function localeScriptMatches(text: string, locale: string): boolean {
  if (text.length < 8) return true; // too short to assess
  const total = text.length;
  let han = 0;
  let kana = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x4e00 && cp <= 0x9fff) han++;
    else if (cp >= 0x3040 && cp <= 0x30ff) kana++;
  }
  if (locale === 'en') return han / total < 0.05; // mostly latin
  // ja MUST have kana — all-han is Chinese, not Japanese.
  if (locale === 'ja') return kana / total > 0.05;
  if (locale === 'zh-CN' || locale === 'zh-TW') return han / total > 0.3;
  return true;
}

// --- Test cases -----------------------------------------------------------

for (const profile of PROFILES) {
  test.describe(`EVAL-GOLDEN · ${profile.id}`, () => {
    test(`EVAL-GOLDEN-${profile.id} · [需 KEY] hydrate satisfies property suite`, async () => {
      test.skip(!HAS_KEY, 'requires ANTHROPIC_API_KEY or DEEPSEEK_API_KEY');
      test.setTimeout(120_000);

      // 1. Strategy
      const strategy = await generateStrategy(profile.inputs);
      expect(strategy.audience.length).toBeGreaterThan(0);
      expect(strategy.goal.length).toBeGreaterThan(0);

      // 2. Variants seed (no LLM)
      const variants = generateVariants(profile.inputs, 'saas', strategy);

      // 3. Hydrate
      const hydrated = await hydrateModulesViaClaude(
        variants,
        profile.inputs,
        strategy,
        'saas',
        profile.inputs.locale,
      );

      // 4. Property: no template fingerprints survive
      const templatesA = findTemplateModules(hydrated.A, profile.inputs.name);
      const templatesB = findTemplateModules(hydrated.B, profile.inputs.name);
      expect(
        templatesA.length,
        `variant A still matches template fingerprint: ${templatesA.map((r) => r.type).join(',')}`,
      ).toBe(0);
      expect(
        templatesB.length,
        `variant B still matches template fingerprint: ${templatesB.map((r) => r.type).join(',')}`,
      ).toBe(0);

      // 5. Property: hero variants differ
      const heroA = hydrated.A.find((m: PageModule) => m.type === 'hero')!.content as HeroContent;
      const heroB = hydrated.B.find((m: PageModule) => m.type === 'hero')!.content as HeroContent;
      expect(
        variantsDifferInHero(heroA, heroB),
        `hero A == B in eyebrow & headline: A.eyebrow=${heroA.eyebrow}, B.eyebrow=${heroB.eyebrow}`,
      ).toBe(true);

      // 6. Property: hero anchors a number or product name
      expect(
        heroHasNumberOrProductToken(heroA, profile.inputs.name),
        `hero A headline lacks digit and product name: ${heroA.headline}`,
      ).toBe(true);
      expect(
        heroHasNumberOrProductToken(heroB, profile.inputs.name),
        `hero B headline lacks digit and product name: ${heroB.headline}`,
      ).toBe(true);

      // 7. Property: benefits 3-5 items, distinct titles
      const benefitsA = hydrated.A.find((m: PageModule) => m.type === 'benefits')?.content as
        | BenefitsContent
        | undefined;
      if (benefitsA) {
        expect(benefitsA.items.length).toBeGreaterThanOrEqual(3);
        expect(benefitsA.items.length).toBeLessThanOrEqual(5);
        expect(
          benefitsItemsAreDistinct(benefitsA),
          `benefits A has duplicate item titles`,
        ).toBe(true);
      }

      // 8. Property: hero copy matches locale script
      expect(
        localeScriptMatches(heroA.headline ?? '', profile.inputs.locale),
        `hero A headline doesn't match ${profile.inputs.locale} script: ${heroA.headline}`,
      ).toBe(true);
      expect(
        localeScriptMatches(heroB.headline ?? '', profile.inputs.locale),
        `hero B headline doesn't match ${profile.inputs.locale} script: ${heroB.headline}`,
      ).toBe(true);
    });
  });
}

// --- Pure-function regression (always runs, no key needed) ---------------

test.describe('EVAL-GOLDEN · property predicates self-test', () => {
  test('EVAL-GOLDEN-PRED-001 · heroHasNumberOrProductToken catches digit + token', () => {
    expect(heroHasNumberOrProductToken({ headline: '把销售周期从 90 天压到 30 天' } as any, 'Pulse')).toBe(true);
    expect(heroHasNumberOrProductToken({ headline: 'Pulse 重塑你的销售流程' } as any, 'Pulse')).toBe(true);
    expect(heroHasNumberOrProductToken({ headline: '一句平淡的副标题没有任何特定锚点' } as any, 'Pulse')).toBe(false);
  });

  test('EVAL-GOLDEN-PRED-002 · variantsDifferInHero catches identical pairs', () => {
    expect(variantsDifferInHero({ eyebrow: 'X', headline: 'Y' } as any, { eyebrow: 'X', headline: 'Y' } as any)).toBe(false);
    expect(variantsDifferInHero({ eyebrow: 'X', headline: 'Y' } as any, { eyebrow: 'Z', headline: 'Y' } as any)).toBe(true);
  });

  test('EVAL-GOLDEN-PRED-003 · benefitsItemsAreDistinct catches duplicates', () => {
    expect(benefitsItemsAreDistinct({ items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] } as any)).toBe(true);
    expect(benefitsItemsAreDistinct({ items: [{ title: 'A' }, { title: 'A' }, { title: 'B' }] } as any)).toBe(false);
  });

  test('EVAL-GOLDEN-PRED-004 · localeScriptMatches across 4 locales', () => {
    expect(localeScriptMatches('English copy with no Han at all', 'en')).toBe(true);
    expect(localeScriptMatches('English with 中文 mixed in here heavily 中文中文中文', 'en')).toBe(false);
    expect(localeScriptMatches('日本語のコピーです、カタカナとひらがな両方', 'ja')).toBe(true);
    expect(localeScriptMatches('全部都是汉字没有日语假名所以日语 locale 不应该通过', 'ja')).toBe(false);
    expect(localeScriptMatches('简体中文文案带数字 100 也通过', 'zh-CN')).toBe(true);
  });
});

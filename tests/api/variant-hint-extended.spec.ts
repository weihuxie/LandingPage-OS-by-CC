/**
 * API-VARIANT-HINT-* · variantHintForModule extended to non-hero types
 * (Wave 4 #M).
 *
 * Old behavior: only hero returned a non-null variant hint. benefits /
 * solution / cta shared one patch across A and B → users switching A/B
 * tabs saw byte-identical copy. Violates PRD §4.3 A/B differentiation
 * premise. Now each of these returns a distinct A vs B hint, and the
 * hydrate orchestrator calls them per-variant.
 *
 * Pure function — no server, no LLM key, no DOM.
 */
import { test, expect } from '@playwright/test';
import { variantHintForModule } from '../../src/lib/llm-claude';

test.describe('API-VARIANT-HINT · variantHintForModule extended (Wave 4 #M)', () => {
  test('API-VARIANT-HINT-001 · hero A vs B differ (regression)', () => {
    const a = variantHintForModule('hero', 'A', 'zh-CN');
    const b = variantHintForModule('hero', 'B', 'zh-CN');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(a).toMatch(/COST|cost|loss/);
    expect(b).toMatch(/OUTCOME|outcome|gain|ROI/);
  });

  test('API-VARIANT-HINT-002 · benefits A vs B differ (new)', () => {
    const a = variantHintForModule('benefits', 'A', 'zh-CN');
    const b = variantHintForModule('benefits', 'B', 'zh-CN');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    // A frames as relief from pain; B frames as quantified gain
    expect(a).toMatch(/relief|pain|cost|no more|stop/i);
    expect(b).toMatch(/gain|outcome|ROI|faster|achievement/i);
  });

  test('API-VARIANT-HINT-003 · solution A vs B differ (new)', () => {
    const a = variantHintForModule('solution', 'A', 'zh-CN');
    const b = variantHintForModule('solution', 'B', 'zh-CN');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(a).toMatch(/antidote|pain|stop|losing/i);
    expect(b).toMatch(/path|outcome|result|gets|mechanism/i);
  });

  test('API-VARIANT-HINT-004 · cta A vs B differ (new)', () => {
    const a = variantHintForModule('cta', 'A', 'zh-CN');
    const b = variantHintForModule('cta', 'B', 'zh-CN');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(a).toMatch(/cost|stop|reclaim|losing/i);
    expect(b).toMatch(/outcome|gain|saving|start gaining|results/i);
  });

  test('API-VARIANT-HINT-005 · pain stays variant-A only (returns null for B by design)', () => {
    // Orchestrator never asks for pain B (variant B's order excludes pain),
    // but the function should still return null — A-only modules don't
    // need variant differentiation when B never gets called.
    expect(variantHintForModule('pain', 'A', 'zh-CN')).toBeNull();
  });

  test('API-VARIANT-HINT-006 · other types stay null (not variant-relevant)', () => {
    for (const t of ['socialProof', 'faq', 'form', 'testimonial', 'useCase', 'productShowcase', 'videoEmbed'] as const) {
      expect(variantHintForModule(t, 'A', 'zh-CN'), `${t} A`).toBeNull();
      expect(variantHintForModule(t, 'B', 'zh-CN'), `${t} B`).toBeNull();
    }
  });

  test('API-VARIANT-HINT-007 · hero locale-aware eyebrow examples (regression)', () => {
    expect(variantHintForModule('hero', 'A', 'ja')).toContain('現状のコスト');
    expect(variantHintForModule('hero', 'A', 'en')).toContain('THE HIDDEN COST');
    expect(variantHintForModule('hero', 'B', 'ja')).toContain('成果の約束');
    expect(variantHintForModule('hero', 'B', 'en')).toContain('OUTCOME FIRST');
  });
});

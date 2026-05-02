/**
 * API-TEMPLATE-NORM-* · template fingerprint normalization (Wave 3 #C).
 *
 * Old detector did exact-match against the templated strings: Claude
 * flipping a single punctuation mark or removing a space slipped past
 * findTemplateModules → no retry triggered → templated copy shipped.
 *
 * Now we normalize (lowercase + strip whitespace + strip CJK & ASCII
 * punctuation) before comparing. Regression suite covers each known
 * tweak shape Claude has been observed to do.
 */
import { test, expect } from '@playwright/test';
import {
  normalizeForFingerprint,
  isHeroHeadlineTemplate,
  isPainTemplate,
  isSolutionTemplate,
  isBenefitsTemplate,
  isCtaTemplate,
} from '../../src/lib/template-detection';

test.describe('API-TEMPLATE-NORM · normalize helper', () => {
  test('API-TEMPLATE-NORM-001 · strips whitespace and CJK punctuation', () => {
    expect(normalizeForFingerprint('每周有 11 小时，被吃掉。'))
      .toBe(normalizeForFingerprint('每周有11小时被吃掉'));
  });

  test('API-TEMPLATE-NORM-002 · lowercases English', () => {
    expect(normalizeForFingerprint('Why Teams Switch'))
      .toBe(normalizeForFingerprint('why teams switch'));
  });

  test('API-TEMPLATE-NORM-003 · strips ASCII punctuation', () => {
    expect(normalizeForFingerprint('Ready to ship your page?'))
      .toBe(normalizeForFingerprint('Ready to ship your page'));
  });
});

test.describe('API-TEMPLATE-NORM · hero headline catches punctuation tweaks (Wave 3 #C)', () => {
  test('API-TEMPLATE-NORM-101 · zh-CN exact match still works', () => {
    expect(isHeroHeadlineTemplate('每周有 11 小时，被本可避免的手工活吃掉。')).toBe(true);
  });

  test('API-TEMPLATE-NORM-102 · zh-CN punctuation/space tweak now caught (regression)', () => {
    // Old: false (slipped past). New: true.
    expect(isHeroHeadlineTemplate('每周有11小时被本可避免的手工活吃掉')).toBe(true);
  });

  test('API-TEMPLATE-NORM-103 · ja punctuation tweak caught', () => {
    // Source: '週 11 時間、避けられるはずの手作業に奪われています。'
    expect(isHeroHeadlineTemplate('週11時間 避けられるはずの手作業に奪われています')).toBe(true);
  });

  test('API-TEMPLATE-NORM-104 · en punctuation+case tweak caught', () => {
    // Source: '11 hours a week, lost to work that should never exist.'
    expect(isHeroHeadlineTemplate('11 HOURS A WEEK LOST TO WORK THAT SHOULD NEVER EXIST')).toBe(true);
  });

  test('API-TEMPLATE-NORM-105 · genuinely different prose stays NOT template', () => {
    expect(isHeroHeadlineTemplate('The 47-minute Tuesday: how RevOps reclaims its calendar.')).toBe(false);
  });
});

test.describe('API-TEMPLATE-NORM · pain/solution/benefits/cta tweak detection', () => {
  test('API-TEMPLATE-NORM-201 · pain title without punctuation caught', () => {
    expect(isPainTemplate({ title: '旧的做法已经不管用' })).toBe(true);
    // Original templated form ends without punctuation already, so add space tweak:
    expect(isPainTemplate({ title: '旧 的 做 法 已 经 不 管 用' })).toBe(true);
  });

  test('API-TEMPLATE-NORM-202 · solution body uppercase + punctuation removed', () => {
    expect(isSolutionTemplate({
      body: 'BRING YOUR PRODUCT INFO AUDIENCE AND MATERIALS GET A LOCALIZED CONVERSION-READY PAGE EDIT ANYTHING PUBLISH COLLECT LEADS',
    })).toBe(true);
  });

  test('API-TEMPLATE-NORM-203 · benefits title with full-width punctuation caught', () => {
    expect(isBenefitsTemplate({ title: '为什么、团队会切换过来！' })).toBe(true);
  });

  test('API-TEMPLATE-NORM-204 · cta headline question mark variants caught', () => {
    expect(isCtaTemplate({ headline: '准备好上线了吗？' })).toBe(true); // CJK ?
    expect(isCtaTemplate({ headline: '准备好上线了吗?' })).toBe(true); // ASCII ?
    expect(isCtaTemplate({ headline: '准备好上线了吗' })).toBe(true);   // no ?
  });

  test('API-TEMPLATE-NORM-205 · genuinely user-edited cta NOT flagged', () => {
    expect(isCtaTemplate({ headline: '把销售周期从 90 天压到 30 天，从今天开始。' })).toBe(false);
  });
});

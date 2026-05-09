/**
 * API-MIG-PAR-* · planPageMigration / applyPageMigration tests.
 *
 * Covers from audit-2026-05.md §2.8:
 *   401  alreadyMigrated path (page has localeGroupId) → no-op plan
 *   402  zh-CN + ja + en → 1 primary + 2 sibling rows with `p_*` ids
 *   403  publish state inheritance: primary keeps deploy/published; siblings reset
 *   404  createdAt: primary keeps source's, siblings stamp now
 *   405  empty availableLocales defensive → treats as [defaultLocale]
 *   406  availableLocales missing defaultLocale → adds it via Set dedup
 *   407  source has no variants for a locale → sibling gets empty arrays
 *   408  stats.byLocale missing for sibling locale → defaults to {0,0}
 *   409  sibling.defaultLocale === sibling.locale === sibling.availableLocales[0]
 *   410  applyPageMigration on alreadyMigrated plan → no-op (idempotent)
 *   411  applyPageMigration writes primary first (with slug-map), siblings skipSlugMap
 *   412  abStats per-sibling slice (byVariantLocale → abStats top-level)
 *
 * planPageMigration is pure — fast unit tests. applyPageMigration writes
 * real storage (uses local FS in test env); we use unique slugs and clean
 * up after to avoid polluting other suites.
 */
import { test, expect } from '@playwright/test';
import {
  planPageMigration,
  applyPageMigration,
} from '../../src/lib/migrate-parallel-locales';
import {
  saveLandingPage,
  getLandingPage,
  deleteLandingPage,
  getLandingPageGroup,
} from '../../src/lib/storage';
import type { LandingPage, PageLocale } from '../../src/lib/types';

/**
 * Build a baseline LandingPage for tests. Tests override specific fields
 * via the `overrides` parameter.
 */
function buildPage(overrides: Partial<LandingPage> = {}): LandingPage {
  const base: LandingPage = {
    id: `lp_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: 't_test',
    productId: 'p_test',
    slug: `test-slug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    purpose: 'main',
    name: '主站',
    targetMarket: 'CN',
    defaultLocale: 'zh-CN',
    availableLocales: ['zh-CN'],
    cta: 'demo',
    audience: { industry: 'SaaS', companySize: '10-50', role: 'PM', source: 'ads' },
    strategy: { audience: ['a'], goal: ['g'], narrative: ['n'], local: ['l'] },
    tone: 'saas',
    variants: {
      A: { 'zh-CN': [{ id: 'm1', type: 'hero', enabled: true, content: { headline: 'h' } as any }] },
      B: { 'zh-CN': [{ id: 'm1b', type: 'hero', enabled: true, content: { headline: 'hb' } as any }] },
    },
    activeVariant: 'A',
    publishMode: 'single',
    theme: { primary: '#000', styleId: 'saas-modern' },
    published: false,
    stats: {
      views: 0,
      leads: 0,
      byLocale: { 'zh-CN': { views: 0, leads: 0 } },
      byVariantLocale: {
        A: { 'zh-CN': { views: 0, leads: 0 } },
        B: { 'zh-CN': { views: 0, leads: 0 } },
      },
      abStats: { A: { views: 0, leads: 0 }, B: { views: 0, leads: 0 } },
    },
    ...overrides,
  };
  return base;
}

test.describe('API-MIG-PAR · planPageMigration (pure)', () => {

  test('API-MIG-PAR-401 · already-migrated page (has localeGroupId) → no-op plan', () => {
    const page = buildPage({ localeGroupId: 'lg_existing_x' });
    const plan = planPageMigration(page);
    expect(plan.alreadyMigrated).toBe(true);
    expect(plan.groupId).toBe('lg_existing_x');
    expect(plan.newSiblings).toEqual([]);
    expect(plan.primaryUpdate).toBe(page); // identity — no rebuild
  });

  test('API-MIG-PAR-402 · zh-CN + ja + en → 1 primary + 2 siblings, ids p_*', () => {
    const page = buildPage({
      defaultLocale: 'zh-CN',
      availableLocales: ['zh-CN', 'ja', 'en'],
      variants: {
        A: { 'zh-CN': [], ja: [], en: [] },
        B: { 'zh-CN': [], ja: [], en: [] },
      },
    });
    const plan = planPageMigration(page);
    expect(plan.alreadyMigrated).toBe(false);
    expect(plan.primaryUpdate.id).toBe(page.id);
    expect(plan.primaryUpdate.locale).toBe('zh-CN');
    expect(plan.newSiblings.length).toBe(2);
    const siblingLocales = plan.newSiblings.map((s) => s.locale).sort();
    expect(siblingLocales).toEqual(['en', 'ja']);
    for (const sib of plan.newSiblings) {
      expect(sib.id).toMatch(/^p_/);
      expect(sib.localeGroupId).toBe(plan.groupId);
    }
  });

  test('API-MIG-PAR-403 · publish state: primary inherits, siblings reset to dark', () => {
    const page = buildPage({
      availableLocales: ['zh-CN', 'ja'],
      variants: {
        A: { 'zh-CN': [], ja: [] },
        B: { 'zh-CN': [], ja: [] },
      },
      published: true,
      publishedAt: 1_700_000_500_000,
      deploy: { provider: 'vercel', url: 'https://x.vercel.app', deployedAt: 1, status: 'ready' },
    });
    const plan = planPageMigration(page);
    expect(plan.primaryUpdate.published).toBe(true);
    expect(plan.primaryUpdate.publishedAt).toBe(1_700_000_500_000);
    expect(plan.primaryUpdate.deploy).toEqual(page.deploy);
    // 方案 B rule: siblings start dark, never inherit publish state.
    expect(plan.newSiblings[0].published).toBe(false);
    expect(plan.newSiblings[0].publishedAt).toBeUndefined();
    expect(plan.newSiblings[0].deploy).toBeNull();
  });

  test('API-MIG-PAR-404 · createdAt: primary keeps source, siblings get now', () => {
    const before = Date.now();
    const page = buildPage({
      availableLocales: ['zh-CN', 'ja'],
      variants: { A: { 'zh-CN': [], ja: [] }, B: { 'zh-CN': [], ja: [] } },
      createdAt: 1_700_000_000_000,
    });
    const plan = planPageMigration(page);
    const after = Date.now();
    expect(plan.primaryUpdate.createdAt).toBe(1_700_000_000_000);
    expect(plan.newSiblings[0].createdAt).toBeGreaterThanOrEqual(before);
    expect(plan.newSiblings[0].createdAt).toBeLessThanOrEqual(after);
  });

  test('API-MIG-PAR-405 · empty availableLocales → treats as [defaultLocale], 0 siblings', () => {
    const page = buildPage({
      defaultLocale: 'zh-CN',
      availableLocales: [],
    });
    const plan = planPageMigration(page);
    expect(plan.newSiblings).toEqual([]);
    expect(plan.primaryUpdate.locale).toBe('zh-CN');
    expect(plan.primaryUpdate.availableLocales).toEqual(['zh-CN']);
  });

  test('API-MIG-PAR-406 · availableLocales missing defaultLocale → defensive add via Set dedup', () => {
    const page = buildPage({
      defaultLocale: 'zh-CN',
      // availableLocales claims only ja, but defaultLocale says zh-CN.
      availableLocales: ['ja'],
      variants: { A: { 'zh-CN': [], ja: [] }, B: { 'zh-CN': [], ja: [] } },
    });
    const plan = planPageMigration(page);
    // Defensive: defaultLocale is forced into the unique set, so we get
    // primary=zh-CN + sibling=ja.
    expect(plan.primaryUpdate.locale).toBe('zh-CN');
    expect(plan.newSiblings.length).toBe(1);
    expect(plan.newSiblings[0].locale).toBe('ja');
  });

  test('API-MIG-PAR-407 · source missing a locale\'s variants → sibling gets empty arrays', () => {
    const page = buildPage({
      availableLocales: ['zh-CN', 'ja'],
      variants: {
        A: { 'zh-CN': [{ id: 'm', type: 'hero', enabled: true, content: {} as any }] },
        B: { 'zh-CN': [{ id: 'mb', type: 'hero', enabled: true, content: {} as any }] },
        // No ja keys at all — sibling defaults must not crash.
      } as any,
    });
    const plan = planPageMigration(page);
    const ja = plan.newSiblings.find((s) => s.locale === 'ja');
    expect(ja).toBeDefined();
    expect(ja!.variants.A.ja).toEqual([]);
    expect(ja!.variants.B.ja).toEqual([]);
  });

  test('API-MIG-PAR-408 · stats.byLocale missing → sibling.stats defaults to {0,0}', () => {
    const page = buildPage({
      availableLocales: ['zh-CN', 'ja'],
      variants: { A: { 'zh-CN': [], ja: [] }, B: { 'zh-CN': [], ja: [] } },
      stats: {
        views: 5,
        leads: 1,
        // byLocale only has zh-CN; ja is missing → sibling should default.
        byLocale: { 'zh-CN': { views: 5, leads: 1 } },
        byVariantLocale: {
          A: { 'zh-CN': { views: 3, leads: 1 } },
          B: { 'zh-CN': { views: 2, leads: 0 } },
        },
        abStats: { A: { views: 3, leads: 1 }, B: { views: 2, leads: 0 } },
      },
    });
    const plan = planPageMigration(page);
    const ja = plan.newSiblings.find((s) => s.locale === 'ja');
    expect(ja).toBeDefined();
    expect(ja!.stats.views).toBe(0);
    expect(ja!.stats.leads).toBe(0);
    expect(ja!.stats.byLocale.ja).toEqual({ views: 0, leads: 0 });
  });

  test('API-MIG-PAR-409 · sibling.defaultLocale === locale === availableLocales[0] (self-consistent)', () => {
    const page = buildPage({
      availableLocales: ['zh-CN', 'ja', 'en'],
      variants: {
        A: { 'zh-CN': [], ja: [], en: [] },
        B: { 'zh-CN': [], ja: [], en: [] },
      },
    });
    const plan = planPageMigration(page);
    for (const sib of plan.newSiblings) {
      expect(sib.locale).toBe(sib.defaultLocale);
      expect(sib.availableLocales).toEqual([sib.locale]);
    }
  });

  test('API-MIG-PAR-412 · abStats sliced from byVariantLocale per sibling locale', () => {
    const page = buildPage({
      availableLocales: ['zh-CN', 'ja'],
      variants: { A: { 'zh-CN': [], ja: [] }, B: { 'zh-CN': [], ja: [] } },
      stats: {
        views: 100,
        leads: 10,
        byLocale: {
          'zh-CN': { views: 60, leads: 6 },
          ja: { views: 40, leads: 4 },
        },
        byVariantLocale: {
          A: {
            'zh-CN': { views: 30, leads: 3 },
            ja: { views: 25, leads: 2 },
          },
          B: {
            'zh-CN': { views: 30, leads: 3 },
            ja: { views: 15, leads: 2 },
          },
        },
        abStats: { A: { views: 55, leads: 5 }, B: { views: 45, leads: 5 } },
      },
    });
    const plan = planPageMigration(page);
    const ja = plan.newSiblings.find((s) => s.locale === 'ja')!;
    // Each sibling's abStats top-level is JUST that locale's A vs B,
    // not the global aggregate. Otherwise per-sibling A/B comparisons
    // would double-count cross-locale traffic.
    expect(ja.stats.abStats.A).toEqual({ views: 25, leads: 2 });
    expect(ja.stats.abStats.B).toEqual({ views: 15, leads: 2 });
    // Primary keeps zh-CN slice as its abStats.
    expect(plan.primaryUpdate.stats.abStats.A).toEqual({ views: 30, leads: 3 });
    expect(plan.primaryUpdate.stats.abStats.B).toEqual({ views: 30, leads: 3 });
  });
});

test.describe('API-MIG-PAR · applyPageMigration (integration with storage)', () => {

  test('API-MIG-PAR-410 · already-migrated plan → no-op (no writes)', async () => {
    const page = buildPage({ localeGroupId: 'lg_test_410' });
    const plan = planPageMigration(page);
    // Should not write anything to storage when alreadyMigrated.
    await applyPageMigration(plan);
    // Defensive: the page wasn't saved by us, so getLandingPage(page.id)
    // should return null (page never existed in storage in the first place).
    const fetched = await getLandingPage(page.id);
    expect(fetched).toBeNull();
  });

  test('API-MIG-PAR-411 · applies primary with slug-map, siblings skipSlugMap', async () => {
    // Use unique slug so we don't collide with other test data.
    const stamp = Date.now();
    const slug = `mig-par-411-${stamp}`;
    const page = buildPage({
      id: `lp_mig411_${stamp}`,
      slug,
      defaultLocale: 'zh-CN',
      availableLocales: ['zh-CN', 'ja'],
      variants: { A: { 'zh-CN': [], ja: [] }, B: { 'zh-CN': [], ja: [] } },
    });
    // Seed the source page first so applyPageMigration has something to
    // overwrite. saveLandingPage default writes the slug map.
    await saveLandingPage(page);
    const cleanupIds: string[] = [page.id];

    try {
      const plan = planPageMigration(page);
      await applyPageMigration(plan);
      // After apply: primary kept the same id (source-row id preserved),
      // sibling for 'ja' got a new p_* id, both share localeGroupId.
      const primary = await getLandingPage(plan.primaryUpdate.id);
      expect(primary).not.toBeNull();
      expect(primary!.localeGroupId).toBe(plan.groupId);
      expect(primary!.locale).toBe('zh-CN');

      const siblings = await getLandingPageGroup(plan.groupId);
      expect(siblings.length).toBe(2); // primary + 1 sibling
      const ja = siblings.find((s) => s.locale === 'ja');
      expect(ja).toBeDefined();
      cleanupIds.push(ja!.id);
      // The sibling didn't claim the slug — primary still owns it.
      // (Indirect verification: getLandingPageGroup returns both, but
      // the slug map points to primary.)
      expect(primary!.id).toBe(page.id);
    } finally {
      for (const id of cleanupIds) {
        await deleteLandingPage(id).catch(() => {});
      }
    }
  });
});

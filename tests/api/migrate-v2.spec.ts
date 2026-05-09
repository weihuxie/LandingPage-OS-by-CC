/**
 * API-MIG-V2-* · migrate-v2.ts unit tests.
 *
 * Covers from audit-2026-05.md §2.9:
 *   401  tenantId precedence over ownerId
 *   402  ownerId fallback when no tenantId
 *   403  both missing → 'default' sentinel
 *   404  empty project.inputs → product gets defaults
 *   405  project.variants.A only, B missing → B falls back to project.modules
 *   406  no variants, only project.modules → A === B === modules
 *   407  existingProductId override (skips id generation)
 *   408  abStats missing → default {0,0}
 *   409  projectViewFromV2 active locale + variant resolution
 *   410  activeVariant='B' → view.modules === variantB
 *   411  siblings param accepted but unread (forward-compat)
 *   412  view.tenantId derivation chain
 *
 * Both functions are pure; all tests are direct unit calls. The Project
 * input shape is intentionally `any` in the source signature (it accepts
 * raw legacy blobs that don't match the v2 type), so test fixtures use
 * `as any` for legacy fields not in the modern type.
 */
import { test, expect } from '@playwright/test';
import {
  migrateProjectToV2,
  projectViewFromV2,
  siblingsToProjectViewGroup,
} from '../../src/lib/migrate-v2';
import type { LandingPage, Product } from '../../src/lib/types';

test.describe('API-MIG-V2 · migrateProjectToV2 (legacy v1 → v2)', () => {

  test('API-MIG-V2-401 · tenantId beats ownerId', () => {
    const project = {
      id: 'lp_legacy_1',
      tenantId: 't_new',
      ownerId: 'o_old',
      inputs: { name: 'X' },
    };
    const { product, page } = migrateProjectToV2(project);
    expect(product.tenantId).toBe('t_new');
    expect(page.tenantId).toBe('t_new');
  });

  test('API-MIG-V2-402 · only ownerId set → product.tenantId = ownerId', () => {
    const project = {
      id: 'lp_legacy_2',
      ownerId: 'o_legacy_user',
      inputs: { name: 'X' },
    };
    const { product, page } = migrateProjectToV2(project);
    expect(product.tenantId).toBe('o_legacy_user');
    expect(page.tenantId).toBe('o_legacy_user');
  });

  test('API-MIG-V2-403 · neither tenantId nor ownerId → "default" sentinel', () => {
    const project = { id: 'lp_legacy_3', inputs: { name: 'X' } };
    const { product, page } = migrateProjectToV2(project);
    expect(product.tenantId).toBe('default');
    expect(page.tenantId).toBe('default');
  });

  test('API-MIG-V2-404 · empty inputs → product gets defaults', () => {
    const project = { id: 'lp_legacy_4', inputs: {} };
    const { product, page } = migrateProjectToV2(project);
    expect(product.name).toBe('未命名产品');
    expect(product.tagline).toBe('');
    expect(product.category).toBe('');
    expect(product.value).toBe('');
    expect(product.theme.primary).toBe('#4861ff');
    expect(page.defaultLocale).toBe('zh-CN'); // locale fallback
    expect(page.targetMarket).toBe('GLOBAL'); // market fallback
  });

  test('API-MIG-V2-405 · variants.A present, B missing → B falls back to project.modules', () => {
    const moduleA = { id: 'mA', type: 'hero', enabled: true, content: { headline: 'a' } };
    const moduleB = { id: 'mB', type: 'pain', enabled: true, content: { title: 'b' } };
    const project = {
      id: 'lp_legacy_5',
      inputs: { name: 'X', locale: 'en' },
      variants: { A: [moduleA] },
      modules: [moduleB],
    };
    const { page } = migrateProjectToV2(project);
    // A came from variants.A
    expect(page.variants.A.en).toEqual([moduleA]);
    // B fell back to project.modules
    expect(page.variants.B.en).toEqual([moduleB]);
  });

  test('API-MIG-V2-406 · only project.modules (no variants) → A === B === modules', () => {
    const m = { id: 'm', type: 'hero', enabled: true, content: { headline: 'h' } };
    const project = {
      id: 'lp_legacy_6',
      inputs: { name: 'X', locale: 'zh-CN' },
      modules: [m],
    };
    const { page } = migrateProjectToV2(project);
    expect(page.variants.A['zh-CN']).toEqual([m]);
    expect(page.variants.B['zh-CN']).toEqual([m]);
  });

  test('API-MIG-V2-407 · existingProductId honored (no new nanoid)', () => {
    const project = { id: 'lp_legacy_7', inputs: { name: 'X' } };
    const { product, page } = migrateProjectToV2(project, 'p_explicit_xyz');
    expect(product.id).toBe('p_explicit_xyz');
    expect(page.productId).toBe('p_explicit_xyz');
  });

  test('API-MIG-V2-408 · abStats missing → defaults {A:{0,0},B:{0,0}}', () => {
    const project = { id: 'lp_legacy_8', inputs: { name: 'X' } };
    const { page } = migrateProjectToV2(project);
    expect(page.stats.abStats).toEqual({
      A: { views: 0, leads: 0 },
      B: { views: 0, leads: 0 },
    });
  });

  test('API-MIG-V2-408b · views/leadCount feed page.stats.views/leads', () => {
    const project = {
      id: 'lp_legacy_8b',
      inputs: { name: 'X', locale: 'ja' },
      views: 42,
      leadCount: 7,
    };
    const { page } = migrateProjectToV2(project);
    expect(page.stats.views).toBe(42);
    expect(page.stats.leads).toBe(7);
    expect(page.stats.byLocale.ja).toEqual({ views: 42, leads: 7 });
  });
});

test.describe('API-MIG-V2 · projectViewFromV2 (v2 → compat view)', () => {

  function buildPair(overrides: { page?: Partial<LandingPage>; product?: Partial<Product> } = {}) {
    const product: Product = {
      id: 'p_view_test',
      tenantId: 't_x',
      createdAt: 1,
      updatedAt: 1,
      name: 'TestP',
      tagline: 'tagline',
      category: 'SaaS',
      value: 'val',
      website: 'https://example.com',
      theme: { primary: '#abc', styleId: 'saas-modern' },
      assets: { testimonials: [], cases: [], media: [] },
      landingPageIds: [],
      ...overrides.product,
    };
    const heroA = { id: 'mA', type: 'hero', enabled: true, content: { headline: 'A' } as any };
    const heroB = { id: 'mB', type: 'hero', enabled: true, content: { headline: 'B' } as any };
    const page: LandingPage = {
      id: 'lp_view_test',
      tenantId: 't_x',
      productId: product.id,
      slug: 'view-test',
      createdAt: 1,
      updatedAt: 1,
      purpose: 'main',
      name: '主站',
      targetMarket: 'CN',
      defaultLocale: 'zh-CN',
      availableLocales: ['zh-CN'],
      cta: 'demo',
      audience: { industry: 'SaaS', companySize: '10-50', role: 'PM', source: 'ads' },
      strategy: { audience: ['a'], goal: ['g'], narrative: ['n'], local: ['l'] },
      tone: 'saas',
      variants: { A: { 'zh-CN': [heroA] }, B: { 'zh-CN': [heroB] } },
      activeVariant: 'A',
      publishMode: 'single',
      theme: { primary: '#def', styleId: 'saas-modern' },
      published: false,
      stats: {
        views: 0,
        leads: 0,
        byLocale: { 'zh-CN': { views: 0, leads: 0 } },
        byVariantLocale: { A: {}, B: {} },
        abStats: { A: { views: 0, leads: 0 }, B: { views: 0, leads: 0 } },
      },
      ...overrides.page,
    };
    return { page, product };
  }

  test('API-MIG-V2-409 · view.modules pulled from activeVariant=A + defaultLocale', () => {
    const { page, product } = buildPair();
    const view = projectViewFromV2(page, product);
    expect(view.modules).toEqual(page.variants.A['zh-CN']);
    expect(view.inputs.name).toBe('TestP');
    expect(view.inputs.locale).toBe('zh-CN');
    expect(view.inputs.tagline).toBe('tagline');
  });

  test('API-MIG-V2-410 · activeVariant=B → view.modules === variantB', () => {
    const { page, product } = buildPair({ page: { activeVariant: 'B' } });
    const view = projectViewFromV2(page, product);
    expect(view.modules).toEqual(page.variants.B['zh-CN']);
    expect(view.activeVariant).toBe('B');
  });

  test('API-MIG-V2-411 · siblings param accepted but unread (forward-compat seam)', () => {
    const { page, product } = buildPair();
    const sib1: LandingPage = { ...page, id: 'sib1', locale: 'ja' as any };
    const sib2: LandingPage = { ...page, id: 'sib2', locale: 'en' as any };
    // Should not throw and should return the same shape as no-siblings call.
    const viewWith = projectViewFromV2(page, product, [sib1, sib2]);
    const viewWithout = projectViewFromV2(page, product);
    expect(viewWith.id).toBe(viewWithout.id);
    expect(viewWith.modules).toEqual(viewWithout.modules);
  });

  test('API-MIG-V2-411b · siblingsToProjectViewGroup is a thin wrapper today', () => {
    const { page, product } = buildPair();
    const sib1: LandingPage = { ...page, id: 'sib1' };
    const wrapper = siblingsToProjectViewGroup(page, [sib1], product);
    const direct = projectViewFromV2(page, product, [sib1]);
    expect(wrapper.id).toBe(direct.id);
    expect(wrapper.modules).toEqual(direct.modules);
  });

  test('API-MIG-V2-412 · view.tenantId derivation: page.tenantId > ownerId > "default"', () => {
    // Case 1: explicit tenantId
    const { page: p1, product: pr1 } = buildPair({ page: { tenantId: 't_explicit' } });
    expect(projectViewFromV2(p1, pr1).tenantId).toBe('t_explicit');

    // Case 2: legacy ownerId field on page (cast through any)
    const { page: p2, product: pr2 } = buildPair();
    delete (p2 as any).tenantId;
    (p2 as any).ownerId = 'o_legacy';
    expect(projectViewFromV2(p2, pr2).tenantId).toBe('o_legacy');

    // Case 3: neither → 'default' sentinel (matches LEGACY_TENANT_ID)
    const { page: p3, product: pr3 } = buildPair();
    delete (p3 as any).tenantId;
    delete (p3 as any).ownerId;
    expect(projectViewFromV2(p3, pr3).tenantId).toBe('default');
  });
});

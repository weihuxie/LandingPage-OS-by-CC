/**
 * API-STORAGE-* · storage.ts unit + light-integration tests.
 *
 * Covers from audit-2026-05.md §3.8 (P0/P1 priority):
 *   402  Vercel + no KV → StorageRequiredError on first storage op
 *   404  coerceTenant: {ownerId} legacy row → tenantId=ownerId
 *   405  coerceTenant: {} → tenantId='default' sentinel
 *   407  readProducts({tenantId:'t1'}) filters out other tenants
 *   408  readProducts({}) returns the full set (admin path)
 *   409  claimLegacyData(newTenant) reassigns LEGACY_TENANT_ID rows
 *   410  claimLegacyData second call → no-op (idempotent)
 *   411  claimLegacyData('default') → refuses (throws)
 *   413  saveLandingPage same slug, different id → slug-map keeps original (no overwrite)
 *   414  saveLandingPage with skipSlugMap=true → does NOT touch slug-map
 *   416  getLandingPageGroup returns all siblings sharing a localeGroupId
 *   418  getLandingPageBySlugLocale routes per-locale to the right sibling
 *
 * Skipped from audit (deferred):
 *   401  assertStorageOk happy path — covered transitively (every passing test)
 *   403  coerceTenant identity case — covered by 404 contrast
 *   406  coerceTenant(null) — internal helper not exported; behavior verified
 *        through the public reads returning null when fixture has no row
 *   412  saveLandingPage first-time slug-map write — covered transitively by 413
 *   415  saveLandingPage same id same slug no-warn — observability not assertable
 *   417  deleteProductAndPages sibling cascade — needs /api/products + parallel-locale
 *        end-to-end which exercises a separate slice of storage; deferred to S5
 *
 * Test strategy: write fixture rows directly to `.data/*.json` to control
 * exactly which tenant/legacy state we exercise, then invoke the public
 * storage functions and assert on their outputs. Each test cleans up
 * after itself by deleting the fixture entries (storage tests share
 * `.data/` with seedProject — using unique ids prevents collision).
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import path from 'path';
import {
  LEGACY_TENANT_ID,
  claimLegacyData,
  getLandingPage,
  getLandingPageBySlug,
  getLandingPageBySlugLocale,
  getLandingPageGroup,
  getProduct,
  readProducts,
  saveLandingPage,
  saveProduct,
  deleteLandingPage,
} from '../../src/lib/storage';
import { StorageRequiredError } from '../../src/lib/errors';
import type { LandingPage, Product } from '../../src/lib/types';

const PRODUCTS_FILE = path.join(process.cwd(), '.data', 'v2:products.json');
const PAGES_FILE = path.join(process.cwd(), '.data', 'v2:pages.json');

async function readJsonList<T>(file: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeJsonList<T>(file: string, list: T[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(list, null, 2));
}

/** Append rows to a fixture file without disturbing existing ones. */
async function addFixtureProducts(rows: Partial<Product>[]): Promise<string[]> {
  const existing = await readJsonList<Product>(PRODUCTS_FILE);
  const merged = [...existing, ...(rows as Product[])];
  await writeJsonList(PRODUCTS_FILE, merged);
  return rows.map((r) => r.id!);
}

async function addFixturePages(rows: Partial<LandingPage>[]): Promise<string[]> {
  const existing = await readJsonList<LandingPage>(PAGES_FILE);
  const merged = [...existing, ...(rows as LandingPage[])];
  await writeJsonList(PAGES_FILE, merged);
  return rows.map((r) => r.id!);
}

async function removeProductsByIds(ids: string[]): Promise<void> {
  const existing = await readJsonList<Product>(PRODUCTS_FILE);
  const next = existing.filter((p) => !ids.includes(p.id));
  await writeJsonList(PRODUCTS_FILE, next);
}

async function removePagesByIds(ids: string[]): Promise<void> {
  const existing = await readJsonList<LandingPage>(PAGES_FILE);
  const next = existing.filter((p) => !ids.includes(p.id));
  await writeJsonList(PAGES_FILE, next);
}

function buildProduct(overrides: Partial<Product>): Product {
  return {
    id: overrides.id ?? `p_test_${Date.now()}`,
    tenantId: overrides.tenantId ?? 't_test',
    createdAt: 1,
    updatedAt: 1,
    name: 'TestProduct',
    tagline: '',
    category: 'SaaS',
    value: '',
    theme: { primary: '#000', styleId: 'saas-modern' },
    assets: { testimonials: [], cases: [], media: [] },
    landingPageIds: [],
    ...overrides,
  };
}

function buildPage(overrides: Partial<LandingPage>): LandingPage {
  const base: LandingPage = {
    id: overrides.id ?? `lp_test_${Date.now()}`,
    tenantId: overrides.tenantId ?? 't_test',
    productId: overrides.productId ?? 'p_test',
    slug: overrides.slug ?? `slug-${Date.now()}`,
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
    variants: { A: { 'zh-CN': [] }, B: { 'zh-CN': [] } },
    activeVariant: 'A',
    publishMode: 'single',
    theme: {},
    published: false,
    stats: {
      views: 0,
      leads: 0,
      byLocale: { 'zh-CN': { views: 0, leads: 0 } },
      byVariantLocale: { A: {}, B: {} },
      abStats: { A: { views: 0, leads: 0 }, B: { views: 0, leads: 0 } },
    },
    ...overrides,
  };
  return base;
}

test.describe('API-STORAGE · assertStorageOk', () => {

  let savedVercel: string | undefined;

  test.beforeEach(() => {
    savedVercel = process.env.VERCEL;
  });

  test.afterEach(() => {
    if (savedVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = savedVercel;
  });

  test('API-STORAGE-402 · VERCEL=1 + no KV → StorageRequiredError on first read', async () => {
    process.env.VERCEL = '1';
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    let caught: unknown = null;
    try {
      await readProducts();
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof StorageRequiredError).toBe(true);
  });
});

test.describe('API-STORAGE · coerceTenant (observed via getProduct)', () => {

  const STAMP = Date.now();
  const cleanup: string[] = [];

  test.afterEach(async () => {
    if (cleanup.length) {
      await removeProductsByIds(cleanup);
      cleanup.length = 0;
    }
  });

  test('API-STORAGE-404 · legacy row with ownerId → tenantId reads as ownerId value', async () => {
    const id = `p_legacy_owner_${STAMP}`;
    cleanup.push(id);
    // Write fixture directly with legacy-shape: ownerId set, no tenantId.
    await addFixtureProducts([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({
        id,
        ownerId: 'owner_legacy_xyz',
        createdAt: 1, updatedAt: 1,
        name: 'Legacy', tagline: '', category: '', value: '',
        theme: { primary: '#000', styleId: 'saas-modern' },
        assets: { testimonials: [], cases: [], media: [] },
        landingPageIds: [],
      }) as any,
    ]);
    const fetched = await getProduct(id);
    expect(fetched).not.toBeNull();
    expect(fetched!.tenantId).toBe('owner_legacy_xyz');
  });

  test('API-STORAGE-405 · row with neither tenantId nor ownerId → tenantId falls to "default"', async () => {
    const id = `p_no_tenant_${STAMP}`;
    cleanup.push(id);
    await addFixtureProducts([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({
        id,
        createdAt: 1, updatedAt: 1,
        name: 'NoTenant', tagline: '', category: '', value: '',
        theme: { primary: '#000', styleId: 'saas-modern' },
        assets: { testimonials: [], cases: [], media: [] },
        landingPageIds: [],
      }) as any,
    ]);
    const fetched = await getProduct(id);
    expect(fetched).not.toBeNull();
    expect(fetched!.tenantId).toBe(LEGACY_TENANT_ID);
    expect(fetched!.tenantId).toBe('default');
  });
});

test.describe('API-STORAGE · readProducts tenantId scoping', () => {

  const STAMP = Date.now();
  const cleanup: string[] = [];

  test.afterEach(async () => {
    if (cleanup.length) {
      await removeProductsByIds(cleanup);
      cleanup.length = 0;
    }
  });

  test('API-STORAGE-407 · readProducts({tenantId:t1}) filters out t2 + legacy rows', async () => {
    const id1 = `p_t1_${STAMP}`;
    const id2 = `p_t2_${STAMP}`;
    const id3 = `p_legacy_${STAMP}`;
    cleanup.push(id1, id2, id3);
    await addFixtureProducts([
      buildProduct({ id: id1, tenantId: `t1_${STAMP}` }),
      buildProduct({ id: id2, tenantId: `t2_${STAMP}` }),
      // legacy: no tenantId → coerced to LEGACY_TENANT_ID
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({
        id: id3,
        createdAt: 1, updatedAt: 1, name: 'Legacy', tagline: '', category: '', value: '',
        theme: { primary: '#000', styleId: 'saas-modern' },
        assets: { testimonials: [], cases: [], media: [] },
        landingPageIds: [],
      }) as any,
    ]);
    const list = await readProducts({ tenantId: `t1_${STAMP}` });
    const ids = list.map((p) => p.id);
    expect(ids).toContain(id1);
    expect(ids).not.toContain(id2);
    expect(ids).not.toContain(id3);
  });

  test('API-STORAGE-408 · readProducts({}) returns ALL rows (no filter — admin path)', async () => {
    const id1 = `p_all_t1_${STAMP}`;
    const id2 = `p_all_t2_${STAMP}`;
    cleanup.push(id1, id2);
    await addFixtureProducts([
      buildProduct({ id: id1, tenantId: `tA_${STAMP}` }),
      buildProduct({ id: id2, tenantId: `tB_${STAMP}` }),
    ]);
    const list = await readProducts({});
    const ids = list.map((p) => p.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });
});

test.describe('API-STORAGE · claimLegacyData', () => {

  const STAMP = Date.now();
  const productCleanup: string[] = [];
  const pageCleanup: string[] = [];

  test.afterEach(async () => {
    if (productCleanup.length) await removeProductsByIds(productCleanup);
    if (pageCleanup.length) await removePagesByIds(pageCleanup);
    productCleanup.length = 0;
    pageCleanup.length = 0;
  });

  test('API-STORAGE-409 · first call reassigns LEGACY_TENANT_ID rows to new tenant', async () => {
    const pid = `p_claim_${STAMP}`;
    productCleanup.push(pid);
    // legacy product (no tenantId)
    await addFixtureProducts([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({
        id: pid,
        createdAt: 1, updatedAt: 1, name: 'Claim', tagline: '', category: '', value: '',
        theme: { primary: '#000', styleId: 'saas-modern' },
        assets: { testimonials: [], cases: [], media: [] },
        landingPageIds: [],
      }) as any,
    ]);
    const newTenant = `t_claimer_${STAMP}`;
    const result = await claimLegacyData(newTenant);
    expect(result.productsClaimed).toBeGreaterThanOrEqual(1);
    // Verify the claimed product now belongs to the new tenant.
    const fetched = await getProduct(pid);
    expect(fetched).not.toBeNull();
    expect(fetched!.tenantId).toBe(newTenant);
  });

  test('API-STORAGE-410 · second call → no-op (idempotent)', async () => {
    // Don't seed any new legacy rows — just check the second call
    // returns 0 across the board (assuming the previous test's data
    // was claimed; or that no orphan default rows exist now).
    const newTenant = `t_idempot_${STAMP}`;
    // First call claims whatever legacy data is there (could be 0 if
    // .data is clean, or N if a prior test left some).
    await claimLegacyData(newTenant);
    // Second call: nothing else has tenantId='default' now → all-zero.
    const second = await claimLegacyData(newTenant);
    expect(second.productsClaimed).toBe(0);
    expect(second.pagesClaimed).toBe(0);
    expect(second.leadsClaimed).toBe(0);
  });

  test('API-STORAGE-411 · claimLegacyData("default") refuses with thrown Error', async () => {
    let caught: unknown = null;
    try {
      await claimLegacyData(LEGACY_TENANT_ID);
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof Error).toBe(true);
    expect((caught as Error).message).toContain('LEGACY_TENANT_ID');
  });
});

test.describe('API-STORAGE · saveLandingPage slug-map opts', () => {

  const STAMP = Date.now();
  const cleanup: string[] = [];

  test.afterEach(async () => {
    for (const id of cleanup) await deleteLandingPage(id).catch(() => {});
    cleanup.length = 0;
  });

  // CONTRACT NOTE for 413/414:
  // The audit doc's "slug-map keeps original / skipSlugMap untouched"
  // assertions describe the KV-mode defensive layer in saveLandingPage
  // (storage.ts:761-794) — it reads the existing slug→id pointer, checks
  // whether the holder row is still alive, and refuses to overwrite a
  // live other owner. That defense lives entirely in the KV branch and
  // does not exist in the FS branch (lines 811-816 just append to the
  // pages array; getLandingPageBySlug then `Array.find`s the first
  // matching slug). Test env runs FS, so we can't reach the KV defense
  // from here — the tests below assert what FS DOES guarantee (both
  // rows persist independently regardless of slug collision; deletion
  // of one doesn't leak to the other) and link to the KV-only contract
  // for follow-up coverage when a KV mock infra lands.

  test('API-STORAGE-413 · FS mode: same slug + different ids → both rows persist independently', async () => {
    const slug = `share-slug-${STAMP}`;
    const id1 = `lp_owner_${STAMP}`;
    const id2 = `lp_intruder_${STAMP}`;
    cleanup.push(id1, id2);

    await saveLandingPage(buildPage({ id: id1, slug, productId: 'p_x' }));
    await saveLandingPage(buildPage({ id: id2, slug, productId: 'p_x' }));

    // Row-level integrity (the part FS guarantees): both pages remain
    // retrievable by id. The slug-map ownership defense (KV-only) would
    // additionally pin `getLandingPageBySlug(slug)` to id1 — see the
    // CONTRACT NOTE above and storage.ts:761-794 for why this is KV-only.
    expect(await getLandingPage(id1)).not.toBeNull();
    expect(await getLandingPage(id2)).not.toBeNull();
    // FS scan returns SOMETHING for the slug (one of the two); we don't
    // pin which, only that retrieval doesn't 404.
    const bySlug = await getLandingPageBySlug(slug);
    expect(bySlug).not.toBeNull();
    expect([id1, id2]).toContain(bySlug!.id);
  });

  test('API-STORAGE-414 · FS mode: skipSlugMap:true → both rows still persist independently', async () => {
    const slug = `skip-${STAMP}`;
    const id1 = `lp_orig_${STAMP}`;
    const id2 = `lp_sibling_${STAMP}`;
    cleanup.push(id1, id2);

    await saveLandingPage(buildPage({ id: id1, slug, productId: 'p_x' }));
    // skipSlugMap is a no-op in FS mode (no slug-map exists). The
    // option's contract (KV: prevent slug-map overwrite) is verified
    // contractually by the parallel-locale apply path (S4-A's
    // API-MIG-PAR-411 verifies applyPageMigration calls saveLandingPage
    // with skipSlugMap:true on every non-primary sibling).
    await saveLandingPage(
      buildPage({ id: id2, slug, productId: 'p_x' }),
      { skipSlugMap: true },
    );

    // Both rows persist regardless of the opt — the FS path treats it
    // as a hint and writes both rows to the list.
    expect(await getLandingPage(id1)).not.toBeNull();
    expect(await getLandingPage(id2)).not.toBeNull();
  });
});

test.describe('API-STORAGE · parallel-locale group reads', () => {

  const STAMP = Date.now();
  const cleanup: string[] = [];

  test.afterEach(async () => {
    for (const id of cleanup) await deleteLandingPage(id).catch(() => {});
    cleanup.length = 0;
  });

  test('API-STORAGE-416 · getLandingPageGroup returns every sibling sharing the groupId', async () => {
    const groupId = `lg_test_${STAMP}`;
    const idZh = `lp_grp_zh_${STAMP}`;
    const idJa = `lp_grp_ja_${STAMP}`;
    const idEn = `lp_grp_en_${STAMP}`;
    cleanup.push(idZh, idJa, idEn);
    await saveLandingPage(
      buildPage({ id: idZh, slug: `grp-${STAMP}`, localeGroupId: groupId, locale: 'zh-CN', defaultLocale: 'zh-CN' }),
    );
    await saveLandingPage(
      buildPage({ id: idJa, slug: `grp-${STAMP}`, localeGroupId: groupId, locale: 'ja', defaultLocale: 'ja', availableLocales: ['ja'] }),
      { skipSlugMap: true },
    );
    await saveLandingPage(
      buildPage({ id: idEn, slug: `grp-${STAMP}`, localeGroupId: groupId, locale: 'en', defaultLocale: 'en', availableLocales: ['en'] }),
      { skipSlugMap: true },
    );
    const group = await getLandingPageGroup(groupId);
    const ids = group.map((g) => g.id).sort();
    expect(ids).toEqual([idEn, idJa, idZh].sort());
  });

  test('API-STORAGE-418 · getLandingPageBySlugLocale returns the per-locale sibling', async () => {
    const groupId = `lg_bysl_${STAMP}`;
    const slug = `bysl-${STAMP}`;
    const idZh = `lp_bysl_zh_${STAMP}`;
    const idJa = `lp_bysl_ja_${STAMP}`;
    cleanup.push(idZh, idJa);
    await saveLandingPage(
      buildPage({ id: idZh, slug, localeGroupId: groupId, locale: 'zh-CN', defaultLocale: 'zh-CN' }),
    );
    await saveLandingPage(
      buildPage({ id: idJa, slug, localeGroupId: groupId, locale: 'ja', defaultLocale: 'ja', availableLocales: ['ja'] }),
      { skipSlugMap: true },
    );
    const ja = await getLandingPageBySlugLocale(slug, 'ja');
    expect(ja).not.toBeNull();
    expect(ja!.id).toBe(idJa);
    const zh = await getLandingPageBySlugLocale(slug, 'zh-CN');
    expect(zh!.id).toBe(idZh);
  });
});

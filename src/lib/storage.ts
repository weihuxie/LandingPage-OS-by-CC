/**
 * Storage adapter.
 *
 * Runtime decision:
 *   - KV_REST_API_URL present  → Vercel KV (Redis)
 *   - otherwise                → file system at .data/ (local dev)
 *
 * All readers forward-migrate old records so schema changes don't crash
 * the editor / renderer.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { kv } from '@vercel/kv';
import type {
  Project,
  Lead,
  AssetLibrary,
  Product,
  LandingPage,
  Brand,
  PageLocale,
} from './types';
import { migrateProjectToV2, projectViewFromV2 } from './migrate-v2';
import { coerceAssetsShape } from './asset-shape';
import { StorageRequiredError } from './errors';

/**
 * CRITICAL: Detect KV availability at RUNTIME, not build time.
 *
 * Next.js webpack (DefinePlugin) replaces `process.env.KV_REST_API_URL`
 * with its build-time value — which is `undefined` because KV env vars
 * are Runtime-only (not available during `next build`).
 *
 * Fix: use bracket notation `process.env['KV_REST_API_URL']` which
 * webpack does NOT inline, so the check happens at actual request time.
 */
function useKV(): boolean {
  // eslint-disable-next-line dot-notation
  return !!process.env['KV_REST_API_URL'] && !!process.env['KV_REST_API_TOKEN'];
}

/**
 * On Vercel, `/tmp/.data` is PER-LAMBDA and ephemeral: writes succeed then
 * disappear on next cold start. The old `DATA_DIR = ... /tmp/.data` fallback
 * was a 遮羞布 — "local dev works, Vercel probably works too" — that let
 * operators deploy to prod without KV and find out days later that half
 * their data was gone. We now refuse the FS path on Vercel. Local dev
 * (VERCEL !== '1') still writes to `.data/` unchanged.
 */
function isVercel(): boolean {
  // eslint-disable-next-line dot-notation
  return process.env['VERCEL'] === '1';
}
function assertStorageOk(): void {
  if (isVercel() && !useKV()) {
    throw new StorageRequiredError();
  }
}

/**
 * Parallel-locale refactor feature flag (CLAUDE.md §四 TODO #1, 2026-04).
 *
 * When `MULTI_LOCALE_AS_INSTANCES=1`, callers that create new LandingPage
 * rows are expected to stamp `locale` + `localeGroupId` on each row so
 * `saveLandingPage` maintains the locale-group index set. When off
 * (default), new pages continue to embed every locale inside a single
 * row's `variants.{A|B}.{locale}` map and the group index stays empty.
 *
 * The storage helpers (`getLandingPageGroup`, `getLandingPageBySlugLocale`,
 * `getSiblings`) work under both shapes — they degrade gracefully when a
 * page has no `localeGroupId`, so P1 can land without changing any
 * observable behavior. P2 will add a migration script that backfills
 * groups for existing rows; P3+ will gate new-code paths on this flag.
 */
export function multiLocaleInstances(): boolean {
  // eslint-disable-next-line dot-notation
  return process.env['MULTI_LOCALE_AS_INSTANCES'] === '1';
}

// --- KV reliability helpers -------------------------------------------
//
// Root-cause context: Upstash REST KV returns transient 429/503 under
// cold-connection or rate-spike conditions. The original code used
// `Promise.all([kv.set(data), kv.sadd(index), kv.set(slug)])` — any one
// rejection killed the whole save, but previously-committed writes were
// NOT rolled back. Result: data written without index entry → `smembers`
// can never find it → dashboard shows nothing → user retries, same
// race repeats. "Only 1 product saved" = the one time all 3 writes
// happened to land cleanly.
//
// Fix: sequential writes with retry on each, data-FIRST (index entry
// can't point at nonexistent data), plus self-healing SCAN on the read
// path to repair any orphaned data that predates this fix.

async function withKVRetry<T>(
  op: () => Promise<T>,
  label: string,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await op();
    } catch (e) {
      lastErr = e;
      console.error(`[kv] ${label} attempt ${i + 1}/${maxAttempts} failed:`, e);
      if (i === maxAttempts - 1) break;
      // Exponential backoff: ~100ms, 250ms, 625ms. Jitter avoids
      // synchronized retries across concurrent saves.
      const base = Math.min(100 * Math.pow(2.5, i), 2000);
      const jittered = base * (0.75 + Math.random() * 0.5);
      await new Promise((r) => setTimeout(r, jittered));
    }
  }
  throw lastErr;
}

/**
 * Enumerate every KV key starting with `prefix` via SCAN. Used as the
 * source-of-truth for `readProducts` / `readLandingPages` so a broken
 * index set can't hide data. SCAN is incremental; we cap iterations at
 * 20 to defend against pathological response loops.
 */
async function scanKeysByPrefix(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  // Upstash scan cursor starts at 0; returns '0' when done.
  let cursor: string | number = 0;
  let iterations = 0;
  do {
    // @vercel/kv.scan wraps Upstash Redis SCAN. Signature: scan(cursor, { match, count }).
    // Returns [nextCursor, keys[]]. Count is a HINT, not a hard limit.
    const result = (await kv.scan(cursor as number, {
      match: `${prefix}*`,
      count: 500,
    })) as [string, string[]] | [number, string[]];
    const [next, batch] = result;
    if (Array.isArray(batch)) keys.push(...batch);
    cursor = next;
    iterations++;
    if (iterations > 20) {
      console.error(
        `[kv] scanKeysByPrefix(${prefix}) hit 20 iterations; truncating at ${keys.length} keys.`,
      );
      break;
    }
  } while (cursor !== '0' && cursor !== 0);
  return keys;
}

// --- Keys (shared between KV and FS layouts) ---------------------------

const KEY_PROJECTS = 'lp:projects';       // legacy v1
const KEY_LEADS = 'lp:leads';
const KEY_ASSETS = 'lp:assets';            // legacy v1 asset library
const KEY_EVENTS = 'lp:events';
const KEY_PRODUCTS = 'lp:v2:products';     // v2
const KEY_PAGES = 'lp:v2:pages';           // v2
const KEY_BRAND = 'lp:v2:brand';           // v2 (single brand per user in MVP)

// --- Tenant scoping (S2 多租户改造) ------------------------------------
//
// Pre-S2 every Product / LandingPage / Brand was stamped `ownerId:'default'`
// (no real auth enforced anywhere). After S2 we want per-tenant isolation,
// but we don't want a forced data migration before the first user logs in
// — they might never log in, in which case the existing dashboard should
// keep working unchanged.
//
// The compromise: existing 'default'-owned rows continue to live under a
// reserved tenant id named 'default' (the LEGACY_TENANT_ID below). Reads
// coerce row.ownerId → row.tenantId on the fly so the rest of the code
// only ever sees the new shape. C4 (claim mode) will, on first login,
// create a real Tenant for the user and rewrite all rows from
// LEGACY_TENANT_ID → that tenant's id, after which the legacy id is
// effectively retired.
export const LEGACY_TENANT_ID = 'default';

/**
 * Read-time coercion for v2 entities that may predate the tenantId field.
 * Old KV blobs only have `ownerId`; new ones have `tenantId`. We read both
 * and produce a single canonical `tenantId` field. Falls back to
 * LEGACY_TENANT_ID rather than throwing so half-migrated states don't
 * crash the dashboard.
 */
function coerceTenant<T extends { tenantId?: string }>(row: T | null | undefined): T | null {
  if (!row) return null;
  if (row.tenantId) return row;
  // Old shape: ownerId field. Cast away — types.ts no longer declares
  // ownerId on Product / Brand but legacy KV rows do carry it.
  const legacy = (row as unknown as { ownerId?: string }).ownerId;
  return { ...row, tenantId: legacy ?? LEGACY_TENANT_ID };
}

/**
 * Apply a tenant filter to a list. `undefined` filter returns the input
 * untouched (back-compat for callers that haven't been updated yet).
 * Coerces every row through `coerceTenant` first so legacy rows are
 * comparable.
 */
function filterByTenant<T extends { tenantId?: string }>(
  list: T[],
  tenantId: string | undefined,
): T[] {
  const coerced = list
    .map((r) => coerceTenant(r))
    .filter((r): r is T & { tenantId: string } => !!r);
  if (!tenantId) return coerced;
  return coerced.filter((r) => r.tenantId === tenantId);
}

const DEFAULT_ASSETS: AssetLibrary = {
  brand: null,
  testimonials: [],
  certifications: [],
  cases: [],
  press: [],
};

// --- Low-level adapter -------------------------------------------------

async function readRaw<T>(key: string, fallback: T): Promise<T> {
  if (useKV()) {
    const v = (await kv.get<T>(key)) as T | null;
    return v ?? fallback;
  }
  return readFs(key, fallback);
}

async function writeRaw<T>(key: string, value: T): Promise<void> {
  if (useKV()) {
    await kv.set(key, value);
    return;
  }
  await writeFs(key, value);
}

// --- Tenant claim (S2 / C4) -------------------------------------------
//
// Re-stamp every Product / LandingPage / Lead / Brand currently sitting
// under LEGACY_TENANT_ID with the given new tenant id. Idempotent — second
// call is a no-op because nothing matches LEGACY_TENANT_ID anymore.
//
// Use case: pre-S2 prod has data created without auth. The first user to
// log in + create a workspace can take ownership of that pool so the
// dashboard isn't empty for them. Subsequent users see only their own
// stuff (the legacy pool is gone).
//
// Race: if two users are mid-flight when the first claim runs, the second
// runs as a no-op (legacy data already moved). Both callers finish OK.
export async function claimLegacyData(newTenantId: string): Promise<{
  productsClaimed: number;
  pagesClaimed: number;
  leadsClaimed: number;
  brandClaimed: boolean;
}> {
  if (!newTenantId || newTenantId === LEGACY_TENANT_ID) {
    throw new Error('claimLegacyData: refusing to claim into LEGACY_TENANT_ID');
  }

  // Products
  const allProducts = await readProducts(); // unfiltered: see legacy + claimed
  const legacyProducts = allProducts.filter(
    (p) => (coerceTenant(p as any) as Product).tenantId === LEGACY_TENANT_ID,
  );
  for (const p of legacyProducts) {
    await saveProduct({ ...p, tenantId: newTenantId });
  }

  // LandingPages
  const allPages = await readLandingPages(); // unfiltered
  const legacyPages = allPages.filter(
    (pg) => (coerceTenant(pg as any) as LandingPage).tenantId === LEGACY_TENANT_ID,
  );
  for (const pg of legacyPages) {
    await saveLandingPage({ ...pg, tenantId: newTenantId });
  }

  // Leads — single blob; rewrite once
  const allLeads = (await readRaw<Lead[]>(KEY_LEADS, [])) ?? [];
  let leadsClaimed = 0;
  const updatedLeads = allLeads.map((l) => {
    const t = (l as any).tenantId ?? LEGACY_TENANT_ID;
    if (t === LEGACY_TENANT_ID) {
      leadsClaimed++;
      return { ...l, tenantId: newTenantId };
    }
    return l;
  });
  if (leadsClaimed > 0) await writeRaw(KEY_LEADS, updatedLeads);

  // Brand — copy legacy global brand to per-tenant key. Don't delete the
  // legacy key (other concurrent claimers might still be reading it; they
  // become no-ops after this call but the data stays harmless).
  const legacyBrand = await readRaw<Brand>(KEY_BRAND, DEFAULT_BRAND);
  const filled =
    legacyBrand &&
    (legacyBrand.companyName ||
      legacyBrand.logos.length ||
      legacyBrand.certifications.length);
  let brandClaimed = false;
  if (filled) {
    const claimed: Brand = { ...legacyBrand, tenantId: newTenantId };
    await writeBrand(claimed);
    brandClaimed = true;
  }

  return {
    productsClaimed: legacyProducts.length,
    pagesClaimed: legacyPages.length,
    leadsClaimed,
    brandClaimed,
  };
}

// --- FS adapter --------------------------------------------------------

// Priority: explicit DATA_DIR → /tmp on Vercel (writable, ephemeral) → project-relative .data/
// Bracket notation for VERCEL too: webpack inlines process.env.VERCEL to undefined at build time.
const DATA_DIR =
  process.env['DATA_DIR'] ??
  (process.env['VERCEL'] === '1' ? '/tmp/.data' : path.join(process.cwd(), '.data'));

function fsPath(key: string): string {
  return path.join(DATA_DIR, key.replace(/^lp:/, '') + '.json');
}

async function ensureFsDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readFs<T>(key: string, fallback: T): Promise<T> {
  assertStorageOk(); // refuse FS path on Vercel — see isVercel/useKV note
  await ensureFsDir();
  const file = fsPath(key);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeFs<T>(key: string, value: T): Promise<void> {
  assertStorageOk(); // refuse FS path on Vercel — see isVercel/useKV note
  await ensureFsDir();
  const file = fsPath(key);
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

// --- Projects ----------------------------------------------------------

export async function readProjects(): Promise<Project[]> {
  const list = (await readRaw<any[]>(KEY_PROJECTS, [])) ?? [];
  return list.map(migrate);
}

export async function writeProjects(list: Project[]): Promise<void> {
  await writeRaw(KEY_PROJECTS, list);
}

export async function getProject(id: string): Promise<Project | null> {
  const list = await readProjects();
  return list.find((p) => p.id === id) ?? null;
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const list = await readProjects();
  return list.find((p) => p.slug === slug) ?? null;
}

export async function saveProject(project: Project): Promise<Project> {
  const list = await readProjects();
  const idx = list.findIndex((p) => p.id === project.id);
  project.updatedAt = Date.now();
  if (idx === -1) list.unshift(project);
  else list[idx] = project;
  await writeProjects(list);
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  const list = await readProjects();
  await writeProjects(list.filter((p) => p.id !== id));
}

// --- Leads -------------------------------------------------------------

/**
 * List leads. Same options shape as readLandingPages — pass `tenantId`
 * to scope, `projectId` for the per-page detail view (the dashboard
 * /leads listing). Back-compat: bare-string positional arg still works.
 */
export async function readLeads(
  opts?: string | { tenantId?: string; projectId?: string },
): Promise<Lead[]> {
  const filter = typeof opts === 'string' ? { projectId: opts } : opts ?? {};
  const all = (await readRaw<Lead[]>(KEY_LEADS, [])) ?? [];
  let scoped = filterByTenant(all, filter.tenantId);
  if (filter.projectId) scoped = scoped.filter((l) => l.projectId === filter.projectId);
  return scoped;
}

export async function appendLead(lead: Lead): Promise<void> {
  const all = (await readRaw<Lead[]>(KEY_LEADS, [])) ?? [];
  all.unshift(lead);
  await writeRaw(KEY_LEADS, all);

  const list = await readProjects();
  const p = list.find((x) => x.id === lead.projectId);
  if (p) {
    p.leadCount = (p.leadCount ?? 0) + 1;
    if (lead.variant && p.abStats) {
      p.abStats[lead.variant].leads += 1;
    }
    await writeProjects(list);
  }
}

// --- Assets ------------------------------------------------------------

export async function readAssets(): Promise<AssetLibrary> {
  const raw = (await readRaw<AssetLibrary>(KEY_ASSETS, DEFAULT_ASSETS)) ?? DEFAULT_ASSETS;
  return coerceAssetsShape(raw);
}

export async function writeAssets(lib: AssetLibrary): Promise<void> {
  await writeRaw(KEY_ASSETS, lib);
}

// `coerceAssetsShape` lives in src/lib/asset-shape.ts so its pure
// coercion logic is testable without spinning up KV / fs storage. See
// that file for migration rules.

// --- Events (analytics) ------------------------------------------------

export interface PageEvent {
  id: string;
  projectId: string;
  variant?: 'A' | 'B';
  type: 'view' | 'cta_click' | 'form_submit';
  locale: string;
  country?: string;
  referrer?: string;
  createdAt: number;
}

const MAX_EVENTS = 50_000;

export async function appendEvent(ev: PageEvent): Promise<void> {
  const all = (await readRaw<PageEvent[]>(KEY_EVENTS, [])) ?? [];
  all.unshift(ev);
  if (all.length > MAX_EVENTS) all.length = MAX_EVENTS;
  await writeRaw(KEY_EVENTS, all);

  if (ev.type === 'view') {
    const list = await readProjects();
    const p = list.find((x) => x.id === ev.projectId);
    if (p) {
      p.views = (p.views ?? 0) + 1;
      if (ev.variant && p.abStats) {
        p.abStats[ev.variant].views += 1;
      }
      await writeProjects(list);
    }
  }
}

export async function readEvents(projectId?: string): Promise<PageEvent[]> {
  const all = (await readRaw<PageEvent[]>(KEY_EVENTS, [])) ?? [];
  return projectId ? all.filter((e) => e.projectId === projectId) : all;
}

// --- Migration (forward-compat) ---------------------------------------

function migrate(p: any): Project {
  const theme = p.theme ?? {};
  const styleId =
    theme.styleId ?? (theme.style === 'minimal' ? 'minimal-trust' : 'saas-modern');
  const variants = p.variants ?? { A: p.modules ?? [], B: p.modules ?? [] };
  return {
    ...p,
    activeVariant: p.activeVariant ?? 'A',
    publishMode: p.publishMode ?? 'single',
    theme: { primary: theme.primary ?? '#4861ff', styleId, secondary: theme.secondary },
    variants,
    views: p.views ?? 0,
    abStats: p.abStats ?? { A: { views: 0, leads: 0 }, B: { views: 0, leads: 0 } },
  } as Project;
}

// --- Introspection (for /api/health) ----------------------------------

export function storageBackend(): 'kv' | 'fs' {
  return useKV() ? 'kv' : 'fs';
}

// --- v2: Per-entity KV keys (race-safe) ------------------------------
//
// ARCHITECTURE FIX: Previously all pages were in ONE array at one KV key.
// Concurrent read-modify-write (two POSTs at nearly the same time) caused
// data loss: both read [A,B,C], one appends D, the other appends E,
// last writer wins → one page permanently lost.
//
// Now: each Product/LandingPage gets its own KV key.
// Index keys (sets of IDs) use Redis SADD/SMEMBERS for atomic add/remove.
// FS fallback uses the old array approach (acceptable for local dev).

const PAGE_KEY_PREFIX = 'lp:v2:page:';
const PAGE_INDEX_KEY = 'lp:v2:page-ids';
const PRODUCT_KEY_PREFIX = 'lp:v2:product:';
const PRODUCT_INDEX_KEY = 'lp:v2:product-ids';
const SLUG_MAP_KEY_PREFIX = 'lp:v2:slug:';

/**
 * SADD-indexed set of LandingPage ids that share a localeGroupId. Written
 * by `saveLandingPage` when the page declares a group; read by
 * `getLandingPageGroup` / `getSiblings`. Legacy rows without a group are
 * simply absent from every such set.
 */
const LOCALE_GROUP_KEY_PREFIX = 'lp:v2:locale-group:';

// --- Products ----------------------------------------------------------

/**
 * List products. Pass `tenantId` to scope to one tenant — required by
 * SSR pages and APIs after S2. Omit (undefined) for unscoped reads
 * (admin tools, migration scripts). Legacy rows without tenantId get
 * coerced to LEGACY_TENANT_ID before filtering.
 */
export async function readProducts(opts: { tenantId?: string } = {}): Promise<Product[]> {
  if (useKV()) {
    // SCAN is the authoritative enumeration. Key existence wins over
    // index-set membership, so orphaned writes (data committed but
    // sadd failed) still show up.
    const keys = await scanKeysByPrefix(PRODUCT_KEY_PREFIX);
    if (keys.length === 0) return [];
    const pipeline = kv.pipeline();
    for (const k of keys) pipeline.get(k);
    const results = await pipeline.exec();
    const products = (results ?? []).filter((r): r is Product => !!r);

    // Opportunistic index heal: if SCAN found IDs not in the index set,
    // `sadd` them so the next read is fast. Fire-and-forget so we don't
    // block the dashboard on a secondary repair.
    (async () => {
      try {
        const indexed = (await kv.smembers(PRODUCT_INDEX_KEY)) as string[];
        const indexedSet = new Set(indexed ?? []);
        const missing = products.map((p) => p.id).filter((id) => !indexedSet.has(id));
        if (missing.length > 0) {
          console.warn(
            `[readProducts] heal: repairing ${missing.length} orphan(s) into index:`,
            missing,
          );
          // Sequential rather than `sadd(key, ...missing)` because the
          // @vercel/kv rest-arg typing rejects plain string[] spreads
          // (wants a tuple). Heal is a rare path and `missing` is tiny in
          // practice (1-5 orphans), so the extra round-trips are fine.
          for (const id of missing) {
            await kv.sadd(PRODUCT_INDEX_KEY, id);
          }
        }
      } catch (e) {
        console.error('[readProducts] heal failed:', e);
      }
    })();

    return filterByTenant(products, opts.tenantId);
  }
  const list = await readFs<Product[]>(KEY_PRODUCTS, []);
  return filterByTenant(list, opts.tenantId);
}

export async function writeProducts(list: Product[]): Promise<void> {
  // FS only (legacy compat)
  await writeFs(KEY_PRODUCTS, list);
}

export async function getProduct(id: string): Promise<Product | null> {
  if (useKV()) {
    return coerceTenant(await kv.get<Product>(PRODUCT_KEY_PREFIX + id));
  }
  const list = await readFs<Product[]>(KEY_PRODUCTS, []);
  return coerceTenant(list.find((p) => p.id === id) ?? null);
}

export async function saveProduct(product: Product): Promise<Product> {
  product.updatedAt = Date.now();
  if (useKV()) {
    // Data first, index second. If data write fails → throw, nothing
    // committed. If index write fails after N retries → throw, but the
    // read path's SCAN will find the orphaned product and self-heal the
    // index. Either way, the dashboard stays consistent instead of
    // silently hiding the record.
    await withKVRetry(
      () => kv.set(PRODUCT_KEY_PREFIX + product.id, product),
      `saveProduct:${product.id}:set`,
    );
    await withKVRetry(
      () => kv.sadd(PRODUCT_INDEX_KEY, product.id),
      `saveProduct:${product.id}:sadd`,
    );
    return product;
  }
  const list = await readFs<Product[]>(KEY_PRODUCTS, []);
  const idx = list.findIndex((p) => p.id === product.id);
  if (idx === -1) list.unshift(product);
  else list[idx] = product;
  await writeFs(KEY_PRODUCTS, list);
  return product;
}

export async function deleteProductAndPages(id: string): Promise<void> {
  const pages = await readLandingPages(id);
  for (const pg of pages) await deleteLandingPage(pg.id);
  if (useKV()) {
    await kv.del(PRODUCT_KEY_PREFIX + id);
    await kv.srem(PRODUCT_INDEX_KEY, id);
  } else {
    const list = await readFs<Product[]>(KEY_PRODUCTS, []);
    await writeFs(KEY_PRODUCTS, list.filter((p) => p.id !== id));
  }
}

// --- Landing Pages -----------------------------------------------------

/**
 * List landing pages. Two filters available:
 *   - `tenantId` for cross-product tenant scoping (dashboard / API)
 *   - `productId` for the existing product-detail use case
 * Both can combine. Legacy LandingPage rows lack tenantId — coerced to
 * LEGACY_TENANT_ID by `coerceTenant`. Backward-compat: `readLandingPages(id)`
 * positional call still works (string is treated as productId).
 */
export async function readLandingPages(
  opts?: string | { tenantId?: string; productId?: string },
): Promise<LandingPage[]> {
  // Back-compat: callers that pass `productId` as a positional string
  // continue to work. New callers should pass an options object.
  const filter =
    typeof opts === 'string' ? { productId: opts } : opts ?? {};

  if (useKV()) {
    // SCAN as source of truth; see readProducts() comment.
    const keys = await scanKeysByPrefix(PAGE_KEY_PREFIX);
    if (keys.length === 0) return [];
    const pipeline = kv.pipeline();
    for (const k of keys) pipeline.get(k);
    const results = await pipeline.exec();
    const all = (results ?? []).filter((r): r is LandingPage => !!r);

    // Opportunistic heal: repair index set from scanned reality.
    (async () => {
      try {
        const indexed = (await kv.smembers(PAGE_INDEX_KEY)) as string[];
        const indexedSet = new Set(indexed ?? []);
        const missing = all.map((p) => p.id).filter((id) => !indexedSet.has(id));
        if (missing.length > 0) {
          console.warn(
            `[readLandingPages] heal: repairing ${missing.length} orphan(s) into index:`,
            missing,
          );
          // Sequential — see saveProduct heal for rationale.
          for (const id of missing) {
            await kv.sadd(PAGE_INDEX_KEY, id);
          }
        }
      } catch (e) {
        console.error('[readLandingPages] heal failed:', e);
      }
    })();

    let scoped = filterByTenant(all, filter.tenantId);
    if (filter.productId) scoped = scoped.filter((p) => p.productId === filter.productId);
    return scoped;
  }
  const list = (await readFs<LandingPage[]>(KEY_PAGES, [])) ?? [];
  let scoped = filterByTenant(list, filter.tenantId);
  if (filter.productId) scoped = scoped.filter((p) => p.productId === filter.productId);
  return scoped;
}

export async function writeLandingPages(list: LandingPage[]): Promise<void> {
  // FS only (for migration compat). KV uses per-key writes.
  await writeFs(KEY_PAGES, list);
}

export async function getLandingPage(id: string): Promise<LandingPage | null> {
  if (useKV()) {
    return coerceTenant(await kv.get<LandingPage>(PAGE_KEY_PREFIX + id));
  }
  const list = await readFs<LandingPage[]>(KEY_PAGES, []);
  return coerceTenant(list.find((p) => p.id === id) ?? null);
}

export async function getLandingPageBySlug(slug: string): Promise<LandingPage | null> {
  if (useKV()) {
    // Fast path: slug→id map.
    const id = await kv.get<string>(SLUG_MAP_KEY_PREFIX + slug);
    if (id) {
      const hit = await getLandingPage(id);
      if (hit) return hit;
      // Stale pointer — falls through to scan. Happens when the slug-map
      // still points at a row that's been deleted (e.g. sibling delete
      // without survivor handoff, or the narrow race between
      // deleteLandingPage's slug-map del and a surviving sibling's next
      // save reclaiming ownership). Without this fall-through /p/[slug]
      // would 404 even when a live sibling on the same slug exists.
    }
    const all = await readLandingPages();
    return all.find((p) => p.slug === slug) ?? null;
  }
  const list = await readFs<LandingPage[]>(KEY_PAGES, []);
  return list.find((p) => p.slug === slug) ?? null;
}

/**
 * Save options.
 *
 *   skipSlugMap — don't write the `lp:v2:slug:<slug> -> id` pointer. Set
 *                 by non-primary siblings during parallel-locale migration:
 *                 N siblings share the same slug, and only the primary
 *                 (locale === page.defaultLocale) should own the slug-map
 *                 pointer. Without this, each subsequent sibling save
 *                 overwrites the primary's pointer and `getLandingPageBySlug`
 *                 starts returning random sibling rows instead of the
 *                 canonical one.
 */
export interface SaveLandingPageOpts {
  skipSlugMap?: boolean;
}

export async function saveLandingPage(
  page: LandingPage,
  opts: SaveLandingPageOpts = {},
): Promise<LandingPage> {
  page.updatedAt = Date.now();
  if (useKV()) {
    // Was: Promise.all([set(data), sadd(index), set(slug)]) — any rejection
    // killed the entire save but let previously-committed writes stand,
    // producing orphaned data the dashboard couldn't see.
    //
    // Now: strict sequence, each step retries 3x with jittered backoff.
    //   1. DATA — must succeed. If this throws, caller sees real error.
    //   2. INDEX — retries; if still fails throw (but read path SCAN
    //      self-heals on next dashboard load).
    //   3. SLUG MAP — best-effort; slug lookups fall back to scan if
    //      the map is stale, so we log and swallow rather than poison
    //      the whole save over a secondary index. Skipped entirely when
    //      `opts.skipSlugMap` is set (non-primary sibling writes).
    //   4. LOCALE GROUP — best-effort too; only written when the page
    //      carries a `localeGroupId`. `getLandingPageGroup` degrades
    //      gracefully (empty list) if this set is out of sync.
    await withKVRetry(
      () => kv.set(PAGE_KEY_PREFIX + page.id, page),
      `saveLandingPage:${page.id}:set`,
    );
    await withKVRetry(
      () => kv.sadd(PAGE_INDEX_KEY, page.id),
      `saveLandingPage:${page.id}:sadd`,
    );
    if (!opts.skipSlugMap) {
      try {
        // Ownership check before write. Non-primary siblings should pass
        // `skipSlugMap: true` explicitly, but forgetful callers that don't
        // would — under the old blind-overwrite behavior — silently seize
        // the slug-map from a live primary, making /p/[slug] resolve to
        // whichever sibling last saved. Decision table:
        //   · no owner        → claim it.
        //   · self            → idempotent refresh.
        //   · stale owner     → take over (holder row is gone).
        //   · live other      → skip + loud warn so the caller learns.
        const currentOwner = await kv.get<string>(SLUG_MAP_KEY_PREFIX + page.slug);
        let shouldWrite = true;
        if (currentOwner && currentOwner !== page.id) {
          const holder = await kv.get<LandingPage>(PAGE_KEY_PREFIX + currentOwner);
          if (holder) shouldWrite = false;
        }
        if (shouldWrite) {
          await withKVRetry(
            () => kv.set(SLUG_MAP_KEY_PREFIX + page.slug, page.id),
            `saveLandingPage:${page.id}:slug-map`,
          );
        } else {
          console.warn(
            `[saveLandingPage] slug=${page.slug} already owned by live page ${currentOwner}; ` +
              `skipping slug-map write for ${page.id} (pass skipSlugMap:true to silence).`,
          );
        }
      } catch (e) {
        console.error(
          `[saveLandingPage] slug-map write failed for ${page.slug}; /p/${page.slug} will use scan fallback:`,
          e,
        );
      }
    }
    if (page.localeGroupId) {
      try {
        await withKVRetry(
          () => kv.sadd(LOCALE_GROUP_KEY_PREFIX + page.localeGroupId, page.id),
          `saveLandingPage:${page.id}:locale-group`,
        );
      } catch (e) {
        console.error(
          `[saveLandingPage] locale-group SADD failed for group=${page.localeGroupId} page=${page.id}; getSiblings may miss this row until next save:`,
          e,
        );
      }
    }
    return page;
  }
  const list = await readFs<LandingPage[]>(KEY_PAGES, []);
  const idx = list.findIndex((p) => p.id === page.id);
  if (idx === -1) list.unshift(page);
  else list[idx] = page;
  await writeFs(KEY_PAGES, list);
  return page;
}

export async function deleteLandingPage(id: string): Promise<void> {
  if (useKV()) {
    const page = await getLandingPage(id);

    // Slug-map handling for parallel-locale siblings.
    //
    // Legacy assumption: every page owns its slug 1:1, so deletion should
    // also drop the slug-map pointer. That's wrong the moment siblings
    // share a slug — dropping the pointer on a non-owning sibling delete
    // is harmless (scan fallback still resolves), but dropping it on the
    // owning sibling delete when survivors exist makes every remaining
    // sibling lose its canonical URL until their next save.
    //
    // Policy:
    //   · page owns slug-map AND survivors exist
    //        → hand off pointer to the oldest survivor; no del.
    //   · page owns slug-map AND no survivors
    //        → del (nothing left to resolve).
    //   · page does not own slug-map
    //        → leave the pointer alone; whichever live sibling currently
    //          owns it keeps owning it.
    let slugMapOp: Promise<unknown> = Promise.resolve();
    if (page) {
      const currentOwner = await kv.get<string>(SLUG_MAP_KEY_PREFIX + page.slug);
      const ownsSlugMap = currentOwner === id;
      if (ownsSlugMap) {
        let survivors: LandingPage[] = [];
        if (page.localeGroupId) {
          const group = await getLandingPageGroup(page.localeGroupId);
          survivors = group.filter((s) => s.id !== id);
        }
        if (survivors.length > 0) {
          const handoff = [...survivors].sort((a, b) => a.createdAt - b.createdAt)[0];
          slugMapOp = kv.set(SLUG_MAP_KEY_PREFIX + page.slug, handoff.id);
        } else {
          slugMapOp = kv.del(SLUG_MAP_KEY_PREFIX + page.slug);
        }
      }
    }

    await Promise.all([
      kv.del(PAGE_KEY_PREFIX + id),
      kv.srem(PAGE_INDEX_KEY, id),
      slugMapOp,
      page?.localeGroupId
        ? kv.srem(LOCALE_GROUP_KEY_PREFIX + page.localeGroupId, id)
        : Promise.resolve(),
    ]);
    return;
  }
  const list = await readFs<LandingPage[]>(KEY_PAGES, []);
  await writeFs(KEY_PAGES, list.filter((p) => p.id !== id));
}

// --- Parallel-locale sibling queries ---------------------------------
//
// These helpers are the read side of the parallel-locale refactor. They
// work correctly regardless of the MULTI_LOCALE_AS_INSTANCES flag:
//   - when the group index set is populated, they resolve siblings via
//     SMEMBERS + pipelined GETs;
//   - when a page has no groupId (legacy row or flag off), they return a
//     single-element list containing just the page itself, so callers
//     can iterate unconditionally.
//
// Writing callers (localize / delete-locale / per-sibling deploy) land in
// P3–P5. P1 only introduces the reads + `saveLandingPage` index
// bookkeeping so old hot paths keep producing legacy-shaped rows.

/**
 * Load every sibling row that shares the given group id. Returns `[]`
 * when the group is empty or every member key has been deleted out from
 * under the index. Callers should treat the empty list as "no group /
 * fall back to primary row".
 *
 * fs mode (local dev, no KV): scan the single pages.json blob for rows
 * whose `localeGroupId` matches. Originally this branch returned `[]`
 * unconditionally — the "P1 graceful degrade" — which made the entire
 * parallel-locale path untestable without KV and caused DELETE /POST
 * against siblings to 400 "no sibling found" in dev. Scanning the list
 * is cheap (writeFs already re-reads + re-writes the whole blob every
 * save) and restores correct behavior across both backends.
 */
export async function getLandingPageGroup(groupId: string): Promise<LandingPage[]> {
  if (useKV()) {
    const raw = (await kv.smembers(LOCALE_GROUP_KEY_PREFIX + groupId)) as string[] | null;
    const ids = raw ?? [];
    if (ids.length === 0) return [];
    const pipeline = kv.pipeline();
    for (const id of ids) pipeline.get(PAGE_KEY_PREFIX + id);
    const results = await pipeline.exec();
    return (results ?? []).filter((r): r is LandingPage => !!r);
  }
  const list = await readFs<LandingPage[]>(KEY_PAGES, []);
  return list.filter((p) => p.localeGroupId === groupId);
}

/**
 * Resolve a (slug, locale) pair to the specific sibling row that owns
 * that locale. Designed for the P3 route `/p/[slug]/[locale]`.
 *
 * Resolution order:
 *   1. Look up the slug — if missing, return null.
 *   2. If the resolved row has no groupId (legacy / flag off), return it
 *      as-is; the caller still has to pick the locale at render time
 *      from the multi-locale variants map. Callers that strictly require
 *      one-row-per-locale should check `page.locale === locale` themselves.
 *   3. If the resolved row already matches the requested locale, short-circuit.
 *   4. Otherwise, walk the group and return whichever sibling owns the locale,
 *      or null when no sibling matches.
 */
export async function getLandingPageBySlugLocale(
  slug: string,
  locale: PageLocale,
): Promise<LandingPage | null> {
  const page = await getLandingPageBySlug(slug);
  if (!page) return null;
  if (!page.localeGroupId) return page;
  if (page.locale === locale) return page;
  const siblings = await getLandingPageGroup(page.localeGroupId);
  return siblings.find((s) => s.locale === locale) ?? null;
}

/**
 * All sibling rows of `page`, including itself. Legacy rows without a
 * group return `[page]` so callers can iterate without null-checking the
 * group id. When the group exists but somehow failed to include `page`
 * (index drift), `page` is appended defensively so the caller never sees
 * a set that excludes its own input.
 */
export async function getSiblings(page: LandingPage): Promise<LandingPage[]> {
  if (!page.localeGroupId) return [page];
  const all = await getLandingPageGroup(page.localeGroupId);
  if (all.length === 0) return [page];
  return all.some((s) => s.id === page.id) ? all : [...all, page];
}

const DEFAULT_BRAND: Brand = {
  tenantId: LEGACY_TENANT_ID,
  updatedAt: 0,
  companyName: '',
  logos: [],
  primaryColor: '#4861ff',
  certifications: [],
  press: [],
  sharedCases: [],
};

/**
 * Read the Brand for a tenant. Pre-S2 there was a single global Brand
 * stored under `lp:v2:brand`; this still works (legacy callers omit
 * `tenantId`). When a tenant id is provided, the per-tenant key
 * `lp:v2:brand:<tenantId>` is preferred and the legacy global key is the
 * fallback, so the dashboard works during the transition window before
 * any tenant has saved their own Brand.
 */
export async function readBrand(opts: { tenantId?: string } = {}): Promise<Brand> {
  if (opts.tenantId && opts.tenantId !== LEGACY_TENANT_ID) {
    const scoped = await readRaw<Brand>(`${KEY_BRAND}:${opts.tenantId}`, DEFAULT_BRAND);
    // If the per-tenant key has data (companyName / logos / etc), return
    // it; otherwise fall back to the global brand so legacy data shows up
    // until the tenant explicitly overrides.
    const filled = scoped && (scoped.companyName || scoped.logos.length || scoped.certifications.length);
    if (filled) return coerceTenant(scoped) ?? DEFAULT_BRAND;
  }
  const legacy = await readRaw<Brand>(KEY_BRAND, DEFAULT_BRAND);
  return coerceTenant(legacy ?? DEFAULT_BRAND) ?? DEFAULT_BRAND;
}

export async function writeBrand(brand: Brand): Promise<void> {
  brand.updatedAt = Date.now();
  // Per-tenant key when the brand carries a non-legacy tenantId; otherwise
  // continue writing to the global key so legacy dashboards keep working.
  if (brand.tenantId && brand.tenantId !== LEGACY_TENANT_ID) {
    await writeRaw(`${KEY_BRAND}:${brand.tenantId}`, brand);
    return;
  }
  await writeRaw(KEY_BRAND, brand);
}

// --- v1 -> v2 migration (RUN-ONCE) -----------------------------------

const KEY_MIGRATION_DONE = 'lp:v2:migration-done';

/**
 * Migrate legacy Project records into Product+LandingPage.
 *
 * CRITICAL SAFETY: This function previously ran lazily on every read.
 * That caused a catastrophic data loss bug: during Vercel deploys, KV reads
 * sometimes returned empty (timeout/cold start), migration thought "no v2
 * data exists", re-created 3 old migrated pages, and OVERWROTE the 7 real
 * pages the user had created. 4 pages permanently lost.
 *
 * Now: runs ONLY when explicitly called (e.g. a one-time admin action),
 * and sets a flag so it never runs again. Also refuses to write if it
 * would reduce the total number of records.
 */
async function ensureV2MigrationRun(): Promise<void> {
  // Check done flag — once set, never run again
  const done = await readRaw<boolean>(KEY_MIGRATION_DONE, false);
  if (done) return;

  const [products, pages, legacy] = await Promise.all([
    readProducts(),
    readLandingPages(),
    readRaw<any[]>(KEY_PROJECTS, []),
  ]);

  const existingPageIds = new Set(pages.map((p) => p.id));
  const toMigrate = (legacy ?? []).filter((p) => !existingPageIds.has(p.id));
  if (toMigrate.length === 0) {
    // Nothing to migrate — mark as done so we don't keep checking
    await writeRaw(KEY_MIGRATION_DONE, true);
    return;
  }

  const newProducts = [...products];
  const newPages = [...pages];
  for (const old of toMigrate) {
    const { product, page } = migrateProjectToV2(old);
    newProducts.unshift(product);
    newPages.unshift(page);
  }

  // DATA LOSS GUARD: refuse to write if we'd end up with fewer records
  if (newPages.length < pages.length) {
    console.error(
      `[migration] ABORT: would reduce pages from ${pages.length} to ${newPages.length}. ` +
      `This is the data-loss bug. Skipping write.`,
    );
    return;
  }

  await Promise.all([
    writeProducts(newProducts),
    writeLandingPages(newPages),
    writeRaw(KEY_MIGRATION_DONE, true), // mark done
  ]);
}

/**
 * Public entry for migration. Now safe to call many times (no-op after first).
 * Removed from all hot read paths; only called explicitly.
 */
export async function ensureMigrated(): Promise<void> {
  try {
    await ensureV2MigrationRun();
  } catch {
    // Non-fatal
  }
}

// --- Compat shim: old /api/projects/... API -------------------------

/**
 * Read a "project-shaped" object from v2 storage.
 * Used by legacy /api/projects/:id endpoints so the old editor keeps
 * working on new data without duplicate writes.
 */
export async function getProjectCompat(id: string): Promise<Project | null> {
  const page = await getLandingPage(id);
  if (!page) return null;
  const product = await getProduct(page.productId);
  if (!product) return null;
  return projectViewFromV2(page, product);
}

export async function getProjectBySlugCompat(slug: string): Promise<Project | null> {
  const page = await getLandingPageBySlug(slug);
  if (!page) return null;
  const product = await getProduct(page.productId);
  if (!product) return null;
  return projectViewFromV2(page, product);
}

export async function listProjectsCompat(): Promise<Project[]> {
  const [pages, products] = await Promise.all([readLandingPages(), readProducts()]);
  const byId = new Map(products.map((p) => [p.id, p]));
  return pages
    .map((pg) => {
      const pr = byId.get(pg.productId);
      return pr ? projectViewFromV2(pg, pr) : null;
    })
    .filter((p): p is Project => !!p);
}

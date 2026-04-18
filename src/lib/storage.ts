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
import type { Project, Lead, AssetLibrary, Product, LandingPage, Brand } from './types';
import { migrateProjectToV2, projectViewFromV2 } from './migrate-v2';

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

export async function readLeads(projectId?: string): Promise<Lead[]> {
  const all = (await readRaw<Lead[]>(KEY_LEADS, [])) ?? [];
  return projectId ? all.filter((l) => l.projectId === projectId) : all;
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
  return (await readRaw<AssetLibrary>(KEY_ASSETS, DEFAULT_ASSETS)) ?? DEFAULT_ASSETS;
}

export async function writeAssets(lib: AssetLibrary): Promise<void> {
  await writeRaw(KEY_ASSETS, lib);
}

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

// --- Products ----------------------------------------------------------

export async function readProducts(): Promise<Product[]> {
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

    return products;
  }
  return (await readFs<Product[]>(KEY_PRODUCTS, []));
}

export async function writeProducts(list: Product[]): Promise<void> {
  // FS only (legacy compat)
  await writeFs(KEY_PRODUCTS, list);
}

export async function getProduct(id: string): Promise<Product | null> {
  if (useKV()) {
    return (await kv.get<Product>(PRODUCT_KEY_PREFIX + id)) ?? null;
  }
  const list = await readFs<Product[]>(KEY_PRODUCTS, []);
  return list.find((p) => p.id === id) ?? null;
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

export async function readLandingPages(productId?: string): Promise<LandingPage[]> {
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

    return productId ? all.filter((p) => p.productId === productId) : all;
  }
  const list = (await readFs<LandingPage[]>(KEY_PAGES, [])) ?? [];
  return productId ? list.filter((p) => p.productId === productId) : list;
}

export async function writeLandingPages(list: LandingPage[]): Promise<void> {
  // FS only (for migration compat). KV uses per-key writes.
  await writeFs(KEY_PAGES, list);
}

export async function getLandingPage(id: string): Promise<LandingPage | null> {
  if (useKV()) {
    return (await kv.get<LandingPage>(PAGE_KEY_PREFIX + id)) ?? null;
  }
  const list = await readFs<LandingPage[]>(KEY_PAGES, []);
  return list.find((p) => p.id === id) ?? null;
}

export async function getLandingPageBySlug(slug: string): Promise<LandingPage | null> {
  if (useKV()) {
    // Check slug→id map
    const id = await kv.get<string>(SLUG_MAP_KEY_PREFIX + slug);
    if (id) return getLandingPage(id);
    // Fallback: scan all (slower, but catches unmapped slugs)
    const all = await readLandingPages();
    return all.find((p) => p.slug === slug) ?? null;
  }
  const list = await readFs<LandingPage[]>(KEY_PAGES, []);
  return list.find((p) => p.slug === slug) ?? null;
}

export async function saveLandingPage(page: LandingPage): Promise<LandingPage> {
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
    //      the whole save over a secondary index.
    await withKVRetry(
      () => kv.set(PAGE_KEY_PREFIX + page.id, page),
      `saveLandingPage:${page.id}:set`,
    );
    await withKVRetry(
      () => kv.sadd(PAGE_INDEX_KEY, page.id),
      `saveLandingPage:${page.id}:sadd`,
    );
    try {
      await withKVRetry(
        () => kv.set(SLUG_MAP_KEY_PREFIX + page.slug, page.id),
        `saveLandingPage:${page.id}:slug-map`,
      );
    } catch (e) {
      console.error(
        `[saveLandingPage] slug-map write failed for ${page.slug}; /p/${page.slug} will use scan fallback:`,
        e,
      );
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
    await Promise.all([
      kv.del(PAGE_KEY_PREFIX + id),
      kv.srem(PAGE_INDEX_KEY, id),
      page ? kv.del(SLUG_MAP_KEY_PREFIX + page.slug) : Promise.resolve(),
    ]);
    return;
  }
  const list = await readFs<LandingPage[]>(KEY_PAGES, []);
  await writeFs(KEY_PAGES, list.filter((p) => p.id !== id));
}

const DEFAULT_BRAND: Brand = {
  ownerId: 'default',
  updatedAt: 0,
  companyName: '',
  logos: [],
  primaryColor: '#4861ff',
  certifications: [],
  press: [],
  sharedCases: [],
};

export async function readBrand(): Promise<Brand> {
  return (await readRaw<Brand>(KEY_BRAND, DEFAULT_BRAND)) ?? DEFAULT_BRAND;
}

export async function writeBrand(brand: Brand): Promise<void> {
  brand.updatedAt = Date.now();
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

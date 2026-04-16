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

// --- v2: Product / LandingPage / Brand -------------------------------

export async function readProducts(): Promise<Product[]> {
  const list = (await readRaw<Product[]>(KEY_PRODUCTS, [])) ?? [];
  return list;
}

export async function writeProducts(list: Product[]): Promise<void> {
  await writeRaw(KEY_PRODUCTS, list);
}

export async function getProduct(id: string): Promise<Product | null> {
  const list = await readProducts();
  return list.find((p) => p.id === id) ?? null;
}

export async function saveProduct(product: Product): Promise<Product> {
  const list = await readProducts();
  const idx = list.findIndex((p) => p.id === product.id);
  product.updatedAt = Date.now();
  if (idx === -1) list.unshift(product);
  else list[idx] = product;
  await writeProducts(list);
  return product;
}

export async function deleteProductAndPages(id: string): Promise<void> {
  const products = await readProducts();
  const pages = await readLandingPages();
  await writeProducts(products.filter((p) => p.id !== id));
  await writeLandingPages(pages.filter((pg) => pg.productId !== id));
}

export async function readLandingPages(productId?: string): Promise<LandingPage[]> {
  const list = (await readRaw<LandingPage[]>(KEY_PAGES, [])) ?? [];
  return productId ? list.filter((p) => p.productId === productId) : list;
}

export async function writeLandingPages(list: LandingPage[]): Promise<void> {
  await writeRaw(KEY_PAGES, list);
}

export async function getLandingPage(id: string): Promise<LandingPage | null> {
  const list = await readLandingPages();
  return list.find((p) => p.id === id) ?? null;
}

export async function getLandingPageBySlug(slug: string): Promise<LandingPage | null> {
  const list = await readLandingPages();
  return list.find((p) => p.slug === slug) ?? null;
}

export async function saveLandingPage(page: LandingPage): Promise<LandingPage> {
  const list = await readLandingPages();
  const idx = list.findIndex((p) => p.id === page.id);
  page.updatedAt = Date.now();
  if (idx === -1) list.unshift(page);
  else list[idx] = page;
  await writeLandingPages(list);
  return page;
}

export async function deleteLandingPage(id: string): Promise<void> {
  const pages = await readLandingPages();
  await writeLandingPages(pages.filter((p) => p.id !== id));
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

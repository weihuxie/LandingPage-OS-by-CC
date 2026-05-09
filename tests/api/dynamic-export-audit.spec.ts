/**
 * API-DYNAMIC-* · Static audit of `force-dynamic` + `revalidate=0` + `noStore()`.
 *
 * CLAUDE.md §1.4 + §1.4.1 lock the rule:
 *   - Every API route handler that reads KV (or any storage that goes
 *     through @vercel/kv → fetch()) must declare:
 *       export const dynamic = 'force-dynamic';
 *       export const revalidate = 0;
 *   - Every SSR page that reads storage must additionally call
 *     `unstable_noStore as noStore; noStore();` at the top of the
 *     server component (belt-and-suspenders against Data Cache).
 *
 * Without these, Next.js 14 will:
 *   1. Pre-render GET handlers at build time (read returns build-time
 *      snapshot of KV).
 *   2. Cache fetch() responses inside route handlers / RSCs (KV reads
 *      pinned to first call's result for ~5min until revalidation).
 *
 * Scope of this audit:
 *   - 401: GET-handler routes with storage import → require force-dynamic
 *   - 402: GET-handler routes with storage import → require revalidate=0
 *   - 403: SSR pages with storage import → require all 3 (dynamic +
 *          revalidate + noStore call)
 *
 * POST-only routes are NOT required to set `revalidate=0` because POST
 * handlers don't pre-render and Next.js's fetch-Data-Cache aggressiveness
 * is geared toward GET/RSC paths. They're scanned but not asserted on
 * the revalidate axis.
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const API_ROOT = path.join(REPO_ROOT, 'src/app/api');
const SSR_ROOT = path.join(REPO_ROOT, 'src/app/[locale]');

interface RouteFile {
  /** Repo-relative path for human-readable failure messages. */
  rel: string;
  abs: string;
  content: string;
}

/** Recursively find every file under `dir` matching `predicate`. */
async function walk(dir: string, predicate: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(full, predicate)));
    } else if (predicate(e.name)) {
      out.push(full);
    }
  }
  return out;
}

async function loadFiles(dir: string, predicate: (name: string) => boolean): Promise<RouteFile[]> {
  const abs = await walk(dir, predicate);
  return Promise.all(
    abs.map(async (a) => ({
      abs: a,
      rel: path.relative(REPO_ROOT, a),
      content: await fs.readFile(a, 'utf8'),
    })),
  );
}

/**
 * The route imports something that ultimately reads from KV / Vercel KV
 * via fetch(). We treat any storage / auth-storage / storage-access
 * import as "this handler touches Data-Cache-able fetch()". Plus the
 * direct `@vercel/kv` import for any straggler that talks to KV without
 * going through our wrappers.
 */
function importsStorage(content: string): boolean {
  return (
    /from\s+['"]@\/lib\/storage['"]/.test(content) ||
    /from\s+['"]@\/lib\/auth-storage['"]/.test(content) ||
    /from\s+['"]@\/lib\/storage-access['"]/.test(content) ||
    /from\s+['"]@vercel\/kv['"]/.test(content)
  );
}

/** Substring check for the literal export. Done as regex with optional whitespace. */
function hasForceDynamic(content: string): boolean {
  return /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(content);
}

function hasRevalidateZero(content: string): boolean {
  return /export\s+const\s+revalidate\s*=\s*0\b/.test(content);
}

function hasNoStoreCall(content: string): boolean {
  // Two variants seen in the codebase:
  //   import { unstable_noStore as noStore } from 'next/cache'; ... noStore();
  //   import { unstable_noStore } from 'next/cache'; ... unstable_noStore();
  return (
    /unstable_noStore/.test(content) &&
    /(?:^|\W)(?:noStore|unstable_noStore)\s*\(\s*\)/m.test(content)
  );
}

/** Source has `export async function GET(...)` somewhere. */
function hasGETHandler(content: string): boolean {
  return /export\s+async\s+function\s+GET\b/.test(content);
}

test.describe('API-DYNAMIC · static audit (CLAUDE.md §1.4 + §1.4.1)', () => {

  test('API-DYNAMIC-401 · GET routes reading storage declare force-dynamic', async () => {
    const routes = await loadFiles(API_ROOT, (n) => n === 'route.ts');
    expect(routes.length).toBeGreaterThan(20); // sanity: we scanned the tree

    const violators = routes
      .filter((r) => importsStorage(r.content) && hasGETHandler(r.content) && !hasForceDynamic(r.content))
      .map((r) => r.rel);

    expect(
      violators,
      `Routes with GET handler + storage import are missing 'export const dynamic = "force-dynamic"':\n  - ${violators.join('\n  - ')}\n` +
        'Add it to defeat Next.js static prerender. See CLAUDE.md §1.4.',
    ).toEqual([]);
  });

  test('API-DYNAMIC-402 · GET routes reading storage declare revalidate=0', async () => {
    const routes = await loadFiles(API_ROOT, (n) => n === 'route.ts');

    const violators = routes
      .filter((r) => importsStorage(r.content) && hasGETHandler(r.content) && !hasRevalidateZero(r.content))
      .map((r) => r.rel);

    expect(
      violators,
      `Routes with GET handler + storage import are missing 'export const revalidate = 0':\n  - ${violators.join('\n  - ')}\n` +
        "Without it, Next.js's Data Cache pins inner fetch() responses (KV reads) " +
        'for ~5min. CLAUDE.md §1.4.1 details a real prod incident from this exact gap.',
    ).toEqual([]);
  });

  test('API-DYNAMIC-403 · SSR pages reading storage have force-dynamic + revalidate=0 + noStore()', async () => {
    const pages = await loadFiles(SSR_ROOT, (n) => n === 'page.tsx');
    expect(pages.length).toBeGreaterThan(0);

    const missingDynamic: string[] = [];
    const missingRevalidate: string[] = [];
    const missingNoStore: string[] = [];

    for (const p of pages) {
      if (!importsStorage(p.content)) continue;
      if (!hasForceDynamic(p.content)) missingDynamic.push(p.rel);
      if (!hasRevalidateZero(p.content)) missingRevalidate.push(p.rel);
      if (!hasNoStoreCall(p.content)) missingNoStore.push(p.rel);
    }

    expect(
      missingDynamic,
      `SSR pages reading storage missing 'export const dynamic = "force-dynamic"':\n  - ${missingDynamic.join('\n  - ')}`,
    ).toEqual([]);

    expect(
      missingRevalidate,
      `SSR pages reading storage missing 'export const revalidate = 0':\n  - ${missingRevalidate.join('\n  - ')}`,
    ).toEqual([]);

    expect(
      missingNoStore,
      `SSR pages reading storage missing 'unstable_noStore as noStore; noStore();' (belt-and-suspenders against Data Cache):\n  - ${missingNoStore.join('\n  - ')}`,
    ).toEqual([]);
  });
});

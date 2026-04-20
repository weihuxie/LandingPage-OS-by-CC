import { NextRequest, NextResponse } from 'next/server';
import { getLandingPage, saveLandingPage, getProduct } from '@/lib/storage';
import { hydrateModulesViaClaude } from '@/lib/ai';
import { reportHeroTemplate } from '@/lib/template-detection';
import {
  errorResponse,
  LLMRequiredError,
  LLMCallError,
  StorageRequiredError,
} from '@/lib/errors';
import type { PageLocale } from '@/lib/types';

export const dynamic = 'force-dynamic';
// 5 parallel Claude calls inside hydrateModulesViaClaude (+ one retry per
// type that matches a template fingerprint). Slow path ≈ 15-20s; we set
// 60s so Vercel's Hobby 10s default doesn't kill the Lambda mid-hydrate.
export const maxDuration = 60;

/**
 * One-click re-hydrate for a page whose modules are still template copy.
 *
 * Why this endpoint exists: after the fig-leaf cleanup (Phases A-J), a
 * page can land in the editor with `page.hydrationFailed = true` when
 * Claude wasn't configured at create time. The user fixes their
 * `ANTHROPIC_API_KEY` and comes back — but per-module "regenerate" forces
 * them to click 5 times (hero / pain / benefits / solution / cta), wait
 * through 5 serial spinners, and track which they've done. This endpoint
 * runs the same `hydrateModulesViaClaude` pipeline the wizard's initial
 * save uses: 5 parallel calls + template-fingerprint post-validation +
 * targeted retry, all in one request.
 *
 * Body (optional):
 *   { locale?: PageLocale; allLocales?: boolean }
 *   - no body / locale omitted  → hydrate `page.defaultLocale`
 *   - { locale: 'ja' }          → hydrate that specific locale only
 *   - { allLocales: true }      → hydrate every locale in `availableLocales`
 *                                  (sequential, one full hydrate each —
 *                                  keeps Claude prompt-cache hot across
 *                                  the batch while avoiding the 10x
 *                                  parallel-request rate surge)
 */
export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    return await postImpl(req, ctx);
  } catch (e) {
    if (
      e instanceof LLMRequiredError ||
      e instanceof LLMCallError ||
      e instanceof StorageRequiredError
    ) {
      const { status, body } = errorResponse(e);
      return NextResponse.json(body, { status });
    }
    throw e;
  }
}

async function postImpl(req: NextRequest, { params }: { params: { id: string } }) {
  const page = await getLandingPage(params.id);
  if (!page) return NextResponse.json({ error: 'page not found' }, { status: 404 });
  const product = await getProduct(page.productId);
  if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    locale?: PageLocale;
    allLocales?: boolean;
  };

  const targetLocales: PageLocale[] = body.allLocales
    ? [...page.availableLocales]
    : body.locale
      ? [body.locale]
      : [page.defaultLocale];

  // Validate that every target is actually on the page (typos, stale
  // client state). Refuse rather than silently hydrate into a cell that
  // doesn't exist — that would create a new locale without the caller's
  // consent (which is what POST /api/pages/:id/locales is for).
  const unknown = targetLocales.filter((l) => !page.availableLocales.includes(l));
  if (unknown.length) {
    return NextResponse.json(
      {
        error: 'unknown-locale',
        code: 'UNKNOWN_LOCALE',
        message: `Locale(s) ${unknown.join(', ')} are not available on this page. Add them via POST /api/pages/:id/locales first.`,
      },
      { status: 400 },
    );
  }

  const inputs = {
    name: product.name,
    tagline: product.tagline,
    category: product.category,
    value: product.value,
    cta: page.cta,
    market: page.targetMarket,
    locale: targetLocales[0] as any, // overwritten per-iter below
    industry: page.audience.industry,
    companySize: page.audience.companySize,
    role: page.audience.role,
    source: page.audience.source,
    pastedContent: '',
    referenceUrls: product.website ? [product.website] : [],
    uploadedFileNames: [],
  };

  // Per-locale sequential (not parallel) — concurrent runs race the
  // Claude prompt cache and each one pays the cache-write premium. With
  // the 5-in-parallel inside hydrateModulesViaClaude, we already have
  // enough concurrency to keep latency low.
  for (const loc of targetLocales) {
    inputs.locale = loc as any;
    const seedA = page.variants.A[loc] ?? page.variants.A[page.defaultLocale] ?? [];
    const seedB = page.variants.B[loc] ?? page.variants.B[page.defaultLocale] ?? [];
    const out = await hydrateModulesViaClaude(
      { A: seedA, B: seedB },
      inputs,
      page.strategy,
      page.tone,
      loc,
    );
    page.variants.A[loc] = out.A;
    page.variants.B[loc] = out.B;
  }

  // Recompute hydrationFailed from scratch — it stays true only while
  // EVERY (variant, locale) cell is still template. A successful hydrate
  // on any one cell clears the page-level flag. Same heuristic as the
  // other write paths (/api/projects POST, /api/pages/:id/locales POST),
  // keeps the signal consistent across all writers.
  const allReports = [
    ...Object.values(page.variants.A).map((mods) =>
      mods ? reportHeroTemplate(mods, product.name) : null,
    ),
    ...Object.values(page.variants.B).map((mods) =>
      mods ? reportHeroTemplate(mods, product.name) : null,
    ),
  ].filter((r): r is NonNullable<typeof r> => r !== null);
  page.hydrationFailed = allReports.length > 0 && allReports.every((r) => r.anyTemplate);

  await saveLandingPage(page);
  return NextResponse.json({
    page,
    locales: targetLocales,
    hydrationFailed: page.hydrationFailed,
  });
}

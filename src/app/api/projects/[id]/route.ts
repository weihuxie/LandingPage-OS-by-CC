/**
 * Legacy v1 /api/projects/[id] — compat shim over v2 LandingPage storage.
 * PATCH body fields map 1:1 where possible:
 *   modules, tone, published, publishMode → set directly on page (active locale)
 *   switchVariant → page.activeVariant
 *   editStrategy / regenerateStrategyBlock / regenerateStrategyLine /
 *     regenerateStrategyAll → strategy
 *   rebuildVariantsFromStrategy → regen default-locale modules
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getLandingPage,
  getProduct,
  saveLandingPage,
  deleteLandingPage,
  getProjectCompat,
} from '@/lib/storage';
import {
  generateStrategy,
  generateVariants,
  regenerateModule,
} from '@/lib/ai';
import type {
  PageModule,
  PageLocale,
  ToneKey,
  NarrativeVariant,
  StyleId,
  StrategySummary,
} from '@/lib/types';
import { projectViewFromV2 } from '@/lib/migrate-v2';
import { reportHeroTemplate } from '@/lib/template-detection';
import {
  errorResponse,
  LLMRequiredError,
  LLMCallError,
  StorageRequiredError,
  DeployRequiredError,
} from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type StrategyBlock = 'audience' | 'goal' | 'narrative' | 'local';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const project = await getProjectCompat(params.id);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ project });
}

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    return await patchImpl(req, ctx);
  } catch (e) {
    if (
      e instanceof LLMRequiredError ||
      e instanceof LLMCallError ||
      e instanceof StorageRequiredError ||
      e instanceof DeployRequiredError
    ) {
      const { status, body } = errorResponse(e);
      return NextResponse.json(body, { status });
    }
    throw e;
  }
}

async function patchImpl(req: NextRequest, { params }: { params: { id: string } }) {
  const page = await getLandingPage(params.id);
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const product = await getProduct(page.productId);
  if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 });

  const body = (await req.json()) as any & {
    modules?: PageModule[];
    tone?: ToneKey;
    published?: boolean;
    publishMode?: 'single' | 'ab-split';
    theme?: { primary?: string; styleId?: StyleId };
    switchVariant?: NarrativeVariant;
    editStrategy?: StrategySummary;
    regenerateStrategyBlock?: StrategyBlock;
    regenerateStrategyLine?: { block: StrategyBlock; index: number };
    regenerateStrategyAll?: boolean;
    rebuildVariantsFromStrategy?: boolean;
    regenerateModuleId?: string;
    newTone?: ToneKey;
    newStyleId?: StyleId;
    // NEW: the locale tab the user is editing. When a page has multiple
    // locales, the client must tell us which locale slot to touch —
    // previously this was hard-coded to page.defaultLocale, which caused
    // "regenerate on 日本語 tab → content comes back in zh-CN" and
    // "selected module ID no longer matches any module in the returned
    // project view → right editor panel empties itself".
    locale?: string;
  };

  // Resolve which locale slot this request is targeting. Falls back to
  // defaultLocale when the caller didn't pass one (older clients / strategy-
  // only patches that don't touch per-locale module arrays).
  const targetLocale: PageLocale =
    (body.locale as PageLocale | undefined) ?? page.defaultLocale;

  // Build inputs for regen helpers. Locale follows the slot we're editing
  // so Claude writes in the right language, not always the page's default.
  const inputs = {
    name: product.name,
    tagline: product.tagline,
    category: product.category,
    value: product.value,
    cta: page.cta,
    market: page.targetMarket,
    locale: targetLocale as any,
    industry: page.audience.industry,
    companySize: page.audience.companySize,
    role: page.audience.role,
    source: page.audience.source,
    pastedContent: '',
    referenceUrls: product.website ? [product.website] : [],
    uploadedFileNames: [],
  };

  // All LLM-touching branches share this try/catch: any of them can throw
  // LLMRequiredError (missing key) or LLMCallError (API / parse / schema).
  // Before this was added, a regenerate on the 日本語 tab with no API key
  // fell through to the JA template which inlined the Chinese product
  // value verbatim — the reported bug. Now the route returns 503 / 502
  // with a structured body and the editor shows a visible error banner.
  try {
    if (body.editStrategy) page.strategy = body.editStrategy;
    if (body.regenerateStrategyAll) page.strategy = await generateStrategy(inputs);
    else if (body.regenerateStrategyBlock) {
      const fresh = await generateStrategy(inputs);
      const key = body.regenerateStrategyBlock as StrategyBlock;
      page.strategy = { ...page.strategy, [key]: fresh[key] };
    } else if (body.regenerateStrategyLine) {
      const { block, index } = body.regenerateStrategyLine as { block: StrategyBlock; index: number };
      const fresh = await generateStrategy(inputs);
      const next = [...page.strategy[block]];
      if (fresh[block][index] !== undefined) next[index] = fresh[block][index];
      page.strategy = { ...page.strategy, [block]: next };
    }

    if (body.rebuildVariantsFromStrategy) {
      const fresh = generateVariants(inputs, page.tone, page.strategy);
      page.variants.A[page.defaultLocale] = fresh.A;
      page.variants.B[page.defaultLocale] = fresh.B;
    }

    if (body.switchVariant) page.activeVariant = body.switchVariant;

    if (body.newStyleId) {
      page.theme = { ...page.theme, styleId: body.newStyleId };
    }

    if (body.regenerateModuleId) {
      const v = page.activeVariant;
      // Regenerate in the locale slot the user is actually viewing — NOT
      // always the defaultLocale. Before this fix, clicking 重新生成 while
      // on the 日本語 tab regenerated the zh-CN slot in Chinese and the ja
      // slot was never touched — so the Japanese tab ended up displaying
      // Chinese copy, and the module IDs shifted under the client's feet.
      //
      // Pass `v` as the variant hint — user clicking 重新生成 on a hero
      // while on the "方案 A · 痛点" tab should get a pain-leaning
      // rewrite, not a generic one. Without this, the single-module
      // regen bypasses the variant-specific copy that hydrate now
      // produces, and the user's A-tab hero drifts toward B-ish copy.
      const mods = page.variants[v][targetLocale] ?? [];
      const idx = mods.findIndex((m) => m.id === body.regenerateModuleId);
      if (idx !== -1) {
        const tone = body.newTone ?? page.tone;
        mods[idx] = await regenerateModule(
          mods[idx],
          inputs,
          tone,
          page.strategy,
          targetLocale,
          v,
        );
        page.variants[v][targetLocale] = mods;
        if (body.newTone) page.tone = tone;
      }
    }
  } catch (e) {
    if (e instanceof LLMRequiredError || e instanceof LLMCallError) {
      console.error('[projects/[id]] LLM call failed:', e);
      const { status, body: errBody } = errorResponse(e);
      return NextResponse.json(errBody, { status });
    }
    throw e; // non-LLM error: let Next.js default 500 handler deal with it
  }

  if (body.modules) {
    const v = page.activeVariant ?? 'A';
    // Apply manual edits to the locale slot the user is viewing, not the
    // default locale — otherwise editing on the 日本語 tab would silently
    // overwrite the zh-CN slot instead.
    page.variants[v][targetLocale] = body.modules;
  }

  if (body.tone) page.tone = body.tone;
  if (typeof body.published === 'boolean') page.published = body.published;
  if (body.publishMode) page.publishMode = body.publishMode;
  if (body.theme) page.theme = { ...page.theme, ...body.theme };

  // Recompute hydrationFailed flag after any change that could fix it
  // (successful regenerate on a template hero, or a module edit that
  // replaces the template headline). Scanned across all cells because
  // one rescued variant/locale is enough to clear the page-level flag.
  if (page.hydrationFailed || body.regenerateModuleId || body.modules) {
    const reports = [
      ...Object.values(page.variants.A).map((mods) => mods && reportHeroTemplate(mods, product.name)),
      ...Object.values(page.variants.B).map((mods) => mods && reportHeroTemplate(mods, product.name)),
    ].filter((r): r is NonNullable<typeof r> => !!r);
    page.hydrationFailed = reports.length > 0 && reports.every((r) => r.anyTemplate);
  }

  await saveLandingPage(page);

  // Return both the compat project view AND the raw page. Multi-locale
  // clients need the page to refresh their per-locale module cache after
  // a regenerate/edit — projectViewFromV2's `modules` field only reflects
  // the default locale, which is not always the tab the user is on.
  return NextResponse.json({
    project: projectViewFromV2(page, product),
    page,
  });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await deleteLandingPage(params.id);
  return NextResponse.json({ ok: true });
}

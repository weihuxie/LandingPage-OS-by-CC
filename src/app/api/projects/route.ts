/**
 * Legacy v1 /api/projects endpoint — now a compat shim over v2 storage.
 *
 * - GET:  returns Project[] reconstructed from Product+LandingPage pairs.
 * - POST: creates an implicit Product (if none exists) + one LandingPage
 *         with the submitted locale as its only language.
 */
import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import {
  LEGACY_TENANT_ID,
  listProjectsCompat,
  readProducts,
  saveProduct,
  saveLandingPage,
} from '@/lib/storage';
import { generateStrategy, generateVariants, hydrateModulesViaClaude } from '@/lib/ai';
import { extractFromTextSmart, mergeContexts } from '@/lib/extract';
import { extractSiteContent } from '@/lib/brand';
import { reportHeroTemplate } from '@/lib/template-detection';
import { defaultStyleForMarket } from '@/lib/styles';
import { makeSlug } from '@/lib/slug';
import {
  errorResponse,
  LLMRequiredError,
  LLMCallError,
  StorageRequiredError,
  DeployRequiredError,
} from '@/lib/errors';
import type {
  LandingPage,
  Product,
  ProductInputs,
  StrategySummary,
  ToneKey,
} from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Extend serverless timeout beyond the 10s Hobby default. 5 parallel Opus
// module calls + 1 strategy call can touch 30-45s on a cold cache. Without
// this, the function was being killed mid-request and the product record
// never landed in KV — user saw "生成失败：504" and no new product appeared
// in the dashboard. 60s is the Pro-plan ceiling; raise further on Enterprise.
export const maxDuration = 60;

export async function GET() {
  const projects = await listProjectsCompat();
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  try {
    return await postImpl(req);
  } catch (e) {
    // Outer net for typed errors that escape the nested try/catches —
    // primarily StorageRequiredError from the first readProducts() call
    // (happens BEFORE any existing save-failure catch). Also handles
    // LLM errors that somehow bubble up without being caught locally.
    // Unknown errors rethrow so Next.js does its own 500 rendering.
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

async function postImpl(req: NextRequest) {
  const body = (await req.json()) as {
    inputs: ProductInputs;
    strategy?: StrategySummary;
    tone?: ToneKey;
    referenceUrl?: string;
    primary?: string;
    fileContexts?: any[];
  };
  if (!body?.inputs?.name) {
    return NextResponse.json({ error: 'inputs.name required' }, { status: 400 });
  }
  const tone: ToneKey =
    body.tone ?? (body.inputs.market === 'JP' ? 'japanese' : 'saas');

  // Build extracted context from paste + URLs + already-extracted file contexts
  const ctxs = [] as any[];
  if (body.inputs.pastedContent?.trim()) {
    ctxs.push(await extractFromTextSmart(body.inputs.pastedContent, 'paste'));
  }
  if (Array.isArray(body.inputs.referenceUrls)) {
    for (const url of body.inputs.referenceUrls.slice(0, 3)) {
      try {
        const siteText = await extractSiteContent(url);
        if (siteText) ctxs.push(await extractFromTextSmart(siteText, 'url'));
      } catch {}
    }
  }
  if (Array.isArray(body.fileContexts)) {
    for (const c of body.fileContexts) {
      if (c && typeof c === 'object' && Array.isArray(c.sourceKinds)) ctxs.push(c);
    }
  }
  const context = ctxs.length ? mergeContexts(ctxs) : undefined;

  // Strategy — if the caller didn't provide one, we MUST generate via Claude.
  // Failure here is terminal: without a strategy the rest of the pipeline
  // produces meaningless output, so we return 503 instead of silently
  // dropping to generateStrategyTemplated. Pre-fig-leaf cleanup this call
  // used to fall through to template bullets and the user never knew.
  let strategy: StrategySummary;
  if (body.strategy) {
    strategy = body.strategy;
  } else {
    try {
      strategy = await generateStrategy(body.inputs, context);
    } catch (e) {
      console.error('[projects] strategy generation failed:', e);
      const { status, body: errBody } = errorResponse(e);
      return NextResponse.json(errBody, { status });
    }
  }
  // Generate templated variants synchronously. Claude enrichment happens
  // AFTER the first save — see the save-first-enrich-after pattern below.
  const variants = generateVariants(body.inputs, tone, strategy, context);
  const now = Date.now();

  // Find-or-create Product by name (simple MVP dedupe)
  const products = await readProducts();
  let product = products.find((p) => p.name === body.inputs.name);
  if (!product) {
    product = {
      id: `p_${nanoid(10)}`,
      // S2 / C1: stays LEGACY_TENANT_ID until C3 wires up requireUser().
      tenantId: LEGACY_TENANT_ID,
      createdAt: now,
      updatedAt: now,
      name: body.inputs.name,
      tagline: body.inputs.tagline,
      category: body.inputs.category,
      value: body.inputs.value,
      website: body.referenceUrl,
      theme: {
        primary: body.primary ?? '#4861ff',
        styleId: defaultStyleForMarket(body.inputs.market),
      },
      assets: { testimonials: [], cases: [], media: [] },
      landingPageIds: [],
    } as Product;
  }

  const pageName = '主站';
  const slug = makeSlug(body.inputs.name);

  const page: LandingPage = {
    id: `lp_${nanoid(10)}`,
    // S2 / C1: LandingPage now carries tenantId. Stamps from product so
    // page+product always share the same tenant invariant.
    tenantId: product.tenantId,
    productId: product.id,
    slug,
    createdAt: now,
    updatedAt: now,
    purpose: 'main',
    name: pageName,
    targetMarket: body.inputs.market,
    defaultLocale: body.inputs.locale,
    availableLocales: [body.inputs.locale],
    cta: body.inputs.cta,
    audience: {
      industry: body.inputs.industry,
      companySize: body.inputs.companySize,
      role: body.inputs.role,
      source: body.inputs.source,
    },
    strategy,
    tone,
    variants: {
      A: { [body.inputs.locale]: variants.A },
      B: { [body.inputs.locale]: variants.B },
    },
    activeVariant: 'A',
    publishMode: 'single',
    theme: {
      primary: body.primary,
      styleId: defaultStyleForMarket(body.inputs.market),
    },
    published: false,
    deploy: null,
    stats: {
      views: 0,
      leads: 0,
      byLocale: {},
      byVariantLocale: { A: {}, B: {} },
      abStats: { A: { views: 0, leads: 0 }, B: { views: 0, leads: 0 } },
    },
  };

  product.landingPageIds = [page.id, ...product.landingPageIds.filter((x) => x !== page.id)];

  // --- FIRST SAVE: templated variants, guaranteed to persist ------------
  // Must run BEFORE any Claude module calls. Previously the enrichment
  // sat before the save and — when 5 parallel Opus calls exceeded the
  // Vercel 10s/60s timeout — the function was killed before the product
  // ever landed in KV. User saw "生成失败" and no new product in the
  // dashboard. Now we persist first; Claude enrichment is a best-effort
  // second save.
  //
  // Each save is individually try-caught so the error body can carry
  // product.id / page.id back to the client. This matters because the
  // old behavior was: saveLandingPage throws → Next.js returns generic
  // 500 with no body → user had no way to know whether their product
  // landed. With IDs in the error payload, they can give us the IDs and
  // we can check KV directly (or the SCAN-based read path will surface
  // the orphan on the next dashboard load and self-heal).
  try {
    await saveProduct(product);
  } catch (e) {
    console.error('[projects] saveProduct failed:', e);
    return NextResponse.json(
      {
        error: 'save-failed',
        stage: 'saveProduct',
        productId: product.id,
        pageId: page.id,
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
  try {
    await saveLandingPage(page);
  } catch (e) {
    console.error('[projects] saveLandingPage (first save) failed:', e);
    return NextResponse.json(
      {
        error: 'save-failed',
        stage: 'saveLandingPage',
        productId: product.id,
        pageId: page.id,
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  // --- SECOND SAVE (best-effort): enrich modules via Claude -------------
  // Page is already persisted with templates above. If hydration fails
  // (no API key, timeout, Claude 502, malformed JSON) we DO NOT hide
  // the failure — we persist hydrationFailed=true AND return a structured
  // `warning` the UI renders as a red banner. Returning 200 with the
  // pageId is still correct: the user's page exists and is editable;
  // we just couldn't enrich it. The warning tells them why so they can
  // fix the key and click regenerate per-module.
  let hydrationWarning: ReturnType<typeof errorResponse>['body'] | null = null;
  try {
    const enriched = await hydrateModulesViaClaude(
      { A: variants.A, B: variants.B },
      body.inputs,
      strategy,
      tone,
      body.inputs.locale,
    );
    page.variants.A[body.inputs.locale] = enriched.A;
    page.variants.B[body.inputs.locale] = enriched.B;
  } catch (e) {
    console.error('[projects] Claude enrichment failed:', e);
    if (e instanceof LLMRequiredError || e instanceof LLMCallError) {
      hydrationWarning = errorResponse(e).body;
    } else {
      hydrationWarning = errorResponse(e).body; // unknown → generic internal
    }
  }

  // --- Template-residue check ------------------------------------------
  // Also run the hero-template heuristic so a Claude "success" that still
  // produced template-looking output (schema matched but content was
  // literally the L[locale] default) is caught too. If Claude threw
  // above, hydrationWarning is already set; this check only adds the
  // flag for the "success-but-still-template" case.
  const heroReportA = reportHeroTemplate(page.variants.A[body.inputs.locale] ?? [], body.inputs.name);
  const heroReportB = reportHeroTemplate(page.variants.B[body.inputs.locale] ?? [], body.inputs.name);
  page.hydrationFailed = !!hydrationWarning || (heroReportA.anyTemplate && heroReportB.anyTemplate);
  try {
    await saveLandingPage(page);
  } catch (e) {
    // First save stands; client can still open the editor. Log so we
    // can tell from Vercel logs if the enrichment save path is flaky.
    console.error('[projects] saveLandingPage (enrichment save) failed:', e);
  }

  return NextResponse.json({
    id: page.id,
    slug: page.slug,
    productId: product.id,
    // Present only when hydration failed. Frontend renders a dismissible
    // red banner tied to this field (see Editor.tsx hydration-warning UI).
    ...(hydrationWarning ? { warning: hydrationWarning } : {}),
  });
}

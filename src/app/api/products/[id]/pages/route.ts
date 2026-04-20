import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import {
  getProduct,
  saveProduct,
  saveLandingPage,
  readLandingPages,
} from '@/lib/storage';
import { generateStrategy, generateVariants, hydrateModulesViaClaude } from '@/lib/ai';
import { extractFromTextSmart, mergeContexts } from '@/lib/extract';
import { extractSiteContent } from '@/lib/brand';
import { defaultStyleForMarket } from '@/lib/styles';
import { makeSlug } from '@/lib/slug';
import {
  errorResponse,
  LLMRequiredError,
  LLMCallError,
  StorageRequiredError,
} from '@/lib/errors';
import { reportHeroTemplate } from '@/lib/template-detection';
import type {
  LandingPage,
  MarketCode,
  PageLocale,
  CTAGoal,
  TrafficSource,
  ToneKey,
} from '@/lib/types';

export const dynamic = 'force-dynamic';
// See /api/projects route for timeout rationale — same 5-parallel-Opus
// workload here, same Vercel timeout risk without raising maxDuration.
export const maxDuration = 60;

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const pages = await readLandingPages(params.id);
  return NextResponse.json({ pages });
}

/**
 * Create a new LandingPage under a product.
 * Generates the primary language variants; other languages added separately.
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
  const product = await getProduct(params.id);
  if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 });

  const body = (await req.json()) as {
    name?: string;
    purpose?: LandingPage['purpose'];
    targetMarket: MarketCode;
    defaultLocale: PageLocale;
    cta: CTAGoal;
    audience: {
      industry: string;
      companySize: string;
      role: string;
      source: TrafficSource;
    };
    tone?: ToneKey;
    themeOverride?: LandingPage['theme'];
  };

  const now = Date.now();
  const tone: ToneKey = body.tone ?? (body.targetMarket === 'JP' ? 'japanese' : 'saas');

  // Build a pseudo-ProductInputs for the ai generator (it still reads the legacy shape)
  const inputs = {
    name: product.name,
    tagline: product.tagline,
    category: product.category,
    value: product.value,
    cta: body.cta,
    market: body.targetMarket,
    locale: body.defaultLocale as any,
    industry: body.audience.industry,
    companySize: body.audience.companySize,
    role: body.audience.role,
    source: body.audience.source,
    pastedContent: '',
    referenceUrls: product.website ? [product.website] : [],
    uploadedFileNames: [],
  };

  // Ground strategy on website content if available
  let context;
  if (product.website) {
    try {
      const siteText = await extractSiteContent(product.website);
      if (siteText) context = mergeContexts([await extractFromTextSmart(siteText, 'url')]);
    } catch {}
  }

  // Strategy generation — Claude only (no template fallback). If Claude
  // is not configured or the call fails, we return 503 instead of silently
  // shipping a generic SaaS-playbook strategy. The product is not created
  // in this branch; the client retries after fixing the key.
  let strategy;
  try {
    strategy = await generateStrategy(inputs, context);
  } catch (e) {
    console.error('[products/pages] strategy generation failed:', e);
    const { status, body: errBody } = errorResponse(e);
    return NextResponse.json(errBody, { status });
  }
  // Templated variants first — Claude enrichment runs AFTER the first save
  // below, so a Vercel timeout during Claude calls can't lose the product.
  const variants = generateVariants(inputs, tone, strategy, context);

  const name = body.name ?? '主站';
  const slug = makeSlug(`${product.name} ${name}`);

  const page: LandingPage = {
    id: `lp_${nanoid(10)}`,
    productId: product.id,
    slug,
    createdAt: now,
    updatedAt: now,

    purpose: body.purpose ?? 'main',
    name,
    targetMarket: body.targetMarket,

    defaultLocale: body.defaultLocale,
    availableLocales: [body.defaultLocale],

    cta: body.cta,
    audience: body.audience,

    strategy,
    tone,

    variants: {
      A: { [body.defaultLocale]: variants.A },
      B: { [body.defaultLocale]: variants.B },
    },
    activeVariant: 'A',
    publishMode: 'single',

    theme: {
      primary: body.themeOverride?.primary,
      styleId: body.themeOverride?.styleId ?? defaultStyleForMarket(body.targetMarket),
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

  // --- FIRST SAVE: templated modules, guaranteed persistence -----------
  // Each step try-caught so the error body carries page.id / productId
  // back to the client — see /api/projects POST for the full rationale.
  try {
    await saveLandingPage(page);
  } catch (e) {
    console.error('[products/pages] saveLandingPage (first save) failed:', e);
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
  product.landingPageIds = [page.id, ...product.landingPageIds.filter((x) => x !== page.id)];
  try {
    await saveProduct(product);
  } catch (e) {
    console.error('[products/pages] saveProduct (landingPageIds update) failed:', e);
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

  // --- SECOND SAVE (best-effort): enrich via Claude --------------------
  // Same pattern as /api/projects — if Claude times out or errors, the
  // templated page from the first save remains usable. We mark
  // hydrationFailed=true, persist, and return a structured `warning` in
  // the response so the editor shows a red banner instead of pretending
  // the AI ran.
  let hydrationWarning: ReturnType<typeof errorResponse>['body'] | null = null;
  try {
    const enriched = await hydrateModulesViaClaude(
      { A: variants.A, B: variants.B },
      inputs,
      strategy,
      tone,
      body.defaultLocale,
    );
    page.variants.A[body.defaultLocale] = enriched.A;
    page.variants.B[body.defaultLocale] = enriched.B;
  } catch (e) {
    console.error('[products/pages] Claude enrichment failed:', e);
    if (e instanceof LLMRequiredError || e instanceof LLMCallError) {
      hydrationWarning = errorResponse(e).body;
    } else {
      hydrationWarning = errorResponse(e).body;
    }
  }

  // Same hero-template heuristic as /api/projects: a Claude "success" that
  // still produced template-looking hero copy gets flagged too.
  const heroReportA = reportHeroTemplate(page.variants.A[body.defaultLocale] ?? [], product.name);
  const heroReportB = reportHeroTemplate(page.variants.B[body.defaultLocale] ?? [], product.name);
  page.hydrationFailed = !!hydrationWarning || (heroReportA.anyTemplate && heroReportB.anyTemplate);
  try {
    await saveLandingPage(page);
  } catch (e) {
    console.error('[products/pages] saveLandingPage (enrichment save) failed:', e);
  }

  return NextResponse.json({
    page,
    ...(hydrationWarning ? { warning: hydrationWarning } : {}),
  });
}

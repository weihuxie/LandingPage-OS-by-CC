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
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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

  const strategy = await generateStrategy(inputs, context);
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
  // templated page from the first save remains usable in the editor.
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
    await saveLandingPage(page);
  } catch (e) {
    console.error('[products/pages] Claude enrichment failed; template content stays:', e);
  }

  return NextResponse.json({ page });
}

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
  const templated = generateVariants(inputs, tone, strategy, context);
  // Rewrite text-heavy modules via Claude for the default locale. Falls
  // back to templates silently if the key is missing / API fails — user
  // experience stays identical to pre-LLM path on failure.
  const variants = await hydrateModulesViaClaude(
    templated,
    inputs,
    strategy,
    tone,
    body.defaultLocale,
  );

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

  await saveLandingPage(page);
  product.landingPageIds = [page.id, ...product.landingPageIds.filter((x) => x !== page.id)];
  await saveProduct(product);

  return NextResponse.json({ page });
}

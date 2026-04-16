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
  listProjectsCompat,
  readProducts,
  saveProduct,
  saveLandingPage,
} from '@/lib/storage';
import { generateStrategy, generateVariants } from '@/lib/ai';
import { extractFromText, mergeContexts } from '@/lib/extract';
import { extractSiteContent } from '@/lib/brand';
import { defaultStyleForMarket } from '@/lib/styles';
import { makeSlug } from '@/lib/slug';
import type {
  LandingPage,
  Product,
  ProductInputs,
  StrategySummary,
  ToneKey,
} from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const projects = await listProjectsCompat();
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
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
    ctxs.push(extractFromText(body.inputs.pastedContent, 'paste'));
  }
  if (Array.isArray(body.inputs.referenceUrls)) {
    for (const url of body.inputs.referenceUrls.slice(0, 3)) {
      try {
        const siteText = await extractSiteContent(url);
        if (siteText) ctxs.push(extractFromText(siteText, 'url'));
      } catch {}
    }
  }
  if (Array.isArray(body.fileContexts)) {
    for (const c of body.fileContexts) {
      if (c && typeof c === 'object' && Array.isArray(c.sourceKinds)) ctxs.push(c);
    }
  }
  const context = ctxs.length ? mergeContexts(ctxs) : undefined;

  const strategy = body.strategy ?? generateStrategy(body.inputs, context);
  const variants = generateVariants(body.inputs, tone, strategy, context);
  const now = Date.now();

  // Find-or-create Product by name (simple MVP dedupe)
  const products = await readProducts();
  let product = products.find((p) => p.name === body.inputs.name);
  if (!product) {
    product = {
      id: `p_${nanoid(10)}`,
      ownerId: 'default',
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
  await saveProduct(product);
  await saveLandingPage(page);

  // Return legacy-shaped response (id = page.id, slug = page.slug)
  return NextResponse.json({ id: page.id, slug: page.slug });
}

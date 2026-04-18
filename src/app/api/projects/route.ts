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
import { generateStrategy, generateVariants, hydrateModulesViaClaude } from '@/lib/ai';
import { extractFromTextSmart, mergeContexts } from '@/lib/extract';
import { extractSiteContent } from '@/lib/brand';
import { reportHeroTemplate } from '@/lib/template-detection';
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

  const strategy = body.strategy ?? (await generateStrategy(body.inputs, context));
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
  // If this times out or throws, the first save stands and the user sees
  // templated copy in the editor. They can still hit "regenerate" on any
  // module to re-attempt the Claude call per-module.
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
    console.error('[projects] Claude enrichment failed; template content stays:', e);
  }

  // --- Template-residue check ------------------------------------------
  // Whether or not hydrateModulesViaClaude threw, walk the saved variants
  // and see if the hero headline / bullets still match ai.ts's known
  // fallback strings. If BOTH variants still look like templates, mark
  // the page so the editor shows a warning and deploy can refuse.
  // Silent degradation was the single biggest quality hole — see
  // CLAUDE.md §4 and the user-reported "3.8 倍 ROI" incident.
  const heroReportA = reportHeroTemplate(page.variants.A[body.inputs.locale] ?? [], body.inputs.name);
  const heroReportB = reportHeroTemplate(page.variants.B[body.inputs.locale] ?? [], body.inputs.name);
  page.hydrationFailed = heroReportA.anyTemplate && heroReportB.anyTemplate;
  try {
    await saveLandingPage(page);
  } catch (e) {
    // First save stands; client can still open the editor. Log so we
    // can tell from Vercel logs if the enrichment save path is flaky.
    console.error('[projects] saveLandingPage (enrichment save) failed:', e);
  }

  return NextResponse.json({ id: page.id, slug: page.slug, productId: product.id });
}

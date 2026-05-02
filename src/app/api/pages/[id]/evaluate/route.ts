/**
 * POST /api/pages/[id]/evaluate
 *
 * Run the independent judge agent on the page's current locale's
 * variant-A modules and return a JudgeReport.
 *
 * Phase 1: locale + variant chosen from query params (?locale=zh-CN
 * &variant=A); defaults to page.defaultLocale + 'A'. Phase 4 may
 * add per-variant evaluation in one call.
 *
 * Auth: requires the page's tenant. Same gate as other page routes.
 *
 * Errors:
 *   - 404: page not found / wrong tenant
 *   - 400: invalid locale (not in page.availableLocales)
 *   - 503: LLMRequiredError (no judge-capable key configured)
 *   - 502: LLMCallError (judge LLM call failed)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getLandingPage, getProduct } from '@/lib/storage';
import { requireUserApi } from '@/lib/server-auth';
import { evaluatePageWithJudge } from '@/lib/judge';
import { errorResponse } from '@/lib/errors';
import { policyFor, readLLMConfig } from '@/lib/llm-config';
import type { ProductInputs, PageLocale, NarrativeVariant } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;

  const page = await getLandingPage(params.id);
  if (!page || page.tenantId !== auth.tenant.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const product = await getProduct(page.productId);
  if (!product) {
    return NextResponse.json({ error: 'product not found' }, { status: 404 });
  }

  // locale + variant from query, defaulted to page defaults.
  const sp = req.nextUrl.searchParams;
  const localeQ = sp.get('locale') as PageLocale | null;
  const variantQ = (sp.get('variant') as NarrativeVariant | null) ?? 'A';
  const locale = (localeQ && page.availableLocales.includes(localeQ))
    ? localeQ
    : page.defaultLocale;

  const variantBag = variantQ === 'B' ? page.variants.B : page.variants.A;
  const modules = variantBag[locale];
  if (!modules || modules.length === 0) {
    return NextResponse.json(
      { error: `no modules for variant=${variantQ} locale=${locale}` },
      { status: 400 },
    );
  }

  // Reconstruct ProductInputs from product + page (judge needs the
  // user-typed surface for the asset inventory).
  const inputs: ProductInputs = {
    name: product.name,
    tagline: product.tagline,
    category: product.category,
    value: product.value,
    cta: page.cta,
    market: page.targetMarket,
    locale,
    industry: page.audience.industry,
    companySize: page.audience.companySize,
    role: page.audience.role,
    source: page.audience.source,
    pastedContent: '',
    referenceUrls: product.website ? [product.website] : [],
    uploadedFileNames: [],
  };

  // Look up the actual generator provider for this locale (informational,
  // also drives cross-family routing in pickJudgeProvider).
  const cfg = await readLLMConfig();
  const generatorProvider = policyFor(cfg, 'copy', locale).chain[0]?.provider;

  try {
    const report = await evaluatePageWithJudge({
      pageId: page.id,
      pageModules: modules,
      inputs,
      // Phase 1: ExtractedContext isn't persisted on the page yet (it
      // lives only during initial wizard run). Future Phase 4 will
      // persist it on Product so judge has the full asset inventory
      // forever. Until then, judge works with product.* surface only.
      context: undefined,
      locale,
      generatorProvider,
    });
    return NextResponse.json({ report });
  } catch (e) {
    console.error('[judge] evaluate failed:', e);
    const { status, body } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

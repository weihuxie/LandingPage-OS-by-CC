import { NextRequest, NextResponse } from 'next/server';
import { getLandingPage, saveLandingPage, getProduct } from '@/lib/storage';
import { generateVariants, hydrateModulesViaClaude } from '@/lib/ai';
import { pickTopTestimonials, testimonialsToModuleItems } from '@/lib/testimonial-match';
import { localizeModulesViaGpt } from '@/lib/llm-openai';
import { reportHeroTemplate } from '@/lib/template-detection';
import {
  errorResponse,
  LLMRequiredError,
  LLMCallError,
  StorageRequiredError,
} from '@/lib/errors';
import type { LandingPage, PageLocale, LocalizationStrategy } from '@/lib/types';

export const dynamic = 'force-dynamic';
// GPT-4o localizes 5 modules × 2 variants in parallel. Each call is ~2-5s,
// bounded by slowest in the batch. 60s ceiling protects us from the 10s
// Hobby default killing the function mid-save.
export const maxDuration = 60;

/**
 * Add a new locale to a LandingPage.
 * Re-uses the existing strategy & inputs; only the L[locale] templates swap.
 * Optionally accepts a user-approved LocalizationStrategy to apply market-
 * specific style / module order / form changes as part of the add.
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

  const body = (await req.json()) as {
    locale: PageLocale;
    strategy?: LocalizationStrategy;
  };
  const locale = body.locale;
  if (!locale) return NextResponse.json({ error: 'locale required' }, { status: 400 });
  if (page.availableLocales.includes(locale)) {
    return NextResponse.json({ page, note: 'locale already exists' });
  }

  const inputs = {
    name: product.name,
    tagline: product.tagline,
    category: product.category,
    value: product.value,
    cta: page.cta,
    market: (body.strategy?.targetMarket ?? page.targetMarket),
    locale: locale as any,
    industry: page.audience.industry,
    companySize: page.audience.companySize,
    role: page.audience.role,
    source: page.audience.source,
    pastedContent: '',
    referenceUrls: product.website ? [product.website] : [],
    uploadedFileNames: [],
  };
  const variants = generateVariants(inputs, page.tone, page.strategy);

  // Apply user-approved LocalizationStrategy (Phase H · white-boxing)
  if (body.strategy) {
    const { formChanges, recommendedStyle, recommendedModuleOrder } = body.strategy;

    // Style preset override for this locale — stored at page level; users
    // can per-variant-tint later. For MVP we bump page theme if no style
    // override has been set yet.
    if (recommendedStyle && !page.theme.styleId) {
      page.theme.styleId = recommendedStyle;
    }

    // Form changes: apply to the locale-specific form module
    const applyForm = (v: 'A' | 'B') => {
      const mods = variants[v];
      const formMod = mods.find((m) => m.type === 'form');
      if (!formMod) return;
      const c = formMod.content as any;
      const fields = new Set<string>(c.fields ?? []);
      (formChanges?.add ?? []).forEach((f) => fields.add(f));
      (formChanges?.remove ?? []).forEach((f) => fields.delete(f));
      c.fields = [...fields];
    };
    applyForm('A');
    applyForm('B');

    // Module order: reorder per recommendation, keep unreferenced ones tail
    if (recommendedModuleOrder?.length) {
      const applyOrder = (v: 'A' | 'B') => {
        const mods = variants[v];
        const byType = new Map(mods.map((m) => [m.type, m]));
        const ordered: typeof mods = [];
        for (const type of recommendedModuleOrder) {
          const m = byType.get(type);
          if (m) {
            ordered.push(m);
            byType.delete(type);
          }
        }
        // append any unlisted modules at the end
        for (const m of byType.values()) ordered.push(m);
        variants[v] = ordered;
      };
      applyOrder('A');
      applyOrder('B');
    }
  }

  // Replace templated testimonials with locale-matching ones from the
  // product's testimonial pool (Phase H.3: auto-filter by primaryLocale).
  const testiPool = product.assets?.testimonials ?? [];
  if (testiPool.length > 0) {
    const targetMarket = body.strategy?.targetMarket ?? page.targetMarket;
    const picked = pickTopTestimonials(testiPool, locale, targetMarket, 2);
    if (picked.length > 0) {
      const items = testimonialsToModuleItems(picked, locale);
      for (const v of ['A', 'B'] as const) {
        const mod = variants[v].find((m) => m.type === 'testimonial');
        if (mod) {
          (mod.content as any).items = items;
        }
      }
    }
  }

  // Two-pass localization: Claude rewrites text-heavy modules natively
  // in the target locale; GPT-4o polishes anything Claude doesn't own
  // (form labels, testimonial text, faq). BOTH passes must succeed or
  // we refuse to add the locale — a half-localized locale would be the
  // exact "looks-right-is-actually-wrong" fig leaf we removed.
  //
  // Previously, Claude failure was swallowed and GPT was asked to
  // "translate" the generic English templates into Japanese, producing
  // "節約時間 / ROIを上げる" boilerplate even though the default locale
  // had product-specific Claude output. That discrepancy is what made
  // users think Claude wrote the page — the default locale felt native,
  // the Japanese locale felt like a GPT translation. Now we fail loud:
  // either the pipeline fully succeeds (both Claude + GPT) or the
  // locale is not added and the UI shows why.
  const targetMarketForLocalize = body.strategy?.targetMarket ?? page.targetMarket;
  let localizedA, localizedB;
  try {
    const claudeOut = await hydrateModulesViaClaude(
      { A: variants.A, B: variants.B },
      inputs,
      page.strategy,
      page.tone,
      locale,
    );
    [localizedA, localizedB] = await Promise.all([
      localizeModulesViaGpt(claudeOut.A, locale, targetMarketForLocalize, page.tone),
      localizeModulesViaGpt(claudeOut.B, locale, targetMarketForLocalize, page.tone),
    ]);
  } catch (e) {
    if (e instanceof LLMRequiredError || e instanceof LLMCallError) {
      console.error('[locales] LLM pipeline failed; locale NOT added:', e);
      const { status, body: errBody } = errorResponse(e);
      return NextResponse.json(errBody, { status });
    }
    throw e;
  }

  page.variants.A[locale] = localizedA;
  page.variants.B[locale] = localizedB;
  page.availableLocales = [...page.availableLocales, locale];

  // Recompute the page-level hydrationFailed flag. It stays TRUE only
  // while EVERY available (variant, locale) cell still has template hero
  // copy — any successful Claude rewrite on any cell clears it. This
  // way adding a ja locale that DID get hydrated rescues a page whose
  // default-locale hydration failed.
  const reportsA = Object.values(page.variants.A).map((mods) =>
    mods ? reportHeroTemplate(mods, product.name) : null,
  );
  const reportsB = Object.values(page.variants.B).map((mods) =>
    mods ? reportHeroTemplate(mods, product.name) : null,
  );
  const allTemplate = [...reportsA, ...reportsB]
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .every((r) => r.anyTemplate);
  page.hydrationFailed = allTemplate;

  await saveLandingPage(page);
  return NextResponse.json({ page });
}

/**
 * Remove a locale from a LandingPage.
 * Refuses to delete the default locale unless another is promoted first.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const page = await getLandingPage(params.id);
  if (!page) return NextResponse.json({ error: 'page not found' }, { status: 404 });

  const body = (await req.json()) as { locale: PageLocale };
  const locale = body.locale;
  if (locale === page.defaultLocale && page.availableLocales.length > 1) {
    return NextResponse.json(
      { error: 'cannot remove default locale; switch default first' },
      { status: 400 },
    );
  }

  delete page.variants.A[locale];
  delete page.variants.B[locale];
  page.availableLocales = page.availableLocales.filter((l) => l !== locale);
  if (page.defaultLocale === locale && page.availableLocales.length) {
    page.defaultLocale = page.availableLocales[0];
  }

  await saveLandingPage(page);
  return NextResponse.json({ page });
}

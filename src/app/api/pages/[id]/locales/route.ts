import { NextRequest, NextResponse } from 'next/server';
import { getLandingPage, saveLandingPage, getProduct } from '@/lib/storage';
import { generateVariants, hydrateModulesViaClaude } from '@/lib/ai';
import { pickTopTestimonials, testimonialsToModuleItems } from '@/lib/testimonial-match';
import { localizeModulesViaGpt } from '@/lib/llm-openai';
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
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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

  // First pass — route hero/pain/benefits/solution/cta through Claude
  // tool-use for PRODUCT-SPECIFIC, LOCALE-NATIVE rewriting. This mirrors
  // what the default-locale creation path does in products/[id]/pages.
  //
  // Why this matters: without Claude hydration, the add-locale path
  // previously took the deterministic English templates out of
  // generateVariants() and handed them to GPT-4o to "translate into ja".
  // GPT-4o's source was generic boilerplate ("save hours", "boost ROI"),
  // so its output was also generic — the default locale would show the
  // user's actual product (WINPILOT / 商机评估 / 赢单概率) because it
  // got Claude-hydrated on first save, but the ja tab would collapse
  // back to "節約時間 / ROIを上げる" because the source material for the
  // GPT translation never mentioned the product specifically.
  //
  // Claude hydration writes natively in the target locale using product
  // inputs + strategy as the grounding signal, so "Japanese tab" now
  // reads like a Japanese copywriter wrote it for THIS product — not
  // like a translator localized a generic SaaS template.
  let hydratedA = variants.A;
  let hydratedB = variants.B;
  try {
    const claudeOut = await hydrateModulesViaClaude(
      { A: variants.A, B: variants.B },
      inputs,
      page.strategy,
      page.tone,
      locale,
    );
    hydratedA = claudeOut.A;
    hydratedB = claudeOut.B;
  } catch (e) {
    console.error(
      '[locales] Claude hydration failed; will rely on GPT-4o fallback for all modules:',
      e,
    );
  }

  // Second pass — GPT-4o localization covers the modules Claude does
  // NOT rewrite (socialProof / useCase / testimonial text / faq / form
  // labels). When Claude hydration succeeded, the 5 text-heavy modules
  // are already in the target locale, so GPT-4o mostly passes them
  // through with minor refinement. When Claude hydration failed, this
  // pass is the entire localization layer.
  const targetMarketForLocalize = body.strategy?.targetMarket ?? page.targetMarket;
  const [localizedA, localizedB] = await Promise.all([
    localizeModulesViaGpt(hydratedA, locale, targetMarketForLocalize, page.tone),
    localizeModulesViaGpt(hydratedB, locale, targetMarketForLocalize, page.tone),
  ]);

  page.variants.A[locale] = localizedA;
  page.variants.B[locale] = localizedB;
  page.availableLocales = [...page.availableLocales, locale];

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

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import {
  getLandingPage,
  saveLandingPage,
  getProduct,
  multiLocaleInstances,
  getLandingPageBySlugLocale,
  getSiblings,
  deleteLandingPage,
} from '@/lib/storage';
import { generateVariants, hydrateModulesViaClaude } from '@/lib/ai';
import { pickTopTestimonials, testimonialsToModuleItems } from '@/lib/testimonial-match';
import { localizeModulesViaGpt } from '@/lib/llm-openai';
import { executeWithFallback, type FallbackOutcome } from '@/lib/llm-fallback';
import { readLLMConfig } from '@/lib/llm-config';
import { reportHeroTemplate } from '@/lib/template-detection';
import { planPageMigration, applyPageMigration } from '@/lib/migrate-parallel-locales';
import {
  errorResponse,
  LLMRequiredError,
  LLMCallError,
  StorageRequiredError,
} from '@/lib/errors';
import type {
  LandingPage,
  PageLocale,
  LocalizationStrategy,
  PageModule,
  LocalizedContent,
} from '@/lib/types';

/**
 * Feishu #15 · localize inheritance (full version).
 *
 * When the user has heavily edited the source-locale version (reorder,
 * disable, prune form fields, tweak labels) and then adds a new locale,
 * they expect those structural choices to carry over — only the TEXT
 * should change. The old path called `generateVariants()` from product
 * inputs, so every edit was silently wiped by the fresh template: users
 * who'd spent 20 minutes in English then clicked "+ 日本語" got back a
 * module list that didn't match their English master at all.
 *
 * Inheritance path preserves module order, disabled flags, form schemas,
 * media refs and IDs from the source locale, and hands the clone to the
 * localize pass so text gets rewritten in the target locale without
 * touching structure. `hydrateModulesViaClaude` is skipped — it's a
 * "from scratch" regenerator and would undo the whole point of inheriting.
 */
function cloneModulesForInheritance(source: PageModule[]): PageModule[] {
  return source.map((m) => structuredClone(m));
}

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
    sourceLocale?: PageLocale;
  };
  const locale = body.locale;
  if (!locale) return NextResponse.json({ error: 'locale required' }, { status: 400 });

  const isParallel = multiLocaleInstances();

  // "locale already added" check. In legacy mode the source-of-truth is
  // the single row's availableLocales array. In parallel mode each
  // sibling's availableLocales only holds its own locale, so we have to
  // ask the group — otherwise we'd false-negative and happily try to
  // recreate an existing sibling.
  if (isParallel) {
    const existing = await getLandingPageBySlugLocale(page.slug, locale);
    if (existing) {
      return NextResponse.json({ page: existing, note: 'locale already exists' });
    }
  } else if (page.availableLocales.includes(locale)) {
    return NextResponse.json({ page, note: 'locale already exists' });
  }

  // ---- Parallel sibling-creation path (P4 of 方案 B) ----------------
  //
  // When MULTI_LOCALE_AS_INSTANCES=1, add-locale creates a new sibling KV
  // row instead of stuffing the locale into the current row's variants map.
  //
  // Rule lock (2026-04-24): inherit ONCE from the source sibling's current
  // (already edited) modules → GPT-4o translate + culturally adapt →
  // `published=false` / `publishedAt=undefined` / `deploy=null` on the
  // new sibling (never inherits the source's publish state). After this
  // one-time inheritance each sibling is independent — editing zh-CN
  // never touches en, deleting zh-CN never deletes en.
  //
  // The source sibling is ALWAYS the one identified by params.id (the
  // sibling the user is currently editing). body.sourceLocale is ignored
  // in this branch for simplicity — there's no UX for cross-sibling
  // inheritance yet.
  if (isParallel) {
    const targetMarket = body.strategy?.targetMarket ?? page.targetMarket;

    // On-demand migration: promote a legacy row into a group in place so
    // subsequent sibling creation has a group to join. Idempotent.
    let sourceSibling = page;
    if (!sourceSibling.localeGroupId) {
      const plan = planPageMigration(sourceSibling);
      if (!plan.alreadyMigrated) {
        await applyPageMigration(plan);
        const reloaded = await getLandingPage(params.id);
        if (!reloaded) {
          return NextResponse.json(
            { error: 'page disappeared after migration' },
            { status: 500 },
          );
        }
        sourceSibling = reloaded;
      }
    }
    if (!sourceSibling.localeGroupId) {
      return NextResponse.json(
        { error: 'migration produced no localeGroupId; refusing to create sibling' },
        { status: 500 },
      );
    }

    const sourceLocaleUsed: PageLocale = sourceSibling.locale ?? sourceSibling.defaultLocale;
    const sourceA = sourceSibling.variants.A[sourceLocaleUsed];
    const sourceB = sourceSibling.variants.B[sourceLocaleUsed];
    if (!sourceA || !sourceB || sourceA.length === 0 || sourceB.length === 0) {
      return NextResponse.json(
        { error: `source sibling ${sourceLocaleUsed} has no hydrated modules to inherit` },
        { status: 400 },
      );
    }

    // Parallel inheritance always runs the OpenAI localize pass — same
    // reasoning as the legacy sourceLocale branch below (no Claude/DeepSeek
    // localize adapter exists; without OpenAI we'd ship source-locale text
    // under the new sibling's tab). If OPENAI_API_KEY is missing,
    // localizeModulesViaGpt throws LLMRequiredError → 503.
    const llmCfg = await readLLMConfig();
    const localizePrimary = llmCfg.scenarios.localize;
    if (localizePrimary !== 'openai') {
      console.warn(
        `[locales] parallel inherit ignoring admin scenarios.localize=${localizePrimary}; ` +
          `inheritance requires OpenAI (no Claude/DeepSeek localize adapter). Forcing openai.`,
      );
    }

    let translatedA: PageModule[] = sourceA.map((m) => structuredClone(m));
    let translatedB: PageModule[] = sourceB.map((m) => structuredClone(m));
    try {
      const [a, b] = await Promise.all([
        localizeModulesViaGpt(translatedA, locale, targetMarket, sourceSibling.tone),
        localizeModulesViaGpt(translatedB, locale, targetMarket, sourceSibling.tone),
      ]);
      translatedA = a;
      translatedB = b;
    } catch (e) {
      if (e instanceof LLMRequiredError || e instanceof LLMCallError) {
        console.error('[locales] parallel inherit+localize failed; sibling NOT created:', e);
        const { status, body: errBody } = errorResponse(e);
        return NextResponse.json(errBody, { status });
      }
      throw e;
    }

    const now = Date.now();
    const newSibling: LandingPage = {
      ...structuredClone(sourceSibling),
      id: `p_${nanoid(12)}`,
      locale,
      localeGroupId: sourceSibling.localeGroupId,
      defaultLocale: locale,
      availableLocales: [locale],
      variants: {
        A: { [locale]: translatedA } as LocalizedContent,
        B: { [locale]: translatedB } as LocalizedContent,
      },
      // 方案 B rule: never inherit publish state. New sibling starts dark.
      published: false,
      publishedAt: undefined,
      deploy: null,
      createdAt: now,
      updatedAt: now,
      // Reset analytics — this is a fresh audience slice.
      stats: {
        views: 0,
        leads: 0,
        byLocale: { [locale]: { views: 0, leads: 0 } },
        byVariantLocale: {
          A: { [locale]: { views: 0, leads: 0 } },
          B: { [locale]: { views: 0, leads: 0 } },
        },
        abStats: {
          A: { views: 0, leads: 0 },
          B: { views: 0, leads: 0 },
        },
      },
      hydrationFailed: false,
    };

    await saveLandingPage(newSibling, { skipSlugMap: true });

    return NextResponse.json({
      page: newSibling,
      siblingCreated: true,
      inheritedFrom: sourceLocaleUsed,
      localeGroupId: sourceSibling.localeGroupId,
      localizeProviderUsed: 'openai' as const,
      ...(localizePrimary !== 'openai'
        ? {
            localizeAdminOverrideWarning: {
              configured: localizePrimary,
              actual: 'openai',
              reason:
                'parallel inheritance has no Claude/DeepSeek localize adapter; forced openai',
            },
          }
        : {}),
    });
  }

  // Inheritance path: when the client passes a valid sourceLocale, skip
  // the template-based regeneration and clone the source locale's modules.
  // See the cloneModulesForInheritance doc-comment for the motivation.
  const sourceLocale =
    body.sourceLocale && page.availableLocales.includes(body.sourceLocale)
      ? body.sourceLocale
      : null;
  const targetMarket = body.strategy?.targetMarket ?? page.targetMarket;

  if (sourceLocale) {
    const sourceA = page.variants.A[sourceLocale];
    const sourceB = page.variants.B[sourceLocale];
    if (!sourceA || !sourceB) {
      return NextResponse.json(
        { error: `sourceLocale ${sourceLocale} has no hydrated modules` },
        { status: 400 },
      );
    }

    // Inheritance path CANNOT honor admin's `scenarios.localize` setting
    // the way the from-scratch path below can. The from-scratch path runs
    // `hydrateModulesViaClaude` FIRST — Claude produces locale-native
    // target-locale text — and then OpenAI polishes on top. If OpenAI's
    // slot is non-openai there, the executor's else-branch returns the
    // Claude output unchanged ("skip polish"): the copy is still in the
    // target locale, just missing cross-cultural polish. Safe degradation.
    //
    // Inheritance has no such safety net. We literally clone zh-CN modules
    // and hand them off; if the executor's else-branch returns the clone
    // unchanged we ship CHINESE text under the English tab and the user
    // never sees a banner because the HTTP response was 200. That was the
    // 2026-04 bug (admin set localize=deepseek — which has no localize
    // adapter — and inheriting from zh-CN produced zh-CN text in English).
    //
    // Fix: inheritance path FORCES OpenAI. We still read the admin config
    // to log the divergence and to keep a consistent response shape, but
    // the executor never branches on the admin-selected provider.
    // If OPENAI_API_KEY is missing, `localizeModulesViaGpt` throws
    // LLMRequiredError → 503 with a clear code, which is the correct
    // behavior (inheritance genuinely can't complete without GPT today).
    const llmCfg = await readLLMConfig();
    const localizePrimary = llmCfg.scenarios.localize;
    if (localizePrimary !== 'openai') {
      console.warn(
        `[locales] inherit path ignoring admin config scenarios.localize=${localizePrimary}; ` +
          `inheritance requires OpenAI (no Claude/DeepSeek localize adapter exists). ` +
          `Forcing openai. Consider setting scenarios.localize=openai in /admin/llm.`,
      );
    }

    let inheritedA: PageModule[] = cloneModulesForInheritance(sourceA);
    let inheritedB: PageModule[] = cloneModulesForInheritance(sourceB);
    try {
      const [a, b] = await Promise.all([
        localizeModulesViaGpt(inheritedA, locale, targetMarket, page.tone),
        localizeModulesViaGpt(inheritedB, locale, targetMarket, page.tone),
      ]);
      inheritedA = a;
      inheritedB = b;
    } catch (e) {
      if (e instanceof LLMRequiredError || e instanceof LLMCallError) {
        console.error('[locales] inherit+localize failed; locale NOT added:', e);
        const { status, body: errBody } = errorResponse(e);
        return NextResponse.json(errBody, { status });
      }
      throw e;
    }

    page.variants.A[locale] = inheritedA;
    page.variants.B[locale] = inheritedB;
    page.availableLocales = [...page.availableLocales, locale];

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

    // Inheritance path uses a hard-coded OpenAI call (see rationale above),
    // so there's no fallback chain to report. `localizePrimary` is surfaced
    // on the response purely so the client can detect "admin set a non-
    // openai primary" and prompt the user to update the config — the text
    // itself is always GPT-localized, so this is an advisory field only.
    return NextResponse.json({
      page,
      inheritedFrom: sourceLocale,
      localizeProviderUsed: 'openai' as const,
      ...(localizePrimary !== 'openai'
        ? {
            localizeAdminOverrideWarning: {
              configured: localizePrimary,
              actual: 'openai',
              reason:
                'inheritance path has no Claude/DeepSeek localize adapter; forced openai to avoid shipping source-locale text as target-locale',
            },
          }
        : {}),
    });
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
  // (form labels, testimonial text, faq). BOTH passes must succeed (or
  // an admin-enabled fallback covers the GPT pass) or we refuse to add
  // the locale — a half-localized locale would be the exact "looks-
  // right-is-actually-wrong" fig leaf we removed.
  //
  // Previously, Claude failure was swallowed and GPT was asked to
  // "translate" the generic English templates into Japanese, producing
  // "節約時間 / ROIを上げる" boilerplate even though the default locale
  // had product-specific Claude output. That discrepancy is what made
  // users think Claude wrote the page — the default locale felt native,
  // the Japanese locale felt like a GPT translation. Now we fail loud
  // when Claude fails, and on GPT failure we consult the admin fallback
  // config (/admin/llm): with fallback ON, we keep Claude's hydrated
  // output as the final result (still locale-native, just missing GPT's
  // cross-cultural polish). With fallback OFF, the original fail-loud
  // behavior is preserved.
  // Read admin-configured localize primary. Prior to this, primary was
  // hardcoded to 'openai', which meant setting "本地化 pass = DeepSeek"
  // in /admin/llm silently had zero effect — every add-locale call still
  // hit GPT first. A user running into KSP activation errors on GPT-4o
  // set the admin config to DeepSeek expecting to bypass OpenAI and was
  // confused when the same 403 kept appearing. Now the admin switch
  // genuinely routes: pick OpenAI → real GPT polish; pick anything else
  // → skip polish and use hydrate output (see executor below).
  const llmCfg = await readLLMConfig();
  const localizePrimary = llmCfg.scenarios.localize;

  let localizedA: PageModule[];
  let localizedB: PageModule[];
  let fallbackOutcome: FallbackOutcome<{ A: PageModule[]; B: PageModule[] }> | null = null;
  try {
    const claudeOut = await hydrateModulesViaClaude(
      { A: variants.A, B: variants.B },
      inputs,
      page.strategy,
      page.tone,
      locale,
    );

    // Primary: if admin picked openai, run the real GPT-4o polish on
    // both variants in parallel. Any other primary pick means "skip
    // the polish pass and use hydrate's locale-native Claude output
    // unchanged" — hydrate already produced native copy, so this is
    // graceful degradation, not a template fallback. We preserve that
    // same behavior on the fallback path too (see executor's else
    // branch); the chain walks, but downstream providers all land in
    // the "return claudeOut" shape because only OpenAI has a real
    // localize adapter today. Listed in the chain they still serve
    // the purpose of ordering which provider is recorded as the one
    // that "covered" the hop, in case we add DeepSeek/Claude localize
    // adapters later.
    fallbackOutcome = await executeWithFallback(
      'localize',
      localizePrimary,
      async (provider) => {
        if (provider === 'openai') {
          const [a, b] = await Promise.all([
            localizeModulesViaGpt(claudeOut.A, locale, targetMarket, page.tone),
            localizeModulesViaGpt(claudeOut.B, locale, targetMarket, page.tone),
          ]);
          return { A: a, B: b };
        }
        // No second-provider localize adapter exists yet. Returning the
        // hydrate-time Claude output is the "skip polish" path — no new
        // LLM call here, since hydrate already ran. `provider` still
        // ends up in outcome.usedProvider so the client sees which
        // provider was nominally used (the admin-selected primary, or
        // whoever covered the hop during fallback).
        return { A: claudeOut.A, B: claudeOut.B };
      },
    );
    localizedA = fallbackOutcome.result.A;
    localizedB = fallbackOutcome.result.B;
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
  // Surface fallback hops on the response when they happened, so the UI
  // can render a yellow "GPT localize fell back to Claude (429-quota)"
  // banner instead of silently shipping the degraded output. Happy path
  // omits the field entirely to keep the response clean.
  const usedFallback =
    fallbackOutcome !== null && fallbackOutcome.hops.length > 0;
  return NextResponse.json({
    page,
    ...(usedFallback
      ? {
          fallback: {
            scenario: 'localize',
            primary: localizePrimary,
            used: fallbackOutcome!.usedProvider,
            hops: fallbackOutcome!.hops,
          },
        }
      : {}),
  });
}

/**
 * Remove a locale from a LandingPage.
 *
 * Legacy mode: strips the locale from the single row's variants map and
 * availableLocales array. Refuses to delete the default locale unless
 * another is promoted first.
 *
 * Parallel mode (MULTI_LOCALE_AS_INSTANCES=1, page has a localeGroupId):
 * deletes the sibling row whose `locale === target`. Refuses to delete
 * the last surviving sibling — use the page's own delete endpoint if the
 * user really wants to wipe the whole page. `deleteLandingPage` handles
 * slug-map handoff to a surviving sibling when the target was the
 * slug-map owner (see storage.ts).
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const page = await getLandingPage(params.id);
  if (!page) return NextResponse.json({ error: 'page not found' }, { status: 404 });

  const body = (await req.json()) as { locale: PageLocale };
  const locale = body.locale;

  // Parallel branch: delete a sibling row, not a locale-cell.
  if (multiLocaleInstances() && page.localeGroupId) {
    const target = await getLandingPageBySlugLocale(page.slug, locale);
    if (!target) {
      return NextResponse.json(
        { error: `no sibling found for locale ${locale}` },
        { status: 400 },
      );
    }
    const siblings = await getSiblings(page);
    if (siblings.length <= 1) {
      return NextResponse.json(
        {
          error:
            'cannot delete the last sibling in the group; delete the page itself instead',
        },
        { status: 400 },
      );
    }
    await deleteLandingPage(target.id);
    return NextResponse.json({
      deletedSiblingId: target.id,
      locale,
      remainingSiblings: siblings.length - 1,
    });
  }

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

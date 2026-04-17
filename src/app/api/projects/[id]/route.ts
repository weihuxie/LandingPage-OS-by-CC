/**
 * Legacy v1 /api/projects/[id] — compat shim over v2 LandingPage storage.
 * PATCH body fields map 1:1 where possible:
 *   modules, tone, published, publishMode → set directly on page (active locale)
 *   switchVariant → page.activeVariant
 *   editStrategy / regenerateStrategyBlock / regenerateStrategyLine /
 *     regenerateStrategyAll → strategy
 *   rebuildVariantsFromStrategy → regen default-locale modules
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getLandingPage,
  getProduct,
  saveLandingPage,
  deleteLandingPage,
  getProjectCompat,
} from '@/lib/storage';
import {
  generateStrategy,
  generateVariants,
  regenerateModule,
} from '@/lib/ai';
import type {
  PageModule,
  ToneKey,
  NarrativeVariant,
  StyleId,
  StrategySummary,
} from '@/lib/types';
import { projectViewFromV2 } from '@/lib/migrate-v2';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type StrategyBlock = 'audience' | 'goal' | 'narrative' | 'local';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const project = await getProjectCompat(params.id);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ project });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const page = await getLandingPage(params.id);
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const product = await getProduct(page.productId);
  if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 });

  const body = (await req.json()) as any & {
    modules?: PageModule[];
    tone?: ToneKey;
    published?: boolean;
    publishMode?: 'single' | 'ab-split';
    theme?: { primary?: string; styleId?: StyleId };
    switchVariant?: NarrativeVariant;
    editStrategy?: StrategySummary;
    regenerateStrategyBlock?: StrategyBlock;
    regenerateStrategyLine?: { block: StrategyBlock; index: number };
    regenerateStrategyAll?: boolean;
    rebuildVariantsFromStrategy?: boolean;
    regenerateModuleId?: string;
    newTone?: ToneKey;
    newStyleId?: StyleId;
  };

  // Build inputs for regen helpers
  const inputs = {
    name: product.name,
    tagline: product.tagline,
    category: product.category,
    value: product.value,
    cta: page.cta,
    market: page.targetMarket,
    locale: page.defaultLocale as any,
    industry: page.audience.industry,
    companySize: page.audience.companySize,
    role: page.audience.role,
    source: page.audience.source,
    pastedContent: '',
    referenceUrls: product.website ? [product.website] : [],
    uploadedFileNames: [],
  };

  if (body.editStrategy) page.strategy = body.editStrategy;
  if (body.regenerateStrategyAll) page.strategy = await generateStrategy(inputs);
  else if (body.regenerateStrategyBlock) {
    const fresh = await generateStrategy(inputs);
    const key = body.regenerateStrategyBlock as StrategyBlock;
    page.strategy = { ...page.strategy, [key]: fresh[key] };
  } else if (body.regenerateStrategyLine) {
    const { block, index } = body.regenerateStrategyLine as { block: StrategyBlock; index: number };
    const fresh = await generateStrategy(inputs);
    const next = [...page.strategy[block]];
    if (fresh[block][index] !== undefined) next[index] = fresh[block][index];
    page.strategy = { ...page.strategy, [block]: next };
  }

  if (body.rebuildVariantsFromStrategy) {
    const fresh = generateVariants(inputs, page.tone, page.strategy);
    page.variants.A[page.defaultLocale] = fresh.A;
    page.variants.B[page.defaultLocale] = fresh.B;
  }

  if (body.switchVariant) page.activeVariant = body.switchVariant;

  if (body.newStyleId) {
    page.theme = { ...page.theme, styleId: body.newStyleId };
  }

  if (body.regenerateModuleId) {
    const v = page.activeVariant;
    const mods = page.variants[v][page.defaultLocale] ?? [];
    const idx = mods.findIndex((m) => m.id === body.regenerateModuleId);
    if (idx !== -1) {
      const tone = body.newTone ?? page.tone;
      mods[idx] = await regenerateModule(
        mods[idx],
        inputs,
        tone,
        page.strategy,
        page.defaultLocale,
      );
      page.variants[v][page.defaultLocale] = mods;
      if (body.newTone) page.tone = tone;
    }
  }

  if (body.modules) {
    const v = page.activeVariant ?? 'A';
    page.variants[v][page.defaultLocale] = body.modules;
  }

  if (body.tone) page.tone = body.tone;
  if (typeof body.published === 'boolean') page.published = body.published;
  if (body.publishMode) page.publishMode = body.publishMode;
  if (body.theme) page.theme = { ...page.theme, ...body.theme };

  await saveLandingPage(page);

  return NextResponse.json({ project: projectViewFromV2(page, product) });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await deleteLandingPage(params.id);
  return NextResponse.json({ ok: true });
}

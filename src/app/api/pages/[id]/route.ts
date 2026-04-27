import { NextRequest, NextResponse } from 'next/server';
import {
  getLandingPage,
  saveLandingPage,
  deleteLandingPage,
  getProduct,
} from '@/lib/storage';
import { regenerateModule, generateVariants } from '@/lib/ai';
import { requireUserApi } from '@/lib/server-auth';
import type { LandingPage, NarrativeVariant, PageLocale } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const page = await getLandingPage(params.id);
  if (!page || page.tenantId !== auth.tenant.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const product = await getProduct(page.productId);
  return NextResponse.json({ page, product });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const page = await getLandingPage(params.id);
  if (!page || page.tenantId !== auth.tenant.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const body = (await req.json()) as Partial<LandingPage> & {
    switchVariant?: NarrativeVariant;
    setActiveLocale?: PageLocale;
    rebuildVariantsFromStrategy?: boolean;
  };

  if (body.switchVariant) page.activeVariant = body.switchVariant;
  if (body.defaultLocale && page.availableLocales.includes(body.defaultLocale)) {
    page.defaultLocale = body.defaultLocale;
  }
  if (body.rebuildVariantsFromStrategy) {
    const product = await getProduct(page.productId);
    if (product) {
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
      const fresh = generateVariants(inputs, page.tone, page.strategy);
      // only refresh the default locale's modules (preserves other languages)
      page.variants.A[page.defaultLocale] = fresh.A;
      page.variants.B[page.defaultLocale] = fresh.B;
    }
  }
  if (body.strategy) page.strategy = body.strategy;
  if (body.tone) page.tone = body.tone;
  if (typeof body.published === 'boolean') page.published = body.published;
  if (body.publishMode) page.publishMode = body.publishMode;
  if (body.theme) page.theme = { ...page.theme, ...body.theme };
  if (body.name) page.name = body.name;
  // Feishu #10 — top-of-page anchor nav toggle + item overrides
  if (body.nav !== undefined) page.nav = body.nav;
  // Per-page font picker (see src/lib/font-presets.ts). Empty/null clears
  // the override; the renderer falls through to brand → product → market.
  if ('fontPresetId' in body) {
    const v = (body as any).fontPresetId;
    if (v === null || v === '') {
      delete page.fontPresetId;
    } else if (typeof v === 'string') {
      page.fontPresetId = v;
    }
  }

  // Replace modules for the current active locale on the active variant
  if ((body as any).modules) {
    const v = page.activeVariant ?? 'A';
    page.variants[v] = {
      ...page.variants[v],
      [page.defaultLocale]: (body as any).modules,
    };
  }

  await saveLandingPage(page);
  return NextResponse.json({ page });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const page = await getLandingPage(params.id);
  if (!page || page.tenantId !== auth.tenant.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  await deleteLandingPage(params.id);
  return NextResponse.json({ ok: true });
}

/**
 * v1 (Project) → v2 (Product + LandingPage) lazy migration.
 *
 * Strategy: when reading a Project from legacy storage, split it into
 *   - a Product under the user (create if missing, else reuse)
 *   - a LandingPage that references that Product
 *
 * Called on-the-fly by storage readers, and also used for bulk migrations.
 */

import { nanoid } from 'nanoid';
import type {
  Project,
  Product,
  LandingPage,
  LocalizedContent,
  PageLocale,
  MarketCode,
  PageModule,
} from './types';

const LEGACY_TENANT_FALLBACK = 'default'; // S2: pre-tenant rows land here

export function migrateProjectToV2(
  project: any,
  existingProductId?: string,
): { product: Product; page: LandingPage } {
  // S2: tenant inheritance — prefer the new tenantId field, fall back to
  // the legacy ownerId, fall back finally to the LEGACY_TENANT_FALLBACK
  // sentinel. Old `Project` rows had ownerId='default' for everyone.
  const tenantId = project.tenantId ?? project.ownerId ?? LEGACY_TENANT_FALLBACK;
  const locale: PageLocale = project.inputs?.locale ?? 'zh-CN';
  const market: MarketCode = project.inputs?.market ?? 'GLOBAL';

  const product: Product = {
    id: existingProductId ?? `p_${nanoid(10)}`,
    tenantId,
    createdAt: project.createdAt ?? Date.now(),
    updatedAt: project.updatedAt ?? Date.now(),

    name: project.inputs?.name ?? '未命名产品',
    tagline: project.inputs?.tagline ?? '',
    category: project.inputs?.category ?? '',
    value: project.inputs?.value ?? '',
    website: project.referenceUrl,

    theme: {
      primary: project.theme?.primary ?? '#4861ff',
      styleId: project.theme?.styleId ?? 'saas-modern',
      fontStack: project.theme?.fontStack,
      logoUrl: project.theme?.logoUrl,
    },

    assets: {
      testimonials: [],
      cases: [],
      media: [],
    },

    landingPageIds: [],
  };

  // Wrap existing variant modules under the page's locale
  const variantsA_Mod: PageModule[] = project.variants?.A ?? project.modules ?? [];
  const variantsB_Mod: PageModule[] = project.variants?.B ?? project.modules ?? [];

  const page: LandingPage = {
    id: project.id,                 // preserve id
    tenantId,                       // S2: copy from the parent product
    productId: product.id,
    slug: project.slug,              // preserve slug
    createdAt: project.createdAt ?? Date.now(),
    updatedAt: project.updatedAt ?? Date.now(),

    purpose: 'main',
    name: '主站',
    targetMarket: market,

    defaultLocale: locale,
    availableLocales: [locale],

    cta: project.inputs?.cta ?? 'demo',
    audience: {
      industry: project.inputs?.industry ?? '',
      companySize: project.inputs?.companySize ?? '',
      role: project.inputs?.role ?? '',
      source: project.inputs?.source ?? 'ads',
    },

    strategy: project.strategy ?? { audience: [], goal: [], narrative: [], local: [] },
    tone: project.tone ?? 'saas',

    variants: {
      A: { [locale]: variantsA_Mod } as LocalizedContent,
      B: { [locale]: variantsB_Mod } as LocalizedContent,
    },
    activeVariant: project.activeVariant ?? 'A',
    publishMode: project.publishMode ?? 'single',

    theme: {
      primary: project.theme?.primary,
      styleId: project.theme?.styleId,
    },

    published: project.published ?? false,
    publishedAt: project.publishedAt,
    deploy: project.deploy ?? null,

    stats: {
      views: project.views ?? 0,
      leads: project.leadCount ?? 0,
      byLocale: { [locale]: { views: project.views ?? 0, leads: project.leadCount ?? 0 } },
      byVariantLocale: {
        A: { [locale]: { views: project.abStats?.A?.views ?? 0, leads: project.abStats?.A?.leads ?? 0 } },
        B: { [locale]: { views: project.abStats?.B?.views ?? 0, leads: project.abStats?.B?.leads ?? 0 } },
      },
      abStats: project.abStats ?? { A: { views: 0, leads: 0 }, B: { views: 0, leads: 0 } },
    },
  };

  product.landingPageIds = [page.id];

  return { product, page };
}

/**
 * Project-like view computed from a LandingPage + Product, for legacy API
 * compat. Old /api/projects/:id endpoints rewrap into this shape so existing
 * clients/editor keep working while we roll out UI changes.
 *
 * `siblings` is the P1 parallel-locale seam: when the parallel-instance model
 * is active, callers may pass the full sibling group so future phases can
 * merge per-locale variant cells from sibling rows into one Project view.
 * P1 accepts the param for API shape stability but doesn't read it — existing
 * behavior is fully preserved. P3+ will use it to expose locale tabs backed
 * by independent sibling rows.
 */
export function projectViewFromV2(
  page: LandingPage,
  product: Product,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  siblings?: LandingPage[],
): Project {
  const locale = page.activeVariant ? page.defaultLocale : 'zh-CN';
  const variantA = page.variants.A[page.defaultLocale] ?? [];
  const variantB = page.variants.B[page.defaultLocale] ?? [];
  const active = page.activeVariant === 'B' ? variantB : variantA;

  return {
    id: page.id,
    // S2: project view inherits tenantId from the page so the compat
    // list endpoint (/api/projects GET) can tenant-filter without
    // looking up the underlying LandingPage row a second time.
    tenantId: (page as any).tenantId ?? (page as any).ownerId ?? 'default',
    slug: page.slug,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    inputs: {
      name: product.name,
      tagline: product.tagline,
      category: product.category,
      value: product.value,
      cta: page.cta,
      market: page.targetMarket,
      locale: page.defaultLocale,
      industry: page.audience.industry,
      companySize: page.audience.companySize,
      role: page.audience.role,
      source: page.audience.source,
      pastedContent: '',
      referenceUrls: product.website ? [product.website] : [],
      uploadedFileNames: [],
    },
    tone: page.tone,
    strategy: page.strategy,
    modules: active,
    variants: { A: variantA, B: variantB },
    activeVariant: page.activeVariant,
    publishMode: page.publishMode,
    theme: {
      primary: page.theme.primary ?? product.theme.primary,
      styleId: page.theme.styleId ?? product.theme.styleId,
      // S2/font: pull product-level fontStack into the compat view so
      // PageRenderer's resolveFontStack chain has it as a fallback layer.
      fontStack: product.theme.fontStack,
    } as any,
    referenceUrl: product.website,
    published: page.published,
    publishedLocales: page.availableLocales as any,
    leadCount: page.stats.leads,
    views: page.stats.views,
    abStats: page.stats.abStats,
    deploy: page.deploy,
  };
}

/**
 * Sibling-aware Project view (P1 parallel-locale seam, no current consumers).
 *
 * Constructed so the eventual /api/projects/:id path in the MULTI_LOCALE_AS_INSTANCES
 * world can call this instead of the single-page helper and have each sibling's
 * locale cell folded into the returned view. Today this is a thin wrapper so the
 * surface exists for P3/P4 to bind against without another storage signature
 * change later — and a diagnostic export so callers know the group was resolved.
 */
export function siblingsToProjectViewGroup(
  primary: LandingPage,
  siblings: LandingPage[],
  product: Product,
): Project {
  return projectViewFromV2(primary, product, siblings);
}

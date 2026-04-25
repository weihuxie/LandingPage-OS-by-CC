import { NextResponse } from 'next/server';
import {
  readProducts,
  readLandingPages,
  readEvents,
  readLeads,
} from '@/lib/storage';
import { requireUserApi } from '@/lib/server-auth';
import type { LandingPage, Product, PageLocale } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Analytics aggregator — Phase E drilldown:
 *   global KPI
 *   → per-product
 *     → per-page
 *       → per-locale stats + per-(variant,locale) A/B split
 */
export async function GET() {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  // Pull tenant-scoped lists. Events read globally then filter via the
  // page id set; we don't have tenantId on PageEvent (would require a
  // schema bump for events too) so we filter via page set membership.
  const [products, pages, allEvents, leads] = await Promise.all([
    readProducts({ tenantId: auth.tenant.id }),
    readLandingPages({ tenantId: auth.tenant.id }),
    readEvents(),
    readLeads({ tenantId: auth.tenant.id }),
  ]);
  const tenantPageIds = new Set(pages.map((p) => p.id));
  const events = allEvents.filter((e) => tenantPageIds.has(e.projectId));

  const totalViews = events.filter((e) => e.type === 'view').length;
  const totalLeads = leads.length;
  const avgCvr = totalViews > 0 ? totalLeads / totalViews : 0;

  // Global locale breakdown (union across all pages)
  const byLocale = new Map<string, { views: number; leads: number }>();
  for (const e of events) {
    if (e.type !== 'view') continue;
    const r = byLocale.get(e.locale) ?? { views: 0, leads: 0 };
    r.views += 1;
    byLocale.set(e.locale, r);
  }
  for (const l of leads) {
    const r = byLocale.get(l.locale) ?? { views: 0, leads: 0 };
    r.leads += 1;
    byLocale.set(l.locale, r);
  }

  const pagesByProduct = new Map<string, LandingPage[]>();
  for (const p of pages) {
    const arr = pagesByProduct.get(p.productId) ?? [];
    arr.push(p);
    pagesByProduct.set(p.productId, arr);
  }

  const perProduct = products.map((product) => {
    const myPages = pagesByProduct.get(product.id) ?? [];

    const pagesView = myPages.map((page) => {
      const byLoc = page.stats.byLocale ?? {};
      const localeRows = Object.entries(byLoc).map(([loc, row]) => ({
        locale: loc as PageLocale,
        views: row?.views ?? 0,
        leads: row?.leads ?? 0,
        cvr: (row?.views ?? 0) > 0 ? (row?.leads ?? 0) / (row?.views ?? 0) : 0,
      }));

      // A/B × locale matrix for this page
      const ab = page.stats.byVariantLocale ?? {};
      const abLocale = {
        A: Object.entries(ab.A ?? {}).map(([loc, row]) => ({
          locale: loc as PageLocale,
          views: row?.views ?? 0,
          leads: row?.leads ?? 0,
          cvr: (row?.views ?? 0) > 0 ? (row?.leads ?? 0) / (row?.views ?? 0) : 0,
        })),
        B: Object.entries(ab.B ?? {}).map(([loc, row]) => ({
          locale: loc as PageLocale,
          views: row?.views ?? 0,
          leads: row?.leads ?? 0,
          cvr: (row?.views ?? 0) > 0 ? (row?.leads ?? 0) / (row?.views ?? 0) : 0,
        })),
      };

      return {
        id: page.id,
        slug: page.slug,
        name: page.name,
        purpose: page.purpose,
        market: page.targetMarket,
        published: page.published,
        publishMode: page.publishMode,
        defaultLocale: page.defaultLocale,
        availableLocales: page.availableLocales,
        views: page.stats.views,
        leads: page.stats.leads,
        cvr: page.stats.views > 0 ? page.stats.leads / page.stats.views : 0,
        byLocale: localeRows,
        abByLocale: abLocale,
        abWinner: pickABWinnerPerLocale(page),
      };
    });

    const totalViewsP = pagesView.reduce((s, p) => s + p.views, 0);
    const totalLeadsP = pagesView.reduce((s, p) => s + p.leads, 0);

    return {
      id: product.id,
      name: product.name,
      category: product.category,
      website: product.website,
      primaryColor: product.theme.primary,
      pageCount: pagesView.length,
      publishedCount: pagesView.filter((p) => p.published).length,
      totalViews: totalViewsP,
      totalLeads: totalLeadsP,
      cvr: totalViewsP > 0 ? totalLeadsP / totalViewsP : 0,
      pages: pagesView,
    };
  });

  const suggestions = buildSuggestions(perProduct);

  return NextResponse.json({
    kpi: {
      totalProducts: products.length,
      totalPages: pages.length,
      totalViews,
      totalLeads,
      avgCvr,
    },
    perProduct,
    byLocale: Object.fromEntries(byLocale),
    suggestions,
  });
}

/**
 * Per-locale A/B winner: each locale has its own A vs B race
 * (user's Q3 answer: locales are independent experiments, don't pool).
 */
function pickABWinnerPerLocale(page: LandingPage) {
  const ab = page.stats.byVariantLocale ?? { A: {}, B: {} };
  const out: Record<string, any> = {};
  const minSample = 200;
  for (const loc of page.availableLocales) {
    const a = ab.A?.[loc] ?? { views: 0, leads: 0 };
    const b = ab.B?.[loc] ?? { views: 0, leads: 0 };
    if (a.views < minSample || b.views < minSample) {
      out[loc] = { winner: null, reason: 'need-more-samples', sample: { a: a.views, b: b.views } };
      continue;
    }
    const aCvr = a.leads / a.views;
    const bCvr = b.leads / b.views;
    const lift = aCvr === 0 ? Infinity : (bCvr - aCvr) / aCvr;
    if (Math.abs(lift) < 0.05) {
      out[loc] = { winner: null, reason: 'flat', lift };
    } else {
      out[loc] = { winner: lift > 0 ? 'B' : 'A', lift };
    }
  }
  return out;
}

function buildSuggestions(rows: any[]): string[] {
  const out: string[] = [];
  for (const prod of rows) {
    for (const page of prod.pages ?? []) {
      if (page.published && page.views >= 300 && page.cvr < 0.01) {
        out.push(
          `${prod.name} / ${page.name}：转化率低于 1%，建议重写首屏或缩短表单。`,
        );
      }
      if (page.published && page.market === 'JP' && page.cvr < 0.015) {
        out.push(
          `${prod.name} / ${page.name}：日本站转化率偏低，建议补充 SOC 2 / ISMS 认证资产并切换为「极简信任」风格。`,
        );
      }
      // Locale gap suggestion
      const top = [...(page.byLocale ?? [])].sort((a: any, b: any) => b.views - a.views)[0];
      if (top && top.views >= 200 && page.availableLocales.length === 1) {
        out.push(
          `${prod.name} / ${page.name}：${top.locale} 有 ${top.views} UV 但没有其他语言版本；建议加一门常见目标市场语言。`,
        );
      }
      // Locale winner suggestion
      for (const [loc, w] of Object.entries(page.abWinner ?? {}) as any) {
        if (w?.winner && Math.abs(w.lift ?? 0) >= 0.1) {
          out.push(
            `${prod.name} / ${page.name} (${loc})：A/B 已有显著胜出者 ${w.winner}（提升 ${(w.lift * 100).toFixed(1)}%），建议固化单方案。`,
          );
        }
      }
    }
  }
  if (out.length === 0) out.push('一切正常。继续积累样本后回来看。');
  return out.slice(0, 8);
}

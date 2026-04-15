import { NextResponse } from 'next/server';
import { readProjects, readEvents, readLeads } from '@/lib/storage';

// Force dynamic — this route reads live state. Without this Next.js
// static-prerenders the response at build time (empty KV) and serves
// that snapshot forever. Bit me during e2e.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Analytics aggregator for the A9 growth dashboard (PRD §7).
 * Returns: global KPIs, per-project comparison, locale/market breakdown,
 * A/B stats and AI optimization suggestions.
 */
export async function GET() {
  const [projects, events, leads] = await Promise.all([
    readProjects(),
    readEvents(),
    readLeads(),
  ]);

  const totalViews = events.filter((e) => e.type === 'view').length;
  const totalLeads = leads.length;
  const avgCvr = totalViews > 0 ? totalLeads / totalViews : 0;

  const byLocale = new Map<string, { views: number; leads: number }>();
  for (const e of events) {
    if (e.type !== 'view') continue;
    const row = byLocale.get(e.locale) ?? { views: 0, leads: 0 };
    row.views += 1;
    byLocale.set(e.locale, row);
  }
  for (const l of leads) {
    const row = byLocale.get(l.locale) ?? { views: 0, leads: 0 };
    row.leads += 1;
    byLocale.set(l.locale, row);
  }

  const perProject = projects.map((p) => {
    const pv = events.filter((e) => e.projectId === p.id && e.type === 'view').length;
    const pLeads = leads.filter((l) => l.projectId === p.id).length;
    const cvr = pv > 0 ? pLeads / pv : 0;
    return {
      id: p.id,
      name: p.inputs.name,
      market: p.inputs.market,
      locale: p.inputs.locale,
      published: p.published,
      publishMode: p.publishMode,
      views: pv,
      leads: pLeads,
      cvr,
      ab: p.abStats ?? null,
      abWinner: pickABWinner(p.abStats),
    };
  });

  const suggestions = buildSuggestions(perProject);

  return NextResponse.json({
    kpi: {
      totalProjects: projects.length,
      totalViews,
      totalLeads,
      avgCvr,
    },
    perProject,
    byLocale: Object.fromEntries(byLocale),
    suggestions,
  });
}

function pickABWinner(stats: { A: { views: number; leads: number }; B: { views: number; leads: number } } | null | undefined) {
  if (!stats) return null;
  const minSample = 200;
  const aV = stats.A.views;
  const bV = stats.B.views;
  if (aV < minSample || bV < minSample) return { winner: null, reason: 'need-more-samples', sample: { aV, bV } };
  const aCvr = aV > 0 ? stats.A.leads / aV : 0;
  const bCvr = bV > 0 ? stats.B.leads / bV : 0;
  const lift = aCvr === 0 ? Infinity : (bCvr - aCvr) / aCvr;
  if (Math.abs(lift) < 0.05) return { winner: null, reason: 'flat', lift };
  return { winner: lift > 0 ? 'B' : 'A', lift };
}

function buildSuggestions(rows: any[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.published && r.views >= 300 && r.cvr < 0.01) {
      out.push(`${r.name}（${r.market}）：转化率低于 1%，建议重写首屏或缩短表单。`);
    }
    if (r.published && r.market === 'JP' && r.cvr < 0.015) {
      out.push(`${r.name}：日本站转化率偏低，建议补充 SOC 2 / ISMS 认证资产并切换为「极简信任」风格。`);
    }
    if (r.abWinner?.winner && Math.abs(r.abWinner.lift ?? 0) >= 0.1) {
      out.push(`${r.name}：A/B 测试已有显著胜出者（方案 ${r.abWinner.winner}，提升 ${(r.abWinner.lift * 100).toFixed(1)}%），建议切换为单方案模式。`);
    }
  }
  if (out.length === 0) out.push('一切正常。继续积累样本后回来看。');
  return out;
}

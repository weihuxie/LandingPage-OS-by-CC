'use client';
import { useEffect, useState } from 'react';
import { nativeLabel } from '@/lib/i18n-detect';

type LocaleRow = { locale: string; views: number; leads: number; cvr: number };

type PageRow = {
  id: string;
  slug: string;
  name: string;
  purpose: string;
  market: string;
  published: boolean;
  publishMode: 'single' | 'ab-split';
  defaultLocale: string;
  availableLocales: string[];
  views: number;
  leads: number;
  cvr: number;
  byLocale: LocaleRow[];
  abByLocale: { A: LocaleRow[]; B: LocaleRow[] };
  abWinner: Record<
    string,
    { winner: 'A' | 'B' | null; lift?: number; reason?: string }
  >;
};

type ProductRow = {
  id: string;
  name: string;
  category: string;
  website?: string;
  primaryColor: string;
  pageCount: number;
  publishedCount: number;
  totalViews: number;
  totalLeads: number;
  cvr: number;
  pages: PageRow[];
};

type Data = {
  kpi: {
    totalProducts: number;
    totalPages: number;
    totalViews: number;
    totalLeads: number;
    avgCvr: number;
  };
  perProduct: ProductRow[];
  byLocale: Record<string, { views: number; leads: number }>;
  suggestions: string[];
};

export default function AnalyticsDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/analytics')
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <div className="card p-8 text-sm text-ink-500">读取中…</div>;

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

  const toggle = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  };

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="产品" value={data.kpi.totalProducts.toString()} />
        <Kpi label="落地页" value={data.kpi.totalPages.toString()} />
        <Kpi label="总访问" value={data.kpi.totalViews.toLocaleString()} />
        <Kpi label="总留资" value={data.kpi.totalLeads.toLocaleString()} />
        <Kpi label="平均 CVR" value={pct(data.kpi.avgCvr)} />
      </div>

      {/* Product → Page → Locale drilldown */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">产品 · 页面 · 语言 下钻</h2>
          <span className="pill text-[11px]">点击展开</span>
        </div>
        <div className="mt-4 space-y-2">
          {data.perProduct.length === 0 ? (
            <div className="text-sm text-ink-500">还没有产品</div>
          ) : (
            data.perProduct.map((prod) => {
              const open = expanded.has(prod.id);
              return (
                <div key={prod.id} className="rounded-xl border border-ink-100">
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-100/30"
                    onClick={() => toggle(prod.id)}
                  >
                    <span
                      className="h-4 w-4 rounded"
                      style={{ background: prod.primaryColor }}
                    />
                    <span className="flex-1 text-sm font-medium">{prod.name}</span>
                    <span className="text-xs text-ink-500">
                      {prod.pageCount} 页面 · {prod.totalViews.toLocaleString()} UV ·{' '}
                      {prod.totalLeads.toLocaleString()} leads · {pct(prod.cvr)}
                    </span>
                    <span className="text-ink-500">{open ? '▾' : '▸'}</span>
                  </button>
                  {open && (
                    <div className="border-t border-ink-100 bg-ink-100/20 p-3">
                      {prod.pages.length === 0 ? (
                        <div className="text-xs text-ink-500">该产品暂无落地页</div>
                      ) : (
                        prod.pages.map((pg) => {
                          const pgKey = `${prod.id}/${pg.id}`;
                          const pgOpen = expanded.has(pgKey);
                          return (
                            <div key={pg.id} className="mb-2 rounded-lg border border-ink-100 bg-white">
                              <button
                                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-ink-100/30"
                                onClick={() => toggle(pgKey)}
                              >
                                <span className="text-sm">{pg.name}</span>
                                <span className="pill text-[11px]">{pg.market}</span>
                                {pg.publishMode === 'ab-split' && (
                                  <span className="pill text-[11px]">A/B</span>
                                )}
                                <span
                                  className={`pill text-[11px] ${pg.published ? 'border-brand-200 bg-brand-50 text-brand-700' : ''}`}
                                >
                                  {pg.published ? '已发布' : '草稿'}
                                </span>
                                <span className="flex-1" />
                                <span className="text-xs text-ink-500">
                                  {pg.views} UV · {pg.leads} leads · {pct(pg.cvr)}
                                </span>
                                <span className="text-ink-500">{pgOpen ? '▾' : '▸'}</span>
                              </button>
                              {pgOpen && (
                                <div className="border-t border-ink-100 p-3">
                                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    {/* Per-locale */}
                                    <div>
                                      <div className="label mb-1.5">按语言</div>
                                      <table className="w-full text-xs">
                                        <thead className="text-ink-500">
                                          <tr>
                                            <th className="py-1 pr-2 text-left">语言</th>
                                            <th className="py-1 pr-2 text-right">UV</th>
                                            <th className="py-1 pr-2 text-right">Leads</th>
                                            <th className="py-1 pr-2 text-right">CVR</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {pg.byLocale.length === 0 && (
                                            <tr>
                                              <td colSpan={4} className="py-2 text-ink-300">
                                                暂无语言数据
                                              </td>
                                            </tr>
                                          )}
                                          {pg.byLocale.map((row) => (
                                            <tr key={row.locale} className="border-t border-ink-100">
                                              <td className="py-1 pr-2">
                                                {nativeLabel(row.locale as any)}
                                                {row.locale === pg.defaultLocale && (
                                                  <span className="ml-1 text-brand-600">★</span>
                                                )}
                                              </td>
                                              <td className="py-1 pr-2 text-right">{row.views}</td>
                                              <td className="py-1 pr-2 text-right">{row.leads}</td>
                                              <td className="py-1 pr-2 text-right">{pct(row.cvr)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    {/* Per-locale A/B */}
                                    <div>
                                      <div className="label mb-1.5">A/B × 语言</div>
                                      <table className="w-full text-xs">
                                        <thead className="text-ink-500">
                                          <tr>
                                            <th className="py-1 pr-2 text-left">语言</th>
                                            <th className="py-1 pr-2 text-right">A CVR</th>
                                            <th className="py-1 pr-2 text-right">B CVR</th>
                                            <th className="py-1 pr-2">胜出</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {pg.availableLocales.map((l) => {
                                            const a = pg.abByLocale.A.find((x) => x.locale === l) ?? { views: 0, leads: 0, cvr: 0, locale: l };
                                            const b = pg.abByLocale.B.find((x) => x.locale === l) ?? { views: 0, leads: 0, cvr: 0, locale: l };
                                            const w = pg.abWinner[l];
                                            return (
                                              <tr key={l} className="border-t border-ink-100">
                                                <td className="py-1 pr-2">{nativeLabel(l as any)}</td>
                                                <td className="py-1 pr-2 text-right">{pct(a.cvr)}</td>
                                                <td className="py-1 pr-2 text-right">{pct(b.cvr)}</td>
                                                <td className="py-1 pr-2">
                                                  {w?.winner ? (
                                                    <span className="pill border-brand-200 bg-brand-50 text-[11px] text-brand-700">
                                                      {w.winner} · +{((w.lift ?? 0) * 100).toFixed(1)}%
                                                    </span>
                                                  ) : (
                                                    <span className="text-[11px] text-ink-300">
                                                      {w?.reason === 'need-more-samples' ? '样本不足' : '无显著差异'}
                                                    </span>
                                                  )}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="text-base font-semibold">按语言分布</h2>
          <div className="mt-4 space-y-2">
            {Object.entries(data.byLocale).map(([locale, row]) => {
              const total = Object.values(data.byLocale).reduce((s, r) => s + r.views, 0);
              const pctShare = total > 0 ? (row.views / total) * 100 : 0;
              const cvr = row.views > 0 ? row.leads / row.views : 0;
              return (
                <div key={locale} className="flex items-center gap-3">
                  <div className="w-20 text-sm font-medium">{nativeLabel(locale as any)}</div>
                  <div className="flex-1 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className="h-2 bg-brand-600"
                      style={{ width: `${pctShare.toFixed(1)}%` }}
                    />
                  </div>
                  <div className="w-20 text-right text-xs text-ink-500">{row.views} UV</div>
                  <div className="w-20 text-right text-xs text-ink-500">
                    CVR {(cvr * 100).toFixed(2)}%
                  </div>
                </div>
              );
            })}
            {Object.keys(data.byLocale).length === 0 && (
              <div className="text-sm text-ink-500">还没有访问数据</div>
            )}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-base font-semibold">AI 优化任务池</h2>
          <ul className="mt-3 space-y-2">
            {data.suggestions.map((s, i) => (
              <li
                key={i}
                className="flex gap-2 rounded-xl border border-ink-100 bg-ink-100/40 p-3 text-sm"
              >
                <span
                  className="mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ background: 'var(--brand, #4861ff)' }}
                />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

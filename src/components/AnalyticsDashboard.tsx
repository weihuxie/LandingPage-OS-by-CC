'use client';
import { useEffect, useState } from 'react';

type ProjectRow = {
  id: string;
  name: string;
  market: string;
  locale: string;
  published: boolean;
  publishMode: 'single' | 'ab-split';
  views: number;
  leads: number;
  cvr: number;
  ab: { A: { views: number; leads: number }; B: { views: number; leads: number } } | null;
  abWinner:
    | { winner: 'A' | 'B' | null; lift?: number; reason?: string; sample?: any }
    | null;
};

type Data = {
  kpi: { totalProjects: number; totalViews: number; totalLeads: number; avgCvr: number };
  perProject: ProjectRow[];
  byLocale: Record<string, { views: number; leads: number }>;
  suggestions: string[];
};

export default function AnalyticsDashboard() {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    fetch('/api/analytics')
      .then((r) => r.json())
      .then(setData);
  }, []);
  if (!data) return <div className="card p-8 text-sm text-ink-500">读取中…</div>;

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="产品数" value={data.kpi.totalProjects.toString()} />
        <Kpi label="总访问" value={data.kpi.totalViews.toLocaleString()} />
        <Kpi label="总留资" value={data.kpi.totalLeads.toLocaleString()} />
        <Kpi label="平均转化率" value={pct(data.kpi.avgCvr)} />
      </div>

      {/* Project comparison */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">产品横向对比</h2>
          <span className="pill">按留资量排序</span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-ink-500">
              <tr>
                <th className="py-2 pr-3">产品</th>
                <th className="py-2 pr-3">市场</th>
                <th className="py-2 pr-3">模式</th>
                <th className="py-2 pr-3 text-right">UV</th>
                <th className="py-2 pr-3 text-right">Leads</th>
                <th className="py-2 pr-3 text-right">CVR</th>
                <th className="py-2 pr-3">A/B</th>
              </tr>
            </thead>
            <tbody>
              {[...data.perProject]
                .sort((a, b) => b.leads - a.leads)
                .map((p) => (
                  <tr key={p.id} className="border-t border-ink-100">
                    <td className="py-2 pr-3 font-medium">{p.name}</td>
                    <td className="py-2 pr-3">{p.market}</td>
                    <td className="py-2 pr-3">
                      <span className="pill text-[11px]">
                        {p.publishMode === 'ab-split' ? 'A/B' : '单方案'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right">{p.views.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right">{p.leads.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right">{pct(p.cvr)}</td>
                    <td className="py-2 pr-3">
                      {p.abWinner?.winner ? (
                        <span className="pill border-brand-200 bg-brand-50 text-brand-700 text-[11px]">
                          胜: {p.abWinner.winner} · +{((p.abWinner.lift ?? 0) * 100).toFixed(1)}%
                        </span>
                      ) : p.abWinner?.reason === 'need-more-samples' ? (
                        <span className="pill text-[11px]">样本不足</span>
                      ) : p.abWinner?.reason === 'flat' ? (
                        <span className="pill text-[11px]">无显著差异</span>
                      ) : (
                        <span className="text-xs text-ink-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              {data.perProject.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm text-ink-500">
                    还没有已发布的项目
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Locale breakdown */}
        <div className="card p-5">
          <h2 className="text-base font-semibold">按语言分布</h2>
          <div className="mt-4 space-y-2">
            {Object.entries(data.byLocale).map(([locale, row]) => {
              const total = Object.values(data.byLocale).reduce((s, r) => s + r.views, 0);
              const pctShare = total > 0 ? (row.views / total) * 100 : 0;
              const cvr = row.views > 0 ? row.leads / row.views : 0;
              return (
                <div key={locale} className="flex items-center gap-3">
                  <div className="w-16 text-sm font-medium">{locale}</div>
                  <div className="flex-1 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className="h-2 bg-brand-600"
                      style={{ width: `${pctShare.toFixed(1)}%` }}
                    />
                  </div>
                  <div className="w-20 text-right text-xs text-ink-500">
                    {row.views} UV
                  </div>
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

        {/* AI suggestions */}
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

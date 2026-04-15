'use client';
import Link from 'next/link';
import type { LandingPage } from '@/lib/types';
import { nativeLabel } from '@/lib/i18n-detect';

export default function ProductPagesList({
  locale,
  pages,
}: {
  locale: string;
  pages: LandingPage[];
}) {
  if (pages.length === 0) {
    return (
      <div className="card mt-8 p-10 text-center text-ink-500">
        还没有落地页。点右上角新建一个。
      </div>
    );
  }
  return (
    <div className="mt-6 space-y-3">
      {pages.map((p) => {
        const cvr = p.stats.views > 0 ? (p.stats.leads / p.stats.views) * 100 : 0;
        return (
          <div key={p.id} className="card p-5">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">{p.name}</h3>
                  <span className="pill text-[11px]">
                    {p.purpose === 'main' ? '主站' : p.purpose}
                  </span>
                  <span className="pill text-[11px]">{p.targetMarket}</span>
                  <span
                    className={`pill text-[11px] ${
                      p.published ? 'border-brand-200 bg-brand-50 text-brand-700' : ''
                    }`}
                  >
                    {p.published ? '已发布' : '草稿'}
                  </span>
                  {p.publishMode === 'ab-split' && (
                    <span className="pill text-[11px]">A/B 分流</span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {p.availableLocales.map((l) => (
                    <span key={l} className="pill text-[11px]">
                      {nativeLabel(l)}
                      {l === p.defaultLocale && ' ★'}
                    </span>
                  ))}
                </div>
                <div className="mt-2 text-xs text-ink-500">
                  📊 {p.stats.views.toLocaleString()} UV · {p.stats.leads.toLocaleString()} leads
                  {p.stats.views > 0 && ` · ${cvr.toFixed(2)}% CVR`}
                </div>
              </div>
              <div className="flex gap-2">
                {p.published && (
                  <a
                    className="btn btn-secondary px-3 py-1.5 text-xs"
                    href={`/p/${p.slug}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看 ↗
                  </a>
                )}
                <Link
                  href={`/${locale}/projects/${p.id}`}
                  className="btn btn-primary px-3 py-1.5 text-xs"
                >
                  编辑
                </Link>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

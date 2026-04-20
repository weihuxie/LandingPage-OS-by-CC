'use client';

/**
 * Dashboard product card.
 *
 * Used to be an inline server-rendered <Link>…</Link> in dashboard/page.tsx.
 * Pulled out into a client component because we needed:
 *   1. A kebab menu with stateful open/close (useState).
 *   2. Document-click listener to close the menu on outside click
 *      (useEffect).
 *   3. Event handlers that stopPropagation so the kebab click doesn't
 *      accidentally navigate into the product detail page.
 *
 * Layout uses the "cover link" pattern: card is a plain <div> with
 * `position: relative`, and a transparent <Link> is stretched over it
 * with `absolute inset-0`. Interactive children (the kebab) sit at a
 * higher z-index so they receive clicks. This avoids invalid
 * `<button>` inside `<a>` while preserving the "click anywhere on the
 * card to open" affordance.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Product, LandingPage } from '@/lib/types';
import DeleteButton from './DeleteButton';

export default function ProductCard({
  locale,
  product,
  pages,
}: {
  locale: string;
  product: Product;
  pages: LandingPage[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);

  // Close the menu when the user clicks anywhere outside it. Without
  // this the menu stays open forever after a stray mis-click, covering
  // the card beneath it.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [menuOpen]);

  const published = pages.filter((pg) => pg.published);
  const totalViews = pages.reduce((s, pg) => s + (pg.stats?.views ?? 0), 0);
  const totalLeads = pages.reduce((s, pg) => s + (pg.stats?.leads ?? 0), 0);
  const localesList = Array.from(
    new Set(pages.flatMap((pg) => pg.availableLocales)),
  );

  // Confirm-dialog body for the Product delete. We list every page so
  // the user sees exactly what cascade-delete will wipe — matches the
  // pattern from deleteLocale in Editor.tsx which also spells out the
  // scope of the destruction before doing it.
  const pageSummary =
    pages.length > 0
      ? `会连同以下 ${pages.length} 张落地页一起永久删除：\n` +
        pages
          .map((p) => `· ${p.name}（${p.availableLocales.join(' · ')}）`)
          .join('\n')
      : '该产品下目前没有落地页。';

  return (
    <div className="card relative block p-5 transition hover:border-brand-200 hover:shadow-soft">
      {/* Cover link: full-bleed, zero content, sits at z-0. Click anywhere
          on the card (except the kebab) opens the product detail page. */}
      <Link
        href={`/${locale}/products/${product.id}`}
        aria-label={`打开 ${product.name}`}
        className="absolute inset-0 z-0 rounded-[inherit]"
      />

      <div className="relative z-10 flex items-start justify-between">
        <div className="min-w-0 flex-1 pr-2">
          <div className="text-sm text-ink-500">{product.category || ' '}</div>
          <h3 className="mt-1 text-lg font-semibold">{product.name}</h3>
        </div>
        <div className="flex items-start gap-1.5">
          <div ref={menuWrapRef} className="relative">
            <button
              type="button"
              aria-label="更多操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="rounded p-1 text-lg leading-none text-ink-400 transition hover:bg-ink-50 hover:text-ink-900"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setMenuOpen((o) => !o);
              }}
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-md border border-ink-200 bg-white py-1 shadow-lg"
              >
                <DeleteButton
                  endpoint={`/api/products/${product.id}`}
                  confirmTitle={`删除产品「${product.name}」？`}
                  confirmDetail={pageSummary}
                  className="block w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  🗑 删除产品
                </DeleteButton>
              </div>
            )}
          </div>
          <div
            className="h-6 w-6 rounded-md"
            style={{ background: product.theme.primary }}
            aria-hidden
          />
        </div>
      </div>

      <p className="relative z-10 mt-2 line-clamp-2 text-sm text-ink-500">
        {product.tagline}
      </p>
      <div className="relative z-10 mt-4 flex flex-wrap gap-1.5 text-xs">
        <span className="pill">
          📄 {pages.length} 页面 · {published.length} 已发布
        </span>
        {localesList.length > 0 && (
          <span className="pill">🌐 {localesList.join(' · ')}</span>
        )}
      </div>
      <div className="relative z-10 mt-4 flex items-center justify-between text-xs text-ink-500">
        <span>
          📊 {totalViews.toLocaleString()} UV ·{' '}
          {totalLeads.toLocaleString()} leads
        </span>
        <span className="text-brand-700">打开产品 →</span>
      </div>
    </div>
  );
}

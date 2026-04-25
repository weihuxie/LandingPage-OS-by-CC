import { notFound } from 'next/navigation';
import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';
import { unstable_noStore as noStore } from 'next/cache';
import { getProduct, readLandingPages } from '@/lib/storage';
import { nativeLabel } from '@/lib/i18n-detect';
import ProductPagesList from '@/components/ProductPagesList';
import DeleteButton from '@/components/DeleteButton';

// `revalidate = 0` + noStore() are required in addition to force-dynamic
// to opt this route's Upstash-backed KV reads out of Next.js 14's
// automatic fetch Data Cache. See §一.4 in CLAUDE.md for the full story.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProductDetailPage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  unstable_setRequestLocale(params.locale);
  noStore();
  // readLandingPages keys off the product id, which equals params.id
  // before the 404 check — so we can run both KV reads in parallel
  // instead of waiting one round-trip for getProduct() to return.
  // On warm-lambda + KV that saves ~50–100ms; on cold start it's
  // bigger because both round-trips overlap with the cold-start
  // latency instead of stacking on it.
  const [product, pages] = await Promise.all([
    getProduct(params.id),
    readLandingPages(params.id),
  ]);
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Link href={`/${params.locale}/dashboard`} className="text-sm text-ink-500 hover:text-ink-900">
        ← 我的产品
      </Link>
      <div className="mt-2 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-xl border border-ink-100"
              style={{ background: product.theme.primary }}
              aria-hidden
            />
            <div>
              <h1 className="text-2xl font-semibold">{product.name}</h1>
              <p className="text-sm text-ink-500">
                {product.category ? `${product.category} · ` : ''}
                {product.website ? (
                  <a href={product.website} target="_blank" rel="noreferrer" className="hover:text-ink-900">
                    {product.website}
                  </a>
                ) : (
                  '官网未填'
                )}
              </p>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-sm text-ink-700">{product.tagline}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/${params.locale}/new?productId=${product.id}`}
            className="btn btn-primary"
          >
            + 新建落地页
          </Link>
          {/* Destructive action kept in the same strip as create, but
              styled as a plain-text link so it doesn't compete visually
              with the primary CTA. Cascade scope is spelled out in the
              confirm dialog, matching the pattern in ProductCard. */}
          <DeleteButton
            endpoint={`/api/products/${product.id}`}
            confirmTitle={`删除产品「${product.name}」？`}
            confirmDetail={
              pages.length > 0
                ? `会连同以下 ${pages.length} 张落地页一起永久删除：\n` +
                  pages
                    .map((p) => `· ${p.name}（${p.availableLocales.join(' · ')}）`)
                    .join('\n')
                : '该产品下目前没有落地页。'
            }
            onDeletedHref={`/${params.locale}/dashboard`}
            className="text-sm text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
          >
            删除产品
          </DeleteButton>
        </div>
      </div>

      <ProductPagesList locale={params.locale} pages={pages} />

      {/* Feishu #6 — guide users to the right place for product-level
          assets. The global /assets library only exposes brand / compliance
          / press now; testimonials / case studies / media belong on the
          product and are edited inline per module. */}
      <div className="mt-8 rounded-2xl border border-ink-100 bg-ink-100/20 p-4 text-[11px] leading-relaxed text-ink-500">
        💡 <strong className="text-ink-700">本产品的资产（证言 / 案例 / 截图 / 视频）</strong>
        在各落地页的模块编辑器里直接添加 —— 按模块就地维护，AI 生成时会自动匹配本产品上下文。
        跨产品共享的企业资产（品牌 / 合规 / 媒体）在{' '}
        <Link href={`/${params.locale}/assets`} className="text-brand-700 hover:underline">
          企业信任资产库
        </Link>{' '}
        里维护。
      </div>
    </div>
  );
}

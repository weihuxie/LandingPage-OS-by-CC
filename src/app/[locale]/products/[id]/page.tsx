import { notFound } from 'next/navigation';
import Link from 'next/link';
import { unstable_setRequestLocale } from 'next-intl/server';
import { unstable_noStore as noStore } from 'next/cache';
import { getProduct, readLandingPages } from '@/lib/storage';
import { nativeLabel } from '@/lib/i18n-detect';
import ProductPagesList from '@/components/ProductPagesList';

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
  const product = await getProduct(params.id);
  if (!product) notFound();
  const pages = await readLandingPages(product.id);

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
        <Link
          href={`/${params.locale}/new?productId=${product.id}`}
          className="btn btn-primary"
        >
          + 新建落地页
        </Link>
      </div>

      <ProductPagesList locale={params.locale} pages={pages} />
    </div>
  );
}

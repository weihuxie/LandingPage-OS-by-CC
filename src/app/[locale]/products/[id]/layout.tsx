/**
 * Auth + tenant gate for /[locale]/products/[id]/* routes.
 *
 * Why this layout exists (the only reason): the co-located `loading.tsx`
 * makes Next.js 14 auto-wrap `page.tsx` in `<Suspense>`. Streaming starts
 * with the loading skeleton — which means the response status header
 * (200) is committed BEFORE the page's tenant check can call
 * `notFound()`. Cross-tenant access ended up as 200 + not-found UI
 * instead of an honest 404 (status leak even though body was correct).
 *
 * Doing the tenant check here, in the layout, runs it BEFORE the
 * Suspense boundary — `notFound()` here throws before any streaming
 * starts and the response cleanly ends as 404.
 *
 * Trade-off: the layout's `getProduct` is a second KV read on every
 * page load (page.tsx still needs the product for rendering). Cost is
 * ~50-100ms per request to preserve both the loading.tsx UX skeleton
 * AND the strict 404 status.
 *
 * See: tests/api/cross-tenant-isolation.spec.ts API-TENANT-404-417.
 */
import { notFound } from 'next/navigation';
import { unstable_setRequestLocale } from 'next-intl/server';
import { unstable_noStore as noStore } from 'next/cache';
import { getProduct } from '@/lib/storage';
import { requireUserAndTenant } from '@/lib/server-auth';

// Layouts that read storage need the same Data Cache opt-out as pages
// (CLAUDE.md §一.4.1). Without these the layout-level KV read would be
// pinned for ~5min, defeating the auth-freshness intent.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProductDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string; id: string };
}) {
  unstable_setRequestLocale(params.locale);
  const { tenant } = await requireUserAndTenant(
    `/${params.locale}/products/${params.id}`,
  );
  noStore();
  const product = await getProduct(params.id);
  // 404 covers both "no such product" and "wrong tenant" — same UX,
  // no info leak about whether the id exists.
  if (!product || product.tenantId !== tenant.id) notFound();
  return <>{children}</>;
}

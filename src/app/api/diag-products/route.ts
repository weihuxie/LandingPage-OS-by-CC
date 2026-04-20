import { NextResponse } from 'next/server';
import { readProducts, readLandingPages, storageBackend } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Diagnostic — replicates the dashboard's data-fetch pattern exactly
 * (Promise.all + readProducts + readLandingPages) so we can compare
 * against /api/products and confirm whether the discrepancy is in:
 *   (a) readProducts() itself returning different results per caller
 *   (b) dashboard rendering filtering products
 *   (c) some SSR-specific caching the API doesn't hit
 */
export async function GET() {
  const [products, pages] = await Promise.all([readProducts(), readLandingPages()]);
  return NextResponse.json({
    storage: storageBackend(),
    productCount: products.length,
    pageCount: pages.length,
    productIds: products.map((p) => p.id).sort(),
    productNames: products.map((p) => `${p.id} ${p.name}`).sort(),
  });
}

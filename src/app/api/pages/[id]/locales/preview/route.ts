import { NextRequest, NextResponse } from 'next/server';
import { getLandingPage, getProduct } from '@/lib/storage';
import { proposeLocalization } from '@/lib/localization';
import type { MarketCode, PageLocale } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Preview the localization strategy for adding `locale` (and optional
 * `market`) to an existing LandingPage. Returns the proposed strategy;
 * client renders it, user edits, then POST /api/pages/:id/locales with
 * the approved strategy.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const page = await getLandingPage(params.id);
  if (!page) return NextResponse.json({ error: 'page not found' }, { status: 404 });
  const product = await getProduct(page.productId);
  if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 });

  const body = (await req.json()) as { locale: PageLocale; market?: MarketCode };
  if (!body.locale) return NextResponse.json({ error: 'locale required' }, { status: 400 });

  const strategy = proposeLocalization(page, product, body.locale, body.market);
  return NextResponse.json({ strategy });
}

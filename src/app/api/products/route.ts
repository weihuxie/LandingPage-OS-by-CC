import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import {
  LEGACY_TENANT_ID,
  readProducts,
  saveProduct,
} from '@/lib/storage';
import { defaultStyleForMarket } from '@/lib/styles';
import type { Product } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const products = await readProducts();
  return NextResponse.json({ products });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<Product>;
  if (!body.name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  const now = Date.now();
  // S2 / C1: tenantId still LEGACY_TENANT_ID until C3 wires up
  // requireUser() and stamps the caller's actual tenant. Existing
  // unauthenticated POST keeps working in the meantime.
  const product: Product = {
    id: `p_${nanoid(10)}`,
    tenantId: LEGACY_TENANT_ID,
    createdAt: now,
    updatedAt: now,
    name: body.name,
    tagline: body.tagline ?? '',
    category: body.category ?? '',
    value: body.value ?? '',
    website: body.website,
    theme: {
      primary: body.theme?.primary ?? '#4861ff',
      styleId: body.theme?.styleId ?? defaultStyleForMarket('GLOBAL'),
      fontStack: body.theme?.fontStack,
      logoUrl: body.theme?.logoUrl,
    },
    assets: {
      testimonials: [],
      cases: [],
      media: [],
    },
    landingPageIds: [],
  };
  await saveProduct(product);
  return NextResponse.json({ product });
}

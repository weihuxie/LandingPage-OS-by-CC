import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import {
  readProducts,
  saveProduct,
} from '@/lib/storage';
import { defaultStyleForMarket } from '@/lib/styles';
import { requireUserApi } from '@/lib/server-auth';
import type { Product } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const products = await readProducts({ tenantId: auth.tenant.id });
  return NextResponse.json({ products });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const body = (await req.json()) as Partial<Product>;
  if (!body.name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  const now = Date.now();
  const product: Product = {
    id: `p_${nanoid(10)}`,
    tenantId: auth.tenant.id,
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

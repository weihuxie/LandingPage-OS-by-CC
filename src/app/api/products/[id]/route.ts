import { NextRequest, NextResponse } from 'next/server';
import {
  getProduct,
  saveProduct,
  deleteProductAndPages,
  readLandingPages,
} from '@/lib/storage';
import { requireUserApi } from '@/lib/server-auth';
import type { Product } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Convenience: 404 covers both "no such product" and "wrong tenant" so
// neighbours can't probe the existence of other tenants' product ids.
function notFound(): NextResponse {
  return NextResponse.json({ error: 'not found' }, { status: 404 });
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const product = await getProduct(params.id);
  if (!product || product.tenantId !== auth.tenant.id) return notFound();
  const pages = await readLandingPages({ tenantId: auth.tenant.id, productId: product.id });
  return NextResponse.json({ product, pages });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const product = await getProduct(params.id);
  if (!product || product.tenantId !== auth.tenant.id) return notFound();
  const body = (await req.json()) as Partial<Product>;
  const next: Product = {
    ...product,
    ...body,
    // tenantId is immutable — strip any caller attempt to reassign so
    // there's no hand-written escape hatch for cross-tenant moves.
    tenantId: product.tenantId,
    theme: { ...product.theme, ...(body.theme ?? {}) },
    assets: { ...product.assets, ...(body.assets ?? {}) },
  };
  await saveProduct(next);
  return NextResponse.json({ product: next });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const product = await getProduct(params.id);
  if (!product || product.tenantId !== auth.tenant.id) return notFound();
  await deleteProductAndPages(params.id);
  return NextResponse.json({ ok: true });
}

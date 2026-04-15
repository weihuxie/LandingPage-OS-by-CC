import { NextRequest, NextResponse } from 'next/server';
import {
  getProduct,
  saveProduct,
  deleteProductAndPages,
  readLandingPages,
} from '@/lib/storage';
import type { Product } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const product = await getProduct(params.id);
  if (!product) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const pages = await readLandingPages(product.id);
  return NextResponse.json({ product, pages });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const product = await getProduct(params.id);
  if (!product) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = (await req.json()) as Partial<Product>;
  const next: Product = {
    ...product,
    ...body,
    theme: { ...product.theme, ...(body.theme ?? {}) },
    assets: { ...product.assets, ...(body.assets ?? {}) },
  };
  await saveProduct(next);
  return NextResponse.json({ product: next });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await deleteProductAndPages(params.id);
  return NextResponse.json({ ok: true });
}

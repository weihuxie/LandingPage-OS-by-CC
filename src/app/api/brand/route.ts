import { NextRequest, NextResponse } from 'next/server';
import { readBrand, writeBrand } from '@/lib/storage';
import type { Brand } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const brand = await readBrand();
  return NextResponse.json({ brand });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Partial<Brand>;
  const current = await readBrand();
  const next: Brand = { ...current, ...body };
  await writeBrand(next);
  return NextResponse.json({ brand: next });
}

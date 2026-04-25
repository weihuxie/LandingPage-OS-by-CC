import { NextRequest, NextResponse } from 'next/server';
import { readBrand, writeBrand } from '@/lib/storage';
import { requireUserApi } from '@/lib/server-auth';
import type { Brand } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const brand = await readBrand({ tenantId: auth.tenant.id });
  return NextResponse.json({ brand });
}

export async function PUT(req: NextRequest) {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const body = (await req.json()) as Partial<Brand>;
  const current = await readBrand({ tenantId: auth.tenant.id });
  // tenantId is derived from session, never accepted from the body — so
  // a logged-in user can't reassign brand assets to someone else's
  // tenant by hand-crafting the PUT body.
  const next: Brand = { ...current, ...body, tenantId: auth.tenant.id };
  await writeBrand(next);
  return NextResponse.json({ brand: next });
}

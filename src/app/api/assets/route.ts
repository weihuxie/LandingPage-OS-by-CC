import { NextRequest, NextResponse } from 'next/server';
import { readAssets, writeAssets } from '@/lib/storage';
import { requireUserApi } from '@/lib/server-auth';
import type { AssetLibrary } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// AssetLibrary is still global / pre-tenant under the hood (legacy
// 'lp:assets' key). S2 only adds the login gate so visitors can't see
// brand assets without auth; per-tenant scoping of asset library lands
// in a follow-up if/when the asset library moves out of legacy storage.
export async function GET() {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const assets = await readAssets();
  return NextResponse.json({ assets });
}

export async function PUT(req: NextRequest) {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const body = (await req.json()) as AssetLibrary;
  await writeAssets(body);
  return NextResponse.json({ ok: true });
}

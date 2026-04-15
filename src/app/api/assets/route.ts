import { NextRequest, NextResponse } from 'next/server';
import { readAssets, writeAssets } from '@/lib/storage';
import type { AssetLibrary } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const assets = await readAssets();
  return NextResponse.json({ assets });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as AssetLibrary;
  await writeAssets(body);
  return NextResponse.json({ ok: true });
}

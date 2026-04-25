import { NextRequest, NextResponse } from 'next/server';
import { extractBrand } from '@/lib/brand';
import { requireUserApi } from '@/lib/server-auth';

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const { url } = await req.json();
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url required' }, { status: 400 });
  }
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const result = await extractBrand(normalized);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ candidates: [], source: 'none' });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { generateStrategy } from '@/lib/ai';

export async function POST(req: NextRequest) {
  const { inputs } = await req.json();
  if (!inputs) return NextResponse.json({ error: 'inputs required' }, { status: 400 });
  const strategy = generateStrategy(inputs);
  return NextResponse.json({ strategy });
}

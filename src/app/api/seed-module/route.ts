import { NextRequest, NextResponse } from 'next/server';
import { generateModules } from '@/lib/ai';
import type { ProductInputs, ToneKey, ModuleType } from '@/lib/types';

export async function POST(req: NextRequest) {
  const { inputs, tone, type } = (await req.json()) as {
    inputs: ProductInputs;
    tone: ToneKey;
    type: ModuleType;
  };
  if (!inputs || !type)
    return NextResponse.json({ error: 'inputs and type required' }, { status: 400 });
  const all = generateModules(inputs, tone);
  const seed = all.find((m) => m.type === type);
  if (!seed) return NextResponse.json({ error: 'unknown type' }, { status: 400 });
  return NextResponse.json({ module: seed });
}

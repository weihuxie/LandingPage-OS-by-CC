import { NextRequest, NextResponse } from 'next/server';
import { readRaw, writeRaw } from '@/lib/storage-access';
import type { LocalizationStrategy, PageLocale, MarketCode } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Template {
  id: string;
  name: string;
  targetLocale: PageLocale;
  targetMarket?: MarketCode;
  strategy: LocalizationStrategy;
  createdAt: number;
}

const KEY = 'lp:v2:localization-templates';

export async function GET() {
  const list = (await readRaw<Template[]>(KEY, [])) ?? [];
  return NextResponse.json({ templates: list });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Template;
  if (!body?.strategy || !body?.name)
    return NextResponse.json({ error: 'name+strategy required' }, { status: 400 });

  const list = (await readRaw<Template[]>(KEY, [])) ?? [];
  const entry: Template = {
    id: body.id ?? `tpl_${Date.now().toString(36)}`,
    name: body.name,
    targetLocale: body.targetLocale,
    targetMarket: body.targetMarket,
    strategy: body.strategy,
    createdAt: Date.now(),
  };
  list.unshift(entry);
  await writeRaw(KEY, list.slice(0, 50)); // cap at 50 templates
  return NextResponse.json({ template: entry });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  const list = (await readRaw<Template[]>(KEY, [])) ?? [];
  await writeRaw(
    KEY,
    list.filter((t) => t.id !== id),
  );
  return NextResponse.json({ ok: true });
}

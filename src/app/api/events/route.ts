import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { appendEvent, getProjectBySlug } from '@/lib/storage';

export async function POST(req: NextRequest) {
  const { slug, type, variant, locale, referrer } = await req.json();
  if (!slug || !type) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  const p = await getProjectBySlug(slug);
  if (!p) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  await appendEvent({
    id: nanoid(10),
    projectId: p.id,
    variant: variant === 'A' || variant === 'B' ? variant : undefined,
    type,
    locale: locale ?? p.inputs.locale,
    country: req.headers.get('cf-ipcountry') ?? undefined,
    referrer,
    createdAt: Date.now(),
  });
  return NextResponse.json({ ok: true });
}

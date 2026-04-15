import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import {
  appendEvent,
  getLandingPageBySlug,
  getLandingPage,
  saveLandingPage,
} from '@/lib/storage';
import type { PageLocale, NarrativeVariant } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { slug, type, variant, locale, referrer } = await req.json();
  if (!slug || !type) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  const page = await getLandingPageBySlug(slug);
  if (!page) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const v: NarrativeVariant | undefined = variant === 'A' || variant === 'B' ? variant : undefined;
  const lo: PageLocale = locale ?? page.defaultLocale;

  await appendEvent({
    id: nanoid(10),
    projectId: page.id,
    variant: v,
    type,
    locale: lo,
    country: req.headers.get('cf-ipcountry') ?? req.headers.get('x-vercel-ip-country') ?? undefined,
    referrer,
    createdAt: Date.now(),
  });

  // Update v2 locale/variant stats on the page (views only; leads handled in /api/leads)
  if (type === 'view') {
    const fresh = await getLandingPage(page.id);
    if (fresh) {
      fresh.stats.views = (fresh.stats.views ?? 0) + 1;
      const byLo = fresh.stats.byLocale[lo] ?? { views: 0, leads: 0 };
      byLo.views += 1;
      fresh.stats.byLocale[lo] = byLo;
      if (v) {
        fresh.stats.abStats[v].views += 1;
        const vLocaleStats = fresh.stats.byVariantLocale[v] ?? {};
        const row = vLocaleStats[lo] ?? { views: 0, leads: 0 };
        row.views += 1;
        vLocaleStats[lo] = row;
        fresh.stats.byVariantLocale[v] = vLocaleStats;
      }
      await saveLandingPage(fresh);
    }
  }

  return NextResponse.json({ ok: true });
}

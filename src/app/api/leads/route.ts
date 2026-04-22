import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import {
  appendLead,
  readLeads,
  getLandingPageBySlug,
  getLandingPage,
  saveLandingPage,
} from '@/lib/storage';
import type { Lead, PageLocale, NarrativeVariant } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId') ?? undefined;
  const leads = await readLeads(projectId);
  return NextResponse.json({ leads });
}

// Kept in sync with LeadFormClient.tsx. Server validation is required
// because the client form can be bypassed (curl / replayed requests)
// and "asdf" phone entries pollute lead exports downstream.
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { slug, name, email, company, phone, message, locale, variant } = body;
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
  const page = await getLandingPageBySlug(slug);
  if (!page) return NextResponse.json({ error: 'page not found' }, { status: 404 });

  // Phone is optional. Only reject if the field is present AND doesn't
  // match the permissive phone shape. Empty string / undefined is fine.
  if (typeof phone === 'string' && phone.trim() && !PHONE_RE.test(phone.trim())) {
    return NextResponse.json(
      { error: 'invalid_phone', message: 'Phone number format is invalid.' },
      { status: 400 },
    );
  }

  const v: NarrativeVariant | undefined = variant === 'A' || variant === 'B' ? variant : undefined;
  const lo: PageLocale = locale ?? page.defaultLocale;

  const lead: Lead = {
    id: nanoid(10),
    projectId: page.id,
    createdAt: Date.now(),
    name, email, company, phone, message,
    locale: lo,
    variant: v,
  };
  await appendLead(lead);

  // Update v2 stats on the LandingPage
  const fresh = await getLandingPage(page.id);
  if (fresh) {
    fresh.stats.leads = (fresh.stats.leads ?? 0) + 1;
    const byLo = fresh.stats.byLocale[lo] ?? { views: 0, leads: 0 };
    byLo.leads += 1;
    fresh.stats.byLocale[lo] = byLo;
    if (v) {
      fresh.stats.abStats[v].leads += 1;
      const vLocaleStats = fresh.stats.byVariantLocale[v] ?? {};
      const row = vLocaleStats[lo] ?? { views: 0, leads: 0 };
      row.leads += 1;
      vLocaleStats[lo] = row;
      fresh.stats.byVariantLocale[v] = vLocaleStats;
    }
    await saveLandingPage(fresh);
  }

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { getLandingPage, saveLandingPage } from '@/lib/storage';
import type { NarrativeVariant, PageLocale, PageModule } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Write modules for a specific (variant, locale) cell of a LandingPage.
 * Used by the editor's locale tabs so edits on the JP tab don't clobber
 * the EN tab and vice-versa.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const page = await getLandingPage(params.id);
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = (await req.json()) as {
    variant: NarrativeVariant;
    locale: PageLocale;
    modules: PageModule[];
  };
  if (!body.variant || !body.locale || !Array.isArray(body.modules)) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  page.variants[body.variant][body.locale] = body.modules;
  await saveLandingPage(page);
  return NextResponse.json({ page });
}

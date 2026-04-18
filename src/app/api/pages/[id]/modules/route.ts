import { NextRequest, NextResponse } from 'next/server';
import { getLandingPage, saveLandingPage, getProduct } from '@/lib/storage';
import type { NarrativeVariant, PageLocale, PageModule } from '@/lib/types';
import { reportHeroTemplate } from '@/lib/template-detection';

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

  // Recompute hydrationFailed — a user who manually edits the hero
  // headline away from the template should clear the warning banner.
  if (page.hydrationFailed) {
    const product = await getProduct(page.productId);
    if (product) {
      const reports = [
        ...Object.values(page.variants.A).map((m) => m && reportHeroTemplate(m, product.name)),
        ...Object.values(page.variants.B).map((m) => m && reportHeroTemplate(m, product.name)),
      ].filter((r): r is NonNullable<typeof r> => !!r);
      page.hydrationFailed = reports.length > 0 && reports.every((r) => r.anyTemplate);
    }
  }

  await saveLandingPage(page);
  return NextResponse.json({ page });
}

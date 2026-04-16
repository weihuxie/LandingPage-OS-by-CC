import { NextRequest, NextResponse } from 'next/server';
import { getLandingPage, getProduct, readLeads } from '@/lib/storage';
import { projectViewFromV2 } from '@/lib/migrate-v2';

export const dynamic = 'force-dynamic';

/**
 * Debug endpoint that mimics exactly what /[locale]/projects/[id]/page.tsx
 * does, line-by-line, to diagnose why the page returns 404 when the API
 * finds data. This endpoint will be deleted after the bug is fixed.
 */
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const result: Record<string, any> = { id: params.id, steps: {} };

  try {
    const page = await getLandingPage(params.id);
    result.steps.page = page ? { id: page.id, slug: page.slug, productId: page.productId } : null;

    if (!page) {
      result.steps.pageResult = 'NOT_FOUND → notFound() would fire';
      return NextResponse.json(result);
    }

    const product = await getProduct(page.productId);
    result.steps.product = product ? { id: product.id, name: product.name } : null;

    if (!product) {
      result.steps.productResult = 'NOT_FOUND → notFound() would fire on product lookup';
      return NextResponse.json(result);
    }

    const leads = await readLeads(page.id);
    result.steps.leads = leads.length;

    const projectView = projectViewFromV2(page, product);
    result.steps.projectView = {
      id: projectView.id,
      slug: projectView.slug,
      modulesCount: projectView.modules?.length ?? 0,
    };

    result.steps.finalResult = 'OK — would render editor';
  } catch (e: any) {
    result.steps.error = { message: e?.message, stack: e?.stack?.slice(0, 500) };
  }

  return NextResponse.json(result);
}

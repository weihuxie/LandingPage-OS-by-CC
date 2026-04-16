import { NextRequest, NextResponse } from 'next/server';
import {
  getLandingPage,
  getProduct,
  readLeads,
  readLandingPages,
  storageBackend,
} from '@/lib/storage';
import { projectViewFromV2 } from '@/lib/migrate-v2';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const result: Record<string, any> = { id: params.id, steps: {} };

  try {
    // Diagnostics
    result.steps.backend = storageBackend();
    result.steps.kvUrl = process.env.KV_REST_API_URL ? 'set' : 'NOT_SET';

    // Read ALL pages first to see what getLandingPage is scanning
    const allPages = await readLandingPages();
    result.steps.allPagesCount = allPages.length;
    result.steps.allPageIds = allPages.map((p) => p.id);
    // Estimate KV payload size to check if it's hitting Upstash limits
    result.steps.estimatedKvSizeKB = Math.round(JSON.stringify(allPages).length / 1024);

    const page = await getLandingPage(params.id);
    result.steps.page = page ? { id: page.id, slug: page.slug, productId: page.productId } : null;

    if (!page) {
      result.steps.pageResult = 'NOT_FOUND → notFound() would fire';
      result.steps.hint = allPages.length === 0
        ? 'readLandingPages() returned empty — KV might not have v2 data, or migration not run'
        : `readLandingPages() returned ${allPages.length} pages but none match id='${params.id}'`;
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

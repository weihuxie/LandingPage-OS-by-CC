import { NextRequest, NextResponse } from 'next/server';
import {
  getLandingPage,
  getProduct,
  readLeads,
  readLandingPages,
  storageBackend,
} from '@/lib/storage';
import { kv } from '@vercel/kv';
import { projectViewFromV2 } from '@/lib/migrate-v2';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const result: Record<string, any> = { id: params.id, steps: {} };

  try {
    result.steps.backend = storageBackend();
    result.steps.kvUrlDot = process.env.KV_REST_API_URL ? 'set' : 'NOT_SET';
    result.steps.kvUrlBracket = process.env['KV_REST_API_URL'] ? 'set' : 'NOT_SET';
    result.steps.kvTokenDot = process.env.KV_REST_API_TOKEN ? 'set' : 'NOT_SET';
    result.steps.kvTokenBracket = process.env['KV_REST_API_TOKEN'] ? 'set' : 'NOT_SET';
    result.steps.vercelDot = process.env.VERCEL;
    result.steps.vercelBracket = process.env['VERCEL'];

    // RAW KV read — bypass my abstraction layer entirely
    let rawKvPages: any[] = [];
    try {
      const raw = await kv.get('lp:v2:pages');
      rawKvPages = Array.isArray(raw) ? raw : [];
    } catch (e: any) {
      result.steps.rawKvError = e?.message?.slice(0, 200);
    }
    result.steps.rawKvPagesCount = rawKvPages.length;
    result.steps.rawKvPageIds = rawKvPages.map((p: any) => p?.id);
    result.steps.rawKvSizeKB = Math.round(JSON.stringify(rawKvPages).length / 1024);
    result.steps.rawKvHasTargetId = rawKvPages.some((p: any) => p?.id === params.id);

    // Now through my abstraction
    const allPages = await readLandingPages();
    result.steps.abstractionPagesCount = allPages.length;
    result.steps.abstractionPageIds = allPages.map((p) => p.id);

    const page = await getLandingPage(params.id);
    result.steps.page = page ? { id: page.id, slug: page.slug, productId: page.productId } : null;

    if (!page) {
      result.steps.pageResult = 'NOT_FOUND';
      result.steps.diagnosis =
        rawKvPages.some((p: any) => p?.id === params.id)
          ? 'FOUND in raw KV but NOT in abstraction — readRaw/readLandingPages has a bug'
          : 'NOT in raw KV either — data was never written or was overwritten';
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

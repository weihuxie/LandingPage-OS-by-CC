import { notFound } from 'next/navigation';
import {
  getLandingPage,
  getProduct,
  readLeads,
  readLandingPages,
  storageBackend,
} from '@/lib/storage';
import { projectViewFromV2 } from '@/lib/migrate-v2';
import Editor from '@/components/Editor';
import { unstable_setRequestLocale } from 'next-intl/server';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  unstable_setRequestLocale(params.locale);

  // DEBUG: diagnose server component env / KV access
  const debugMode = params.id === '_debug';
  if (debugMode) {
    const allPages = await readLandingPages();
    const backend = storageBackend();
    const kvUrl = process.env['KV_REST_API_URL'];
    return (
      <pre style={{ padding: 40, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        {JSON.stringify({
          backend,
          kvUrlSet: !!kvUrl,
          kvUrlLast12: kvUrl ? kvUrl.slice(-12) : 'NOT_SET',
          pagesCount: allPages.length,
          pageIds: allPages.map(p => p.id).slice(0, 10),
        }, null, 2)}
      </pre>
    );
  }

  const page = await getLandingPage(params.id);
  if (!page) {
    // TEMP DEBUG: instead of notFound(), show diagnostic
    const allPages = await readLandingPages();
    return (
      <pre style={{ padding: 40 }}>
        {JSON.stringify({
          error: 'page_not_found',
          id: params.id,
          backend: storageBackend(),
          allPagesCount: allPages.length,
          allPageIds: allPages.map(p => p.id),
        }, null, 2)}
      </pre>
    );
  }
  const product = await getProduct(page.productId);
  if (!product) {
    return (
      <pre style={{ padding: 40 }}>
        {JSON.stringify({
          error: 'product_not_found',
          pageId: page.id,
          productId: page.productId,
        }, null, 2)}
      </pre>
    );
  }

  const leads = await readLeads(page.id);
  const projectView = projectViewFromV2(page, product);

  return (
    <Editor
      locale={params.locale}
      initialProject={projectView}
      initialLeads={leads}
      initialPage={page}
    />
  );
}

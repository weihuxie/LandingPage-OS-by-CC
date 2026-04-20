import { notFound } from 'next/navigation';
import { getLandingPage, getProduct, readLeads } from '@/lib/storage';
import { projectViewFromV2 } from '@/lib/migrate-v2';
import Editor from '@/components/Editor';
import { unstable_setRequestLocale } from 'next-intl/server';
import { unstable_noStore as noStore } from 'next/cache';

// See CLAUDE.md §一.4 — opt out of the Data Cache so the editor loads
// the current KV state rather than a cached snapshot of whatever was
// true on some earlier render.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProjectPage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  unstable_setRequestLocale(params.locale);
  noStore();
  const page = await getLandingPage(params.id);
  if (!page) notFound();
  const product = await getProduct(page.productId);
  if (!product) notFound();

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

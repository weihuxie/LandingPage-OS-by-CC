import AssetLibraryPanel from '@/components/AssetLibraryPanel';
import { readAssets } from '@/lib/storage';
import { unstable_setRequestLocale } from 'next-intl/server';
import { unstable_noStore as noStore } from 'next/cache';
import { requireUserAndTenant } from '@/lib/server-auth';

// See CLAUDE.md §一.4 — force-dynamic alone doesn't prevent the Data
// Cache from serving a stale KV snapshot on the asset library.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AssetsPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  unstable_setRequestLocale(locale);
  // S2: gate behind login. readAssets is the legacy global asset library
  // (still pre-tenant). C5 / future work will scope it; for now login is
  // enough to remove "any visitor sees brand assets".
  await requireUserAndTenant(`/${locale}/assets`);
  noStore();
  const assets = await readAssets();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">企业信任资产库</h1>
        <p className="mt-1 text-sm text-ink-500">
          品牌 · 合规 · 媒体背书 —— 跨产品共享的企业级资产。
          客户证言 / 案例 / 截图等产品级资产请在各「产品」内维护。
        </p>
      </div>
      <AssetLibraryPanel initial={assets} />
    </div>
  );
}

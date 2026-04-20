import AssetLibraryPanel from '@/components/AssetLibraryPanel';
import { readAssets } from '@/lib/storage';
import { unstable_setRequestLocale } from 'next-intl/server';
import { unstable_noStore as noStore } from 'next/cache';

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
  noStore();
  const assets = await readAssets();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">信任资产库</h1>
        <p className="mt-1 text-sm text-ink-500">
          一次维护，所有项目复用。生成时 AI 会按痛点/市场自动匹配。
        </p>
      </div>
      <AssetLibraryPanel initial={assets} />
    </div>
  );
}

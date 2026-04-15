import AssetLibraryPanel from '@/components/AssetLibraryPanel';
import { readAssets } from '@/lib/storage';
import { unstable_setRequestLocale } from 'next-intl/server';

export const dynamic = 'force-dynamic';

export default async function AssetsPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  unstable_setRequestLocale(locale);
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

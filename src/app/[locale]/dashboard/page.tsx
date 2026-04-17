import { unstable_setRequestLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { readProducts, readLandingPages } from '@/lib/storage';
import { providerStatus } from '@/lib/llm';
import { storageBackend } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function Dashboard({
  params: { locale },
}: {
  params: { locale: string };
}) {
  unstable_setRequestLocale(locale);
  const [products, pages] = await Promise.all([readProducts(), readLandingPages()]);
  const llm = providerStatus();
  const storage = storageBackend();

  // Group pages by product
  const pagesByProduct = new Map<string, typeof pages>();
  for (const pg of pages) {
    const arr = pagesByProduct.get(pg.productId) ?? [];
    arr.push(pg);
    pagesByProduct.set(pg.productId, arr);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">我的产品</h1>
        <Link href={`/${locale}/new`} className="btn btn-primary">
          + 新建产品
        </Link>
      </div>

      {/* System status strip — at a glance LLM + storage health */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <StatusPill label="Claude" value={llm.claude} />
        <StatusPill label="Gemini" value={llm.gemini} />
        <StatusPill label="GPT-4o" value={llm.openai} />
        <span className="pill">💾 存储：{storage === 'kv' ? 'Vercel KV' : '本地文件'}</span>
        <Link href="/api/health" className="pill hover:border-brand-300">
          /api/health
        </Link>
      </div>

      {products.length === 0 && (
        // New-install hint to set keys, only shown before any product exists.
        llm.claude === 'mock' && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>LLM 跑在降级模板上。</strong> 在 Vercel 项目环境变量里加{' '}
            <code className="rounded bg-white px-1 py-0.5">ANTHROPIC_API_KEY</code>{' '}
            后重新部署，即可启用真 Claude + prompt caching。
          </div>
        )
      )}
      {products.length === 0 ? (
        <div className="card mt-8 p-10 text-center text-ink-500">
          还没有产品。点右上角创建你的第一个产品。
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            const myPages = pagesByProduct.get(p.id) ?? [];
            const published = myPages.filter((pg) => pg.published);
            const totalViews = myPages.reduce((s, pg) => s + (pg.stats?.views ?? 0), 0);
            const totalLeads = myPages.reduce((s, pg) => s + (pg.stats?.leads ?? 0), 0);
            const locales = Array.from(
              new Set(myPages.flatMap((pg) => pg.availableLocales)),
            );
            return (
              <Link
                key={p.id}
                href={`/${locale}/products/${p.id}`}
                className="card block p-5 transition hover:border-brand-200 hover:shadow-soft"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm text-ink-500">{p.category || ' '}</div>
                    <h3 className="mt-1 text-lg font-semibold">{p.name}</h3>
                  </div>
                  <div
                    className="h-6 w-6 rounded-md"
                    style={{ background: p.theme.primary }}
                    aria-hidden
                  />
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-ink-500">{p.tagline}</p>
                <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
                  <span className="pill">
                    📄 {myPages.length} 页面 · {published.length} 已发布
                  </span>
                  {locales.length > 0 && (
                    <span className="pill">🌐 {locales.join(' · ')}</span>
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-ink-500">
                  <span>
                    📊 {totalViews.toLocaleString()} UV · {totalLeads.toLocaleString()} leads
                  </span>
                  <span className="text-brand-700">打开产品 →</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  const live = value === 'live';
  return (
    <span
      className={`pill ${live ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-ink-100 bg-ink-50 text-ink-500'}`}
      title={live ? 'Real API key configured' : 'Falling back to deterministic templates'}
    >
      {live ? '🟢' : '⚪️'} {label}：{live ? 'live' : 'mock'}
    </span>
  );
}

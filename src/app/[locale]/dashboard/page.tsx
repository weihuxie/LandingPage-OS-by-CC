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

      {/* Persistent ops banner whenever critical capabilities are missing.
          Pre-cleanup this banner was gated on `products.length === 0`, so
          it disappeared the moment the user created their first product —
          and the rest of the app silently shipped template output. Now
          it stays as long as the keys aren't set. */}
      {llm.claude === 'missing' && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <strong>ANTHROPIC_API_KEY 未配置。</strong> 生成策略、重新生成文案、添加新语言都会返回 503。请在 Vercel Project Settings → Environment Variables 里加{' '}
          <code className="rounded bg-white px-1 py-0.5">ANTHROPIC_API_KEY</code>{' '}
          后重新部署。
        </div>
      )}
      {llm.openai === 'missing' && (
        <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <strong>OPENAI_API_KEY 未配置。</strong> 添加新语言的 GPT-4o 本地化pass 会失败，操作被拒绝。
        </div>
      )}
      {storage === 'fs' && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>当前用本地文件作为存储。</strong> 如果这是生产环境（Vercel），数据会在 lambda 冷启动时丢失。请配置{' '}
          <code className="rounded bg-white px-1 py-0.5">KV_REST_API_URL</code> + {' '}
          <code className="rounded bg-white px-1 py-0.5">KV_REST_API_TOKEN</code>。
        </div>
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
  const configured = value === 'configured';
  // Red-on-missing is intentional. Old styling was neutral grey with the
  // word "mock", which blended into the UI chrome and let operators
  // deploy without noticing that half the LLM stack wasn't wired. Red +
  // "未配置" is the loudest signal short of a full-screen modal.
  return (
    <span
      className={`pill ${
        configured
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-red-300 bg-red-50 text-red-800'
      }`}
      title={
        configured
          ? 'Real API key configured'
          : 'Key not set — any feature requiring this provider will return 503'
      }
    >
      {configured ? '🟢' : '🔴'} {label}：{configured ? '已配置' : '未配置'}
    </span>
  );
}

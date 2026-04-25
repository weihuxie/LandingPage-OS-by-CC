import { unstable_setRequestLocale } from 'next-intl/server';
import { unstable_noStore as noStore } from 'next/cache';
import Link from 'next/link';
import { readLeads, readLandingPages, readProducts } from '@/lib/storage';
import { requireUserAndTenant } from '@/lib/server-auth';

// Same Data Cache avoidance as /dashboard — see CLAUDE.md §一.4 and §一.4.1
// for why `force-dynamic` alone is not enough when reading KV.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Lead 列表与导出页 (Feishu 测试问题 #13)。
 *
 * MVP 把 lead 存得挺干净，但前端入口只有 `/api/leads` 的 JSON 返回
 * —— 用户想看谁留了资得自己 `curl` 一下。这页把所有 lead 铺平到
 * 一张表，支持 `?pageId=xxx` 按落地页过滤，带一个 "下载 CSV" 按钮
 * 导出 /api/leads/export。符合 CLAUDE.md §七.1 对 "只读实体必须有
 * export/archive 路径" 的豁免条款要求。
 */
export default async function LeadsPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams?: { pageId?: string; productId?: string };
}) {
  unstable_setRequestLocale(locale);
  // S2: gate behind login + scope all reads to current tenant
  const { tenant } = await requireUserAndTenant(`/${locale}/dashboard/leads`);
  noStore();

  const [leads, pages, products] = await Promise.all([
    readLeads({ tenantId: tenant.id }),
    readLandingPages({ tenantId: tenant.id }),
    readProducts({ tenantId: tenant.id }),
  ]);

  // Filters: `pageId` narrows to one landing page's leads; `productId`
  // narrows to all of that product's pages. Both optional — absent means
  // "show all leads the logged-in user can see" (S2 tenant enforcement
  // lands later; today this is every lead in KV).
  const pageFilter = searchParams?.pageId?.trim() || '';
  const productFilter = searchParams?.productId?.trim() || '';

  const pageById = new Map(pages.map((p) => [p.id, p]));
  const productById = new Map(products.map((p) => [p.id, p]));

  const filtered = leads.filter((lead) => {
    const page = pageById.get(lead.projectId);
    if (pageFilter && lead.projectId !== pageFilter) return false;
    if (productFilter && page?.productId !== productFilter) return false;
    return true;
  });

  // Sort newest first. `readLeads` already stores newest-first via unshift,
  // but keep the sort explicit so that reordering filters doesn't mislead.
  const sorted = [...filtered].sort((a, b) => b.createdAt - a.createdAt);

  const exportHref = (() => {
    const q = new URLSearchParams();
    if (pageFilter) q.set('pageId', pageFilter);
    if (productFilter) q.set('productId', productFilter);
    const qs = q.toString();
    return qs ? `/api/leads/export?${qs}` : '/api/leads/export';
  })();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">留资明细</h1>
          <p className="mt-1 text-sm text-ink-500">
            所有落地页 /api/leads 的提交记录 · 共 {sorted.length} 条
            {pageFilter && (
              <> · 筛选：{pageById.get(pageFilter)?.name ?? pageFilter}</>
            )}
            {productFilter && !pageFilter && (
              <> · 筛选：{productById.get(productFilter)?.name ?? productFilter}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(pageFilter || productFilter) && (
            <Link
              href={`/${locale}/dashboard/leads`}
              className="btn btn-secondary text-sm"
            >
              清除筛选
            </Link>
          )}
          <a
            href={exportHref}
            className="btn btn-primary text-sm"
            // download attr triggers Save As; route sets
            // Content-Disposition: attachment so even without this it
            // wouldn't open in-tab, but the hint is user-facing.
            download
          >
            ↓ 下载 CSV
          </a>
          <Link
            href={`/${locale}/dashboard`}
            className="btn btn-secondary text-sm"
          >
            ← 返回
          </Link>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="card mt-8 p-10 text-center text-ink-500">
          {pageFilter || productFilter
            ? '当前筛选下暂无留资。'
            : '还没有留资。分享落地页链接到渠道后，提交会汇总到这里。'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-ink-100 bg-white">
          <table className="min-w-full divide-y divide-ink-100 text-sm">
            <thead className="bg-ink-100/40 text-left text-xs uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-3 font-medium">时间</th>
                <th className="px-4 py-3 font-medium">落地页</th>
                <th className="px-4 py-3 font-medium">姓名</th>
                <th className="px-4 py-3 font-medium">邮箱</th>
                <th className="px-4 py-3 font-medium">公司</th>
                <th className="px-4 py-3 font-medium">电话</th>
                <th className="px-4 py-3 font-medium">语种 / 方案</th>
                <th className="px-4 py-3 font-medium">留言</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {sorted.map((lead) => {
                const page = pageById.get(lead.projectId);
                const product = page ? productById.get(page.productId) : null;
                return (
                  <tr key={lead.id} className="hover:bg-ink-100/30">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-500">
                      {new Date(lead.createdAt).toLocaleString('zh-CN', {
                        hour12: false,
                      })}
                    </td>
                    <td className="px-4 py-3">
                      {page ? (
                        <Link
                          href={`/${locale}/projects/${page.id}`}
                          className="text-brand-700 hover:underline"
                        >
                          {page.name}
                        </Link>
                      ) : (
                        <span className="text-ink-400">
                          已删除 ({lead.projectId.slice(0, 6)})
                        </span>
                      )}
                      {product && (
                        <div className="text-[11px] text-ink-500">
                          {product.name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">{lead.name ?? '-'}</td>
                    <td className="px-4 py-3">
                      {lead.email ? (
                        <a
                          href={`mailto:${lead.email}`}
                          className="text-brand-700 hover:underline"
                        >
                          {lead.email}
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3">{lead.company ?? '-'}</td>
                    <td className="px-4 py-3">{lead.phone ?? '-'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-500">
                      {lead.locale}
                      {lead.variant && (
                        <span className="ml-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
                          {lead.variant}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[260px] px-4 py-3 text-xs text-ink-500">
                      {lead.message
                        ? lead.message.length > 80
                          ? lead.message.slice(0, 80) + '…'
                          : lead.message
                        : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

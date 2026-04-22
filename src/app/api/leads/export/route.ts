import { NextRequest, NextResponse } from 'next/server';
import { readLeads, readLandingPages, readProducts } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/leads/export?pageId=&productId=
 *
 * Returns a UTF-8 CSV of all leads matching the filter (both params
 * optional). Used by /[locale]/dashboard/leads "下载 CSV" button.
 *
 * Columns mirror the dashboard table columns so what you see in the
 * UI matches what lands in Excel / Google Sheets. A UTF-8 BOM prefix
 * makes 中文/日文 fields render correctly when opened in Excel (without
 * it, Excel mis-detects as Windows-1252 and all CJK becomes garbage).
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const pageFilter = url.searchParams.get('pageId')?.trim() ?? '';
  const productFilter = url.searchParams.get('productId')?.trim() ?? '';

  const [leads, pages, products] = await Promise.all([
    readLeads(),
    readLandingPages(),
    readProducts(),
  ]);
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const productById = new Map(products.map((p) => [p.id, p]));

  const rows = leads
    .filter((lead) => {
      const page = pageById.get(lead.projectId);
      if (pageFilter && lead.projectId !== pageFilter) return false;
      if (productFilter && page?.productId !== productFilter) return false;
      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  const header = [
    '时间',
    '产品',
    '落地页',
    '姓名',
    '邮箱',
    '公司',
    '电话',
    '语种',
    '方案',
    '留言',
  ];
  const csvLines = [header.map(csvEscape).join(',')];
  for (const lead of rows) {
    const page = pageById.get(lead.projectId);
    const product = page ? productById.get(page.productId) : null;
    csvLines.push(
      [
        new Date(lead.createdAt).toISOString(),
        product?.name ?? '',
        page?.name ?? `(deleted ${lead.projectId})`,
        lead.name ?? '',
        lead.email ?? '',
        lead.company ?? '',
        lead.phone ?? '',
        lead.locale ?? '',
        lead.variant ?? '',
        lead.message ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }

  // U+FEFF BOM — see function docstring for why this matters to Excel.
  const body = '\ufeff' + csvLines.join('\n');

  const filename = buildFilename(pageFilter, productFilter);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

/**
 * RFC 4180 style escape: wrap in quotes if value contains comma/quote/
 * newline, double internal quotes. Handles CJK and emoji unchanged
 * because the output is UTF-8.
 */
function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildFilename(pageId: string, productId: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const scope = pageId
    ? `page-${pageId.slice(0, 8)}`
    : productId
      ? `product-${productId.slice(0, 8)}`
      : 'all';
  return `leads-${scope}-${date}.csv`;
}

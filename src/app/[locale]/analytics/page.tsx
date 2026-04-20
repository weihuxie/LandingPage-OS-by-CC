import Link from 'next/link';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
import { unstable_setRequestLocale } from 'next-intl/server';

// Analytics body is a client component (AnalyticsDashboard) that fetches
// via /api/analytics, so the SSR payload itself doesn't hit KV. Still,
// pin revalidate=0 so the route shell never goes stale — matches the
// uniform pattern from §一.4.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function AnalyticsPage({ params }: { params: { locale: string } }) {
  unstable_setRequestLocale(params.locale);
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">多产品增长看板</h1>
          <p className="mt-1 text-sm text-ink-500">
            跨产品留资 · A/B 胜出推荐 · 地理/语种分布 · AI 优化任务池
          </p>
        </div>
        <Link href={`/${params.locale}/dashboard`} className="btn btn-secondary">
          ← 返回项目
        </Link>
      </div>
      <AnalyticsDashboard />
    </div>
  );
}

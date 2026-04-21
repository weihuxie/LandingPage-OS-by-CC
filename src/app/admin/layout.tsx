import type { ReactNode } from 'react';
import Link from 'next/link';

// Admin pages intentionally skip the [locale] segment: the panel is a
// back-office tool, Chinese-only, and doesn't need the multi-locale
// routing machinery the generated landing pages use.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 text-sm">
            <Link href="/admin/llm" className="font-semibold text-ink-900">
              ⚙️ LandingPage OS 管理台
            </Link>
            <span className="text-ink-400">·</span>
            <Link href="/admin/llm" className="text-ink-500 hover:text-ink-900">
              LLM 配置
            </Link>
          </div>
          <Link
            href="/zh-CN/dashboard"
            className="text-xs text-ink-500 hover:text-ink-900"
          >
            ← 回到工作台
          </Link>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

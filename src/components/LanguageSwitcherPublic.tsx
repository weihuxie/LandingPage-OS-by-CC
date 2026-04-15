'use client';
import { useState } from 'react';
import type { PageLocale } from '@/lib/types';
import { nativeLabel } from '@/lib/i18n-detect';

/**
 * Public-facing language switcher — sticky pill at the bottom of /p/[slug].
 * Click → persists choice to cookie `lp_lang` + updates URL ?lang=xx.
 * Re-render happens via client-side navigation.
 */
export default function LanguageSwitcherPublic({
  slug,
  current,
  available,
  allLocales,
}: {
  slug: string;
  current: PageLocale;
  available: PageLocale[];
  allLocales: PageLocale[];
}) {
  const [busy, setBusy] = useState<PageLocale | null>(null);

  const onPick = (locale: PageLocale) => {
    if (!available.includes(locale)) return;
    if (locale === current) return;
    setBusy(locale);
    // Sticky cookie (30 days)
    document.cookie = `lp_lang=${locale}; Max-Age=${60 * 60 * 24 * 30}; Path=/; SameSite=Lax`;
    // Navigate with ?lang= so server re-renders with the new locale
    const url = new URL(window.location.href);
    url.searchParams.set('lang', locale);
    window.location.href = url.toString();
  };

  return (
    <div
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2"
      role="navigation"
      aria-label="Language"
    >
      <div className="flex items-center gap-1 rounded-full border border-ink-100 bg-white/90 px-2 py-1 text-xs shadow-soft backdrop-blur">
        <span className="px-1.5 text-ink-300">🌐</span>
        {allLocales.map((l) => {
          const enabled = available.includes(l);
          const isCurrent = l === current;
          return (
            <button
              key={l}
              disabled={!enabled || busy !== null}
              onClick={() => onPick(l)}
              className={`rounded-full px-2.5 py-1 transition ${
                isCurrent
                  ? 'bg-ink-900 text-white'
                  : enabled
                    ? 'text-ink-700 hover:bg-ink-100'
                    : 'text-ink-300 cursor-not-allowed line-through'
              }`}
              title={
                enabled
                  ? isCurrent
                    ? '当前语言'
                    : `切换为 ${nativeLabel(l)}`
                  : `${nativeLabel(l)} 版本未生成`
              }
            >
              {nativeLabel(l)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 页面字体快选 · always-visible flat tile picker on the right-rail.
 *
 * Layout: 2-column tile grid. Each tile shows
 *   - the preset label (zh-CN)
 *   - a sample line "你好 · Hello · 123" rendered in that preset's
 *     fontStack so the visual comparison is genuine — you can see at
 *     a glance whether the chosen face actually renders the CJK glyphs
 *     differently from the default.
 *
 * Locale-aware: shows 6 presets curated for the current editing locale
 * (Japanese pages get JP-friendly fonts, Chinese pages get Chinese-
 * friendly fonts, etc.). The selection is still page-scoped — one font
 * stack applies across all the page's locales — but the OPTIONS the
 * user picks from depend on which locale they're authoring in. Cross-
 * locale fallback chains in each fontStack mean the choice still
 * renders correctly when other locales' tabs view the same page.
 */
'use client';

import {
  presetsForLocale,
  type FontPreset,
} from '@/lib/font-presets';
import type { LocaleCode } from '@/lib/types';

interface Props {
  /** Current page.fontPresetId or null/empty for "default" */
  value?: string | null;
  /** Editing locale — picks which locale's 6 presets to display */
  locale: LocaleCode;
  /** Locale's display label, used in the heading */
  localeLabel?: string;
  onChange: (presetId: string | null) => void;
}

const SAMPLE_BY_LOCALE: Record<LocaleCode, string> = {
  'zh-CN': '你好 · Hello · 123',
  'zh-TW': '你好 · Hello · 123',
  ja: 'こんにちは · Hello · 123',
  en: 'Hello · 123',
};

export default function PageFontPicker({ value, locale, localeLabel, onChange }: Props) {
  const presets = presetsForLocale(locale);
  const sample = SAMPLE_BY_LOCALE[locale] ?? SAMPLE_BY_LOCALE['zh-CN'];
  const items: Array<{
    id: string | null;
    label: string;
    hint?: string;
    fontStack?: string;
  }> = [
    { id: null, label: '默认', hint: '跟风格预设走' },
    ...presets.map((p) => ({
      id: p.id,
      label: p.label,
      hint: p.hint,
      fontStack: p.fontStack,
    })),
  ];

  return (
    <div>
      <div className="label mb-1.5">
        页面字体
        {localeLabel && (
          <span className="ml-1 text-[10px] font-normal text-ink-500">
            · {localeLabel}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((it) => {
          const selected = (value ?? null) === it.id;
          return (
            <button
              key={it.id ?? '__default__'}
              type="button"
              onClick={() => onChange(it.id)}
              className={`rounded-lg border p-2 text-left transition ${
                selected
                  ? 'border-brand-300 bg-brand-50'
                  : 'border-ink-100 hover:bg-ink-100/40'
              }`}
              title={it.hint}
            >
              <div className="text-[11px] font-medium text-ink-700">{it.label}</div>
              <div
                className="mt-0.5 truncate text-[11px] text-ink-500"
                style={
                  it.fontStack
                    ? { fontFamily: it.fontStack }
                    : undefined
                }
              >
                {it.fontStack ? sample : '—'}
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-500">
        点击切换，实时 preview。字体设置作用全页面（所有 locale 共享），
        但选项按当前编辑语言展示。
      </p>
    </div>
  );
}

/**
 * 页面字体快选 · always-visible flat tile picker on the right-rail.
 *
 * Why this exists: the same control lives in the Settings modal, but
 * Settings is 2 clicks deep (⋮ kebab → ⚙ 设置). For users debugging
 * "which font reads best for this market" the comparison loop has to
 * be one click each — sit at the editor, click a tile, see preview
 * update, click another tile, compare. So we duplicate the picker
 * here for shallow access; both surfaces read/write the same
 * page.fontPresetId field so they stay in sync automatically.
 *
 * Layout: 2-column tile grid. Each tile shows
 *   - the preset label (zh-CN)
 *   - a sample line "你好 · Hello · 123" rendered in that preset's
 *     fontStack so the visual comparison is genuine — you can see at
 *     a glance whether the chosen face actually renders the CJK glyphs
 *     differently from the default.
 *
 * Selection state writes through onChange immediately (no save button)
 * — the parent debounces persistence to /api/pages/[id] PATCH.
 */
'use client';

import { FONT_PRESETS, FONT_PRESET_IDS, type FontPresetId } from '@/lib/font-presets';

interface Props {
  value?: string | null; // fontPresetId or empty/null = "default"
  onChange: (presetId: string | null) => void;
}

const SAMPLE = '你好 · Hello · 123';

export default function PageFontPicker({ value, onChange }: Props) {
  const items: Array<{ id: string | null; label: string; hint?: string; fontStack?: string }> = [
    { id: null, label: '默认', hint: '跟风格预设走' },
    ...FONT_PRESET_IDS.map((id) => ({
      id,
      label: FONT_PRESETS[id].label,
      hint: FONT_PRESETS[id].hint,
      fontStack: FONT_PRESETS[id].fontStack,
    })),
  ];

  return (
    <div>
      <div className="label mb-1.5">页面字体</div>
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
                {it.fontStack ? SAMPLE : '—'}
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-500">
        点击切换，实时 preview。下方"模块编辑"区域不影响。
      </p>
    </div>
  );
}

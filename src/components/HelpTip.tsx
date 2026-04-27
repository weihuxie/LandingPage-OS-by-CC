'use client';
/**
 * HelpTip — pattern ③ "Tooltip 帮助气泡" from the AI-introduction design doc.
 *
 * Tiny "?" badge that sits next to a field label. On hover (desktop) or tap
 * (mobile), it shows a small popover with a one-line explanation + optional
 * example, both pulled from `src/lib/field-tooltips.ts` by `path`.
 *
 * Why no Radix / Headless UI:
 *  - One component, one shape — adding a Popover dependency for ~50 of these
 *    is overkill. CSS hover + a tiny click toggle covers desktop and mobile.
 *  - Tailwind-only positioning keeps it bundle-light.
 *
 * Behavior:
 *  - Hover (sm+ pointer): shows on `:hover` via CSS — zero JS for hover
 *  - Click anywhere: toggles `pinned` so mobile / tap users can read longer
 *    without keeping a finger on the badge
 *  - Click outside: closes a pinned tip
 *  - If `path` has no entry in FIELD_TOOLTIPS, renders nothing (so a
 *    typo'd path doesn't leave a dead "?" floating in the editor)
 */
import { useEffect, useRef, useState } from 'react';
import { tooltipFor } from '@/lib/field-tooltips';

type Props = {
  /** Lookup key into FIELD_TOOLTIPS, e.g. "hero.headline". */
  path: string;
};

export default function HelpTip({ path }: Props) {
  const tip = tooltipFor(path);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target as Node)) return;
      setPinned(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [pinned]);

  if (!tip) return null;

  return (
    <span
      ref={wrapRef}
      className="group relative ml-1 inline-flex align-baseline"
    >
      <button
        type="button"
        aria-label={`关于"${path}"字段的说明`}
        // border + bg combo is intentionally subtle — must not draw the eye
        // away from the actual field label
        className={`inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border text-[9px] font-semibold leading-none transition ${
          pinned
            ? 'border-brand-400 bg-brand-100 text-brand-700'
            : 'border-ink-200 bg-ink-50 text-ink-500 hover:border-brand-300 hover:text-brand-600'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setPinned((v) => !v);
        }}
      >
        ?
      </button>
      <span
        // Tooltip surface. Hidden by default; revealed on `group-hover`
        // (desktop) OR when `pinned` is true (mobile click). max-w prevents
        // long tooltips from running off the right rail.
        className={`pointer-events-none absolute left-0 top-5 z-50 w-64 max-w-[16rem] rounded-lg border border-ink-200 bg-white p-2.5 text-left text-xs leading-relaxed text-ink-700 shadow-md transition ${
          pinned
            ? 'pointer-events-auto opacity-100'
            : 'opacity-0 group-hover:opacity-100'
        }`}
        role="tooltip"
      >
        <div className="font-medium text-ink-900">{tip.short}</div>
        {tip.example && (
          <div className="mt-1 border-t border-ink-100 pt-1.5 text-[11px] text-ink-500">
            <span className="font-medium text-ink-600">示例：</span>
            {tip.example}
          </div>
        )}
      </span>
    </span>
  );
}

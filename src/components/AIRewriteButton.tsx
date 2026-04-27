'use client';
/**
 * AIRewriteButton — pattern ① "Per-field AI 改写" from the AI-introduction
 * design doc.
 *
 * Sits next to a Field label as a small ✨ button. Click → opens an
 * inline panel below the field with:
 *   - hint input ("更国际化", "加数字")
 *   - "再来" button to regenerate alternatives
 *   - 3 alternative cards, each with text + reason + 采用 button
 *
 * Power source: AIRewriteContext (set by Editor.tsx) that knows the
 * current pageId + locale + a fetch wrapper that handles errors.
 *
 * Why a context (instead of threading pageId/locale into every Field):
 *   - 30+ Field instances would each need pageId/locale props
 *   - The AI rewrite feature is page-scoped; Field doesn't need to know
 *     anything about pages, just whether it has an `aiPath` to rewrite
 *
 * Cost: 1 LLM call per click. No autorefresh, no auto-trigger; user
 * must click ✨ explicitly. Delay typically 2–5s (single-field prompt).
 */
import { createContext, useContext, useState } from 'react';

export interface FieldSuggestion {
  text: string;
  reason: string;
}

export interface SuggestRequest {
  fieldPath: string;
  fieldLabel: string;
  currentValue: string;
  hint?: string;
}

interface AIRewriteCtxShape {
  /** True iff at least one of Claude / DeepSeek has a key. When false the
   *  button is disabled (rather than allowing a click that 503s). */
  enabled: boolean;
  /** Disabled reason for the tooltip when !enabled. */
  disabledReason?: string;
  /** Hits POST /api/fields/suggest, returns 3 alternatives. Throws on
   *  non-2xx — the caller surfaces a one-line "AI 调用失败" inline. */
  suggest: (req: SuggestRequest) => Promise<FieldSuggestion[]>;
}

export const AIRewriteContext = createContext<AIRewriteCtxShape | null>(null);

type Props = {
  path: string;
  /** Same string as the Field label — used as fieldLabel for the LLM
   *  prompt context. Optional; falls back to path. */
  label?: string;
  /** Current field value — what the LLM rewrites. */
  value: string;
  /** Called when user clicks "采用" on an alternative; the parent
   *  commits the new value via setC / onChange. */
  onAdopt: (text: string) => void;
};

export default function AIRewriteButton({ path, label, value, onAdopt }: Props) {
  const ctx = useContext(AIRewriteContext);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<FieldSuggestion[] | null>(null);

  // No context provided → render nothing (the editor isn't in a context
  // that supports AI rewrite, e.g. fixture preview). Same posture as
  // HelpTip when path has no entry.
  if (!ctx) return null;

  const disabled = !ctx.enabled;

  const fetchAlternatives = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const out = await ctx.suggest({
        fieldPath: path,
        fieldLabel: label ?? path,
        currentValue: value,
        hint: hint.trim() || undefined,
      });
      setAlternatives(out);
    } catch (e: any) {
      setError(e?.message ?? 'AI 调用失败');
    } finally {
      setLoading(false);
    }
  };

  const togglePanel = () => {
    if (!open) {
      setOpen(true);
      // Auto-fire first batch on open — avoids a wasted "click button,
      // then click again to actually fetch" flow. Skip if already fetched.
      if (!alternatives && !loading) fetchAlternatives();
    } else {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        type="button"
        title={
          disabled
            ? ctx.disabledReason ?? 'AI 改写不可用'
            : 'AI 改写 — 给 3 个备选'
        }
        aria-label={`AI 改写 ${label ?? path}`}
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          togglePanel();
        }}
        className={`ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] leading-none transition ${
          open
            ? 'border-brand-400 bg-brand-100 text-brand-700'
            : 'border-ink-200 bg-ink-50 text-ink-500 hover:border-brand-300 hover:text-brand-600 disabled:opacity-40 disabled:hover:border-ink-200 disabled:hover:text-ink-500'
        }`}
      >
        ✨
      </button>
      {open && (
        <div className="mt-1.5 rounded-xl border border-brand-200 bg-brand-50/50 p-2.5">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="可选提示，如：更国际化 / 更短 / 加数字"
              className="input flex-1 px-2 py-1 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  fetchAlternatives();
                }
              }}
            />
            <button
              type="button"
              onClick={fetchAlternatives}
              disabled={loading}
              className="btn btn-secondary px-2 py-1 text-xs disabled:opacity-50"
            >
              {loading ? '生成中…' : '再来'}
            </button>
          </div>
          {error && (
            <div className="mt-1.5 text-xs text-red-700">⚠ {error}</div>
          )}
          {loading && !alternatives && (
            <div className="mt-2 text-xs text-ink-500">生成中… (通常 3–5s)</div>
          )}
          {alternatives && alternatives.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {alternatives.map((a, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-ink-100 bg-white p-2"
                >
                  <div className="text-sm leading-relaxed">{a.text}</div>
                  {a.reason && (
                    <div className="mt-0.5 text-[11px] leading-snug text-ink-500">
                      {a.reason}
                    </div>
                  )}
                  <div className="mt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        onAdopt(a.text);
                        setOpen(false);
                      }}
                      className="btn btn-primary px-2 py-0.5 text-[11px]"
                    >
                      采用
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {alternatives && alternatives.length === 0 && !loading && !error && (
            <div className="mt-2 text-xs text-ink-500">
              没拿到备选——再点一次"再来"试试。
            </div>
          )}
        </div>
      )}
    </>
  );
}

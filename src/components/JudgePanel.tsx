'use client';
/**
 * JudgePanel — independent-reader evaluation drawer (Phase 3 of judge agent).
 *
 * UX flow:
 *   1. User clicks "📊 评估" chip in editor toolbar → onOpen(true)
 *   2. This component fetches POST /api/pages/[id]/evaluate
 *   3. Loading → spinner; error → red note; success → suggestions list
 *   4. Each suggestion card has 3 buttons:
 *      - "应用" — calls onApply(moduleId, fieldPath, replacement). If
 *        applied successfully, card flips to "已应用 ✓" + small undo
 *        hint. Editor's normal autosave + dirty-state takes over from
 *        there (this is the "二次确认" step — applied changes still
 *        need to pass autosave/manual save flow).
 *      - "拒绝" — collapses card with rejection-reason chip menu.
 *        Phase 3: rejection persists only in component state. Phase 4
 *        will POST it to a tracking endpoint.
 *      - "稍后" — collapses card with neutral chip.
 *   5. Footer "🔄 重新评估" reruns
 *
 * Cross-family transparency:
 *   - Header shows "judge: <provider> · generator: <provider>"
 *   - sameFamilyWarning=true → red banner "判官与生成器同家，独立性下降"
 *
 * Goodhart guardrails:
 *   - "拒绝" UI is equal weight to "应用" (not a small dismiss x)
 *   - Footer disclaimer: "这是 LLM 模拟的读者反应，不是真用户调研"
 */
import { useEffect, useState, useCallback } from 'react';
import type { PageModule } from '@/lib/types';
import type { JudgeReport, JudgeSuggestion, JudgeRejectionReason } from '@/lib/judge-types';

interface Props {
  open: boolean;
  onClose: () => void;
  pageId: string;
  locale: string;
  variant: 'A' | 'B';
  modules: PageModule[];
  /** Returns true if applied successfully (path resolved + value set). */
  onApply: (moduleId: string, fieldPath: string, value: string) => boolean;
}

interface CardState {
  status: 'pending' | 'applied' | 'rejected' | 'snoozed';
  rejectionReason?: JudgeRejectionReason;
}

const REJECTION_LABELS: Record<JudgeRejectionReason, string> = {
  preference: '偏好不同',
  judge_wrong: 'judge 看错了',
  not_important: '不重要',
};

const SEVERITY_STYLES: Record<JudgeSuggestion['severity'], { bg: string; text: string; label: string }> = {
  high: { bg: 'bg-red-50 border-red-200', text: 'text-red-700', label: '🔴 high' },
  med:  { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', label: '🟡 med' },
  low:  { bg: 'bg-ink-50 border-ink-200', text: 'text-ink-600', label: '⚪ low' },
};

function moduleTypeLabel(t: string): string {
  switch (t) {
    case 'hero': return 'Hero';
    case 'pain': return '痛点';
    case 'solution': return '方案';
    case 'benefits': return '价值';
    case 'cta': return 'CTA';
    case 'socialProof': return '社会证明';
    case 'testimonial': return '客户证言';
    case 'useCase': return '场景';
    case 'faq': return 'FAQ';
    case 'form': return '表单';
    default: return t;
  }
}

export default function JudgePanel({
  open,
  onClose,
  pageId,
  locale,
  variant,
  modules,
  onApply,
}: Props) {
  const [report, setReport] = useState<JudgeReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardStates, setCardStates] = useState<Record<string, CardState>>({});

  const runEvaluation = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    setCardStates({});
    try {
      const url = `/api/pages/${pageId}/evaluate?locale=${encodeURIComponent(locale)}&variant=${variant}`;
      const res = await fetch(url, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? body?.error ?? `评估失败 (${res.status})`);
        return;
      }
      setReport(body.report as JudgeReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : '评估失败 (网络错误)');
    } finally {
      setLoading(false);
    }
  }, [pageId, locale, variant]);

  useEffect(() => {
    if (open && !report && !loading) {
      runEvaluation();
    }
  }, [open, report, loading, runEvaluation]);

  if (!open) return null;

  const visibleSuggestions = report?.suggestions.filter(
    (s) => cardStates[s.id]?.status !== 'rejected' && cardStates[s.id]?.status !== 'snoozed',
  ) ?? [];

  const handleApply = (s: JudgeSuggestion) => {
    const ok = onApply(s.moduleId, s.fieldPath, s.proposedReplacement);
    if (ok) {
      setCardStates((p) => ({ ...p, [s.id]: { status: 'applied' } }));
    } else {
      // fieldPath couldn't be resolved (e.g. judge gave a weird path).
      // Fallback: copy to clipboard + alert.
      void navigator.clipboard?.writeText(s.proposedReplacement).catch(() => undefined);
      alert(
        `字段路径 "${s.fieldPath}" 无法直接应用，建议文案已复制到剪贴板，请手动粘贴到 ${moduleTypeLabel(modules.find((m) => m.id === s.moduleId)?.type ?? '')} 模块的对应字段。`,
      );
    }
  };

  const handleReject = (s: JudgeSuggestion, reason: JudgeRejectionReason) => {
    setCardStates((p) => ({ ...p, [s.id]: { status: 'rejected', rejectionReason: reason } }));
    // Phase 4 will POST to /api/pages/[id]/judge-rejections here.
  };

  const handleSnooze = (s: JudgeSuggestion) => {
    setCardStates((p) => ({ ...p, [s.id]: { status: 'snoozed' } }));
  };

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl border-l border-ink-100"
      role="dialog"
      aria-label="独立评估"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-ink-900">📊 独立评估</span>
          {report && (
            <span className="text-[11px] text-ink-400">
              judge: {report.judge.provider} · generator: {report.generator.provider}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="关闭"
          className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-900"
        >
          ✕
        </button>
      </div>

      {/* Same-family warning */}
      {report?.sameFamilyWarning && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
          ⚠️ 判官与生成器使用同一 LLM 家族（独立性下降）。建议在 /admin/llm 配置另一家 LLM key。
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-4 py-8 text-center text-sm text-ink-500">
            <div className="mb-2">⟳ 正在评估…</div>
            <div className="text-xs text-ink-400">这一步会调一次 LLM (~5-10s)</div>
          </div>
        )}

        {error && (
          <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <div className="mb-1 font-medium">评估暂时不可用</div>
            <div className="leading-relaxed">{error}</div>
          </div>
        )}

        {report && !loading && (
          <>
            {/* Suggestions */}
            <div className="space-y-3 px-4 py-3">
              {visibleSuggestions.length === 0 && Object.values(cardStates).length === 0 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  ✓ judge 没找到需要改进的点。
                </div>
              )}
              {report.suggestions.map((s) => {
                const state = cardStates[s.id];
                const sev = SEVERITY_STYLES[s.severity];
                const moduleType = modules.find((m) => m.id === s.moduleId)?.type ?? 'unknown';

                if (state?.status === 'rejected') {
                  return (
                    <div key={s.id} className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 text-xs text-ink-400">
                      ✕ 已拒绝（{REJECTION_LABELS[state.rejectionReason ?? 'preference']}）— {moduleTypeLabel(moduleType)} · {s.ruleId}
                    </div>
                  );
                }
                if (state?.status === 'snoozed') {
                  return (
                    <div key={s.id} className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 text-xs text-ink-400">
                      ⏸ 稍后再看 — {moduleTypeLabel(moduleType)} · {s.ruleId}
                    </div>
                  );
                }
                if (state?.status === 'applied') {
                  return (
                    <div key={s.id} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                      ✓ 已应用到 {moduleTypeLabel(moduleType)}.{s.fieldPath} — 可在编辑器手动修改或撤销
                    </div>
                  );
                }

                return (
                  <div
                    key={s.id}
                    className={`rounded-lg border p-3 ${sev.bg}`}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
                      <span className={`font-medium ${sev.text}`}>{sev.label}</span>
                      <span className="text-ink-500">
                        {moduleTypeLabel(moduleType)} · {s.fieldPath}
                      </span>
                    </div>

                    <div className="mb-2 text-xs text-ink-500">
                      <span className="text-ink-400">📝 当前：</span>
                      <span className="text-ink-700">"{s.evidenceQuote}"</span>
                    </div>

                    <div className="mb-2 text-xs text-ink-700 leading-relaxed">
                      <span className="text-ink-400">💭 </span>
                      {s.reason}
                    </div>

                    <div className="mb-2 text-xs text-ink-700">
                      <div className="text-ink-400">💡 建议（复用 {s.reusedAssets.join(', ')}）:</div>
                      <div className="mt-0.5 rounded bg-white/70 px-2 py-1.5 font-mono text-[12px] text-emerald-800">
                        {s.proposedReplacement}
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <button
                        onClick={() => handleApply(s)}
                        className="rounded-md bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-700"
                      >
                        应用并编辑
                      </button>
                      <details className="relative">
                        <summary className="cursor-pointer list-none rounded-md border border-red-300 px-2.5 py-1 font-medium text-red-700 hover:bg-red-100">
                          拒绝 ▾
                        </summary>
                        <div className="absolute right-0 top-full mt-1 w-40 rounded-md border border-ink-200 bg-white p-1 shadow-lg z-10">
                          {(Object.keys(REJECTION_LABELS) as JudgeRejectionReason[]).map((r) => (
                            <button
                              key={r}
                              onClick={() => handleReject(s, r)}
                              className="block w-full rounded px-2 py-1 text-left text-[11px] hover:bg-ink-100"
                            >
                              {REJECTION_LABELS[r]}
                            </button>
                          ))}
                        </div>
                      </details>
                      <button
                        onClick={() => handleSnooze(s)}
                        className="rounded-md border border-ink-200 px-2.5 py-1 text-ink-600 hover:bg-ink-100"
                      >
                        稍后
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Rules-checked footer */}
            {report.rulesChecked.length > 0 && (
              <div className="border-t border-ink-100 px-4 py-2 text-[11px] text-ink-400">
                已检查规则: {report.rulesChecked.join(' · ')}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-ink-100 px-4 py-3 space-y-2">
        <button
          onClick={runEvaluation}
          disabled={loading}
          className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100 disabled:opacity-50"
        >
          {loading ? '⟳ 评估中…' : '🔄 重新评估'}
        </button>
        <p className="text-[10px] leading-relaxed text-ink-400">
          这是 LLM (
          {report?.judge.provider ?? '...'}
          ) 模拟的读者反应，不是真用户调研。判官的偏好不一定是你的；
          相信你自己的判断。
        </p>
      </div>
    </div>
  );
}

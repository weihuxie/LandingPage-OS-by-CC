'use client';
/**
 * DiagnosticsBanner — pattern ② "Inline 诊断 banner" from the AI-introduction
 * design doc.
 *
 * Sits above the editor grid as a yellow strip that summarizes findings from
 * `findIssues()` (page-diagnostics.ts). Distinct from the red error
 * NoticeBanner: this is "could be better", not "is broken". Both can render
 * simultaneously — the user sees an error stack (red) on top, then a quality
 * stack (yellow) below.
 *
 * Behavior:
 *  - Renders nothing if 0 issues
 *  - Collapsed: one-line summary (count by severity), expand toggle
 *  - Expanded: list of issues with one-click action buttons
 *  - State is local — every editor session starts collapsed; expanding is
 *    intentional (the banner shouldn't grab attention away from the editor
 *    until the user opts in)
 *  - Per-issue dismissal NOT supported — issues regenerate from rules every
 *    render, so dismissed-then-still-true would flicker. If user disagrees
 *    with a rule, fix the content (or report the rule as too noisy)
 */
import { useState } from 'react';
import type { Issue } from '@/lib/page-diagnostics';

type Props = {
  issues: Issue[];
  /** Wired in Editor.tsx — receives the issue's `action` field. */
  onAct: (issue: Issue) => void;
};

const SEVERITY_DOT: Record<Issue['severity'], string> = {
  high: 'bg-red-500',
  med: 'bg-amber-500',
  low: 'bg-sky-500',
};

const SEVERITY_LABEL: Record<Issue['severity'], string> = {
  high: '高',
  med: '中',
  low: '低',
};

const ACTION_LABEL: Record<NonNullable<Issue['action']>['kind'], string> = {
  'select-module': '跳转到模块',
  'regenerate-module': '重新生成',
  relocalize: '重新本地化',
};

export default function DiagnosticsBanner({ issues, onAct }: Props) {
  const [open, setOpen] = useState(false);
  if (!issues || issues.length === 0) return null;

  const counts = { high: 0, med: 0, low: 0 } as Record<Issue['severity'], number>;
  for (const i of issues) counts[i.severity]++;

  const summary = [
    counts.high ? `🔴 ${counts.high} 项需修正` : '',
    counts.med ? `🟡 ${counts.med} 项可优化` : '',
    counts.low ? `🔵 ${counts.low} 项建议` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      role="status"
      // amber theme keeps it distinct from NoticeBanner (red/error) above
      className="border-b border-amber-200 bg-amber-50 text-amber-900"
    >
      <div className="mx-auto max-w-screen-2xl px-4 py-2">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="font-semibold">
              ✨ 发现 {issues.length} 个可优化项
            </span>
            <span className="truncate text-xs opacity-80">{summary}</span>
          </div>
          <span className="shrink-0 text-xs opacity-70">{open ? '收起 ▴' : '展开 ▾'}</span>
        </button>
        {open && (
          <ul className="mt-2 space-y-1.5 border-t border-amber-200 pt-2">
            {issues.map((it) => (
              <li
                key={it.id}
                className="flex items-start gap-2.5 rounded-md bg-white/60 p-2"
              >
                <span
                  className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[it.severity]}`}
                  title={`严重度: ${SEVERITY_LABEL[it.severity]}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{it.title}</div>
                  {it.detail && (
                    <div className="mt-0.5 text-xs leading-relaxed opacity-80">
                      {it.detail}
                    </div>
                  )}
                </div>
                {it.action && (
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAct(it);
                    }}
                  >
                    {ACTION_LABEL[it.action.kind]}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

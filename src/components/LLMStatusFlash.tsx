/**
 * 浮动小 toast · 显示最近一次 LLM 调用的实际 provider。
 *
 * 触发模型: 全局 dispatchEvent('lp:llm-trace', detail). 任何 fetch 调用
 * 后从响应 body 里取 `llm` 字段直接 dispatch — 不需要把 setter 一层层
 * 往下传。
 *
 * 显示规则:
 *   · 4 秒后自动消失（成功路径）
 *   · 8 秒（fallback 发生时，让操作员有更多时间看清楚降级到了哪家）
 *   · 同 scenario 后续调用直接覆盖前一条
 *   · 关闭按钮立即清除
 */
'use client';

import { useEffect, useState } from 'react';
import type { LLMTrace } from '@/lib/llm-trace';

const PROVIDER_LABEL: Record<string, string> = {
  claude: 'Claude',
  deepseek: 'DeepSeek',
  openai: 'GPT-4o',
  gemini: 'Gemini',
};

const SCENARIO_LABEL: Record<string, string> = {
  strategy: '策略生成',
  copy: '模块文案',
  localize: '本地化',
  extract: '长文档抽取',
};

interface FlashEntry {
  trace: LLMTrace;
  ts: number;
}

export function dispatchLLMTrace(trace: LLMTrace | undefined | null) {
  if (!trace) return;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<LLMTrace>('lp:llm-trace', { detail: trace }));
}

export default function LLMStatusFlash() {
  const [entry, setEntry] = useState<FlashEntry | null>(null);

  useEffect(() => {
    const onTrace = (e: Event) => {
      const detail = (e as CustomEvent<LLMTrace>).detail;
      if (!detail) return;
      setEntry({ trace: detail, ts: Date.now() });
    };
    window.addEventListener('lp:llm-trace', onTrace);
    return () => window.removeEventListener('lp:llm-trace', onTrace);
  }, []);

  useEffect(() => {
    if (!entry) return;
    const timeoutMs = entry.trace.fellBack ? 8000 : 4000;
    const t = setTimeout(() => setEntry(null), timeoutMs);
    return () => clearTimeout(t);
  }, [entry]);

  if (!entry) return null;
  const t = entry.trace;
  const usedLabel = PROVIDER_LABEL[t.used] ?? t.used;
  const primaryLabel = PROVIDER_LABEL[t.primary] ?? t.primary;
  const scenarioLabel = SCENARIO_LABEL[t.scenario] ?? t.scenario;

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] max-w-xs rounded-lg border bg-white px-3 py-2 shadow-lg"
      style={{
        borderColor: t.fellBack ? '#fbbf24' : '#86efac',
        background: t.fellBack ? '#fffbeb' : '#f0fdf4',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium">
            {t.fellBack ? (
              <span className="text-amber-800">
                ⚠️ {scenarioLabel}：{primaryLabel} → {usedLabel} 兜底
              </span>
            ) : (
              <span className="text-emerald-800">
                ✓ {scenarioLabel}：{usedLabel}
              </span>
            )}
          </div>
          {t.note && (
            <div className="mt-0.5 text-[10px] leading-relaxed text-ink-500">
              {t.note}
            </div>
          )}
          {t.hops && t.hops.length > 0 && (
            <div className="mt-0.5 text-[10px] text-ink-500">
              跳过：{t.hops.map((h) => `${PROVIDER_LABEL[h.provider] ?? h.provider}(${h.errorClass})`).join(' · ')}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEntry(null)}
          className="text-ink-400 hover:text-ink-700"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

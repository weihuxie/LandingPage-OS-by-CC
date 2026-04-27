'use client';
/**
 * IntroCard — dismissible "first-time guide" panel.
 *
 * Used to embed small-format onboarding guidance INSIDE pages / modals
 * (as opposed to OnboardingTour which is a multi-step driver.js popover
 * for the dashboard). Each instance is keyed by `storageKey` so multiple
 * cards across the app track their own dismissal independently.
 *
 * Replayability:
 *   - User dismisses via the × button → key written to localStorage
 *   - Component listens for `lp:restart-intros` window event; on receipt
 *     resets local dismissed state and clears the localStorage key
 *   - The "🎯 重新看引导" button anywhere in the app dispatches that
 *     event (see RestartTourButton in OnboardingTour.tsx)
 *
 * Why custom event over re-mount: keys are per-page and we want any
 * IntroCards on the current page to reappear immediately without a
 * navigation away and back. localStorage changes don't trigger
 * re-renders by themselves; the event hook does.
 */
import { useEffect, useState, type ReactNode } from 'react';

type Tone = 'info' | 'success' | 'warning';

const TONE_STYLES: Record<Tone, string> = {
  info: 'border-brand-200 bg-brand-50/60 text-brand-900',
  success: 'border-emerald-200 bg-emerald-50/60 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50/60 text-amber-900',
};

const STORAGE_PREFIX = 'lp:intro:';

type Props = {
  /** Stable identifier under STORAGE_PREFIX. e.g. "localize-modal" → key
   *  becomes "lp:intro:localize-modal". Don't reuse across surfaces; the
   *  global restart wipes ALL `lp:intro:*` keys at once. */
  storageKey: string;
  title: string;
  children: ReactNode;
  tone?: Tone;
  /** Optional explicit dismiss-label override; defaults to "知道了". */
  dismissLabel?: string;
};

export default function IntroCard({
  storageKey,
  title,
  children,
  tone = 'info',
  dismissLabel = '知道了',
}: Props) {
  const fullKey = `${STORAGE_PREFIX}${storageKey}`;
  const [dismissed, setDismissed] = useState<boolean | null>(null); // null = SSR, awaiting hydration

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(fullKey) === '1');
    } catch {
      setDismissed(false);
    }
    const onRestart = () => {
      try {
        localStorage.removeItem(fullKey);
      } catch {}
      setDismissed(false);
    };
    window.addEventListener('lp:restart-intros', onRestart);
    return () => window.removeEventListener('lp:restart-intros', onRestart);
  }, [fullKey]);

  // Avoid SSR / first-paint flash: render nothing until we know.
  // Keeps both server and client output identical (skip card by default).
  if (dismissed === null || dismissed) return null;

  const close = () => {
    try {
      localStorage.setItem(fullKey, '1');
    } catch {}
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className={`rounded-xl border p-3 text-xs leading-relaxed ${TONE_STYLES[tone]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <span aria-hidden>💡</span>
            <span>{title}</span>
          </div>
          <div className="opacity-90">{children}</div>
        </div>
        <button
          type="button"
          onClick={close}
          className="shrink-0 rounded-md border border-current px-2 py-0.5 text-[11px] font-medium opacity-80 hover:opacity-100"
          aria-label={dismissLabel}
        >
          {dismissLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Programmatic helper so callers (RestartTourButton etc.) can clear all
 * intro dismissals + ask currently-mounted cards to re-show themselves.
 * Safe to call from any client context.
 */
export function restartAllIntros() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {}
  window.dispatchEvent(new CustomEvent('lp:restart-intros'));
}

/**
 * Shared LLM-call trace shape exposed on API responses so the client
 * can display "which provider actually answered this request".
 *
 * Why on every response (not just on fallback): the user explicitly
 * asked to see the provider regardless of happy-path vs degraded.
 * Without it, a silent degrade where DeepSeek answered after Claude
 * 429'd looks identical to a happy Claude response — and that's
 * exactly the visibility hole CLAUDE.md §四 keeps warning about.
 *
 * For multi-call routes (hydrate runs 6 module calls in parallel) the
 * server aggregates and emits a single trace describing the
 * "interesting" outcome — primary === used everywhere if happy, or
 * the first deviation if any module fell back. The full per-module
 * breakdown stays in server logs.
 */
import type { LLMProvider, LLMScenario } from './llm-config';
import type { FallbackHop } from './llm-fallback';

export interface LLMTrace {
  /** What kind of work this was — strategy/copy/localize/extract */
  scenario: LLMScenario;
  /** Provider that should have served per config */
  primary: LLMProvider;
  /** Provider that actually produced the result */
  used: LLMProvider;
  /** True iff used !== primary. Convenient for client-side branching. */
  fellBack: boolean;
  /** Hops attempted before `used` succeeded. Empty when happy. */
  hops?: FallbackHop[];
  /** Optional human-readable note (e.g. "skipped GPT polish, used
   *  Claude hydrate output" for the localize graceful-degrade path). */
  note?: string;
}

export function makeTrace(
  scenario: LLMScenario,
  primary: LLMProvider,
  used: LLMProvider,
  hops?: FallbackHop[],
  note?: string,
): LLMTrace {
  return {
    scenario,
    primary,
    used,
    fellBack: primary !== used,
    hops: hops?.length ? hops : undefined,
    note,
  };
}

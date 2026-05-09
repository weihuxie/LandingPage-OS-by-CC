/**
 * Fallback orchestrator · v2.
 *
 * v1 had a single global `fallback.{enabled,triggers,chain}` plus a
 * separate `scenarios.{X}.primary` indirection. v2 collapses them: each
 * scenario carries its own ScenarioPolicy (chain[0]=primary, rest=
 * fallback ladder, plus enabled / triggers). This module just walks
 * that chain.
 *
 * Invariants preserved:
 *   - LLMRequiredError bubbles unchanged (missing API key is a config
 *     problem, not a transient one to swap-around).
 *   - Non-retryable errors (4xx-auth, 4xx-other) short-circuit the
 *     LIVE chain. A bad-prompt 400 will recur on every provider;
 *     burning four quotas to confirm doesn't help. EXCEPTION: if a
 *     remaining step is `mode: 'skip-polish'`, the walker jumps to it
 *     — skip-polish steps don't actually call an LLM (they accept the
 *     hydrate-time output as-is), so auth/quota failures upstream are
 *     orthogonal. See 2026-05 fix for OpenAI 401 → claude/skip-polish
 *     path being unreachable.
 *   - Executors can throw `NoAdapterSkipError` to declare "this step's
 *     provider has no adapter for this scenario" — the walker treats
 *     it like the no-key skip (continue without counting it as a
 *     failed hop). Used by judge.ts where openai/gemini steps in the
 *     chain are forward-compat placeholders without a real adapter.
 *   - Every hop is logged via console.warn — the admin can read why
 *     fallback ran or short-circuited from Vercel function logs.
 */
import type {
  LLMProvider,
  LLMScenario,
  ScenarioPolicy,
  ScenarioStep,
  TriggerClass,
} from './llm-config';
import { classifyProviderError, policyFor, readLLMConfig } from './llm-config';
import { hasClaudeKey } from './llm-claude';
import { hasDeepseekKey } from './llm-deepseek';
import { hasOpenAIKey } from './llm-openai';
import { hasGeminiKey } from './llm-gemini';
import { LLMRequiredError } from './errors';

export interface FallbackHop {
  provider: LLMProvider;
  model: string;
  errorClass: '429-quota' | '429-rate' | '5xx' | '4xx-auth' | '4xx-other' | 'network';
  message: string;
}

/**
 * Sentinel error: the executor recognized the step but has no adapter
 * for `step.provider` in this scenario. The walker treats it like a
 * no-key skip (no failure hop logged, just continue to the next step).
 *
 * Use case: judge.ts's chain may include openai/gemini entries as
 * forward-compat placeholders, but only claude/deepseek have a real
 * judge adapter today. Throwing this lets admin keep those entries in
 * the chain without breaking the chain walk.
 */
export class NoAdapterSkipError extends Error {
  readonly code = 'NO_ADAPTER_SKIP' as const;
  constructor(public provider: LLMProvider, public scenario: string) {
    super(`no ${scenario} adapter for provider=${provider}; skipping chain step`);
    this.name = 'NoAdapterSkipError';
  }
}

export interface FallbackOutcome<T> {
  result: T;
  /** The step (provider + model + mode) that produced `result`. */
  usedStep: ScenarioStep;
  /** Steps tried before the one that succeeded. Empty on happy path. */
  hops: FallbackHop[];
}

function hasKey(p: LLMProvider): boolean {
  switch (p) {
    case 'claude': return hasClaudeKey();
    case 'deepseek': return hasDeepseekKey();
    case 'openai': return hasOpenAIKey();
    case 'gemini': return hasGeminiKey();
  }
}

function isTriggered(
  cls: ReturnType<typeof classifyProviderError>,
  triggers: TriggerClass[],
): boolean {
  if (!cls) return false;
  if (cls === '4xx-auth' || cls === '4xx-other') return false;
  if (cls === 'network') return triggers.includes('5xx'); // Treat network like 5xx
  return triggers.includes(cls);
}

/**
 * Run a scenario per its policy. Walk chain[0]→chain[N], promoting on
 * trigger-matching failures. Caller's `executor` receives the full step
 * (provider + model + mode) and returns the scenario's result type.
 */
export async function executeScenario<T>(
  scenario: LLMScenario,
  locale: string,
  executor: (step: ScenarioStep) => Promise<T>,
): Promise<FallbackOutcome<T>> {
  const cfg = await readLLMConfig();
  const policy: ScenarioPolicy = policyFor(cfg, scenario, locale);
  if (!policy.enabled) {
    throw new LLMRequiredError(
      scenario === 'extract' ? 'extract' : scenario === 'localize' ? 'localize-gpt' : 'strategy',
      'any-llm',
      `scenario "${scenario}" is disabled in admin/llm config`,
    );
  }
  if (policy.chain.length === 0) {
    throw new LLMRequiredError(
      scenario === 'extract' ? 'extract' : scenario === 'localize' ? 'localize-gpt' : 'strategy',
      'any-llm',
      `scenario "${scenario}" chain is empty in admin/llm config`,
    );
  }

  const hops: FallbackHop[] = [];
  let firstError: unknown = null;
  let skippedNoKeyCount = 0;
  let skippedNoAdapterCount = 0;
  /** Find next chain index whose step is skip-polish, or -1. Used as a
   *  fallback target when the live chain has been declared unsuitable
   *  (auth-bail or non-trigger error) — skip-polish steps don't call
   *  the LLM and are orthogonal to the upstream failure. */
  const nextSkipPolishIdx = (from: number): number => {
    for (let j = from; j < policy.chain.length; j++) {
      if (policy.chain[j].mode === 'skip-polish') return j;
    }
    return -1;
  };
  for (let i = 0; i < policy.chain.length; i++) {
    const step = policy.chain[i];
    // Skip providers without key (except skip-polish mode which doesn't
    // call the API at all — it's a synthetic step).
    if (step.mode !== 'skip-polish' && !hasKey(step.provider)) {
      console.warn(
        `[llm-fallback] ${scenario}/${locale} skipping step ${i} (${step.provider}/${step.model}) — no API key`,
      );
      skippedNoKeyCount++;
      continue;
    }
    try {
      const result = await executor(step);
      if (i > 0) {
        console.warn(
          `[llm-fallback] ${scenario}/${locale} succeeded at step ${i} (${step.provider}/${step.model}) after ${hops.length} failed hop(s)`,
        );
      }
      return { result, usedStep: step, hops };
    } catch (err) {
      if (err instanceof LLMRequiredError) throw err;
      // No-adapter sentinel — treat like no-key skip (silent, no hop
      // recorded as a failure). The chain entry was forward-compat
      // padding, not a real attempt.
      if (err instanceof NoAdapterSkipError) {
        console.warn(
          `[llm-fallback] ${scenario}/${locale} skipping step ${i} (${step.provider}/${step.model}) — no ${scenario} adapter for provider`,
        );
        skippedNoAdapterCount++;
        continue;
      }
      if (firstError === null) firstError = err;
      const cls = classifyProviderError(err);
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[llm-fallback] ${scenario}/${locale} step ${i} (${step.provider}/${step.model}) failed → ` +
          `classified=${cls ?? 'null'} ` +
          `enabled=${policy.enabled} ` +
          `triggers=${policy.triggers.join('|')} ` +
          `triggerHit=${isTriggered(cls, policy.triggers)} ` +
          `errorType=${(err as any)?.constructor?.name ?? typeof err} ` +
          `causeStatus=${(err as any)?.cause?.status ?? 'n/a'} ` +
          `causeMsgHead=${String((err as any)?.cause?.message ?? '').slice(0, 100)}`,
      );
      hops.push({
        provider: step.provider,
        model: step.model,
        errorClass: cls ?? 'network',
        message: msg,
      });
      // 2026-05 fix: when a normal step bails (auth-bail or non-trigger
      // error), check if the chain has a remaining skip-polish step
      // before giving up entirely. Skip-polish doesn't call any LLM —
      // it's a synthetic graceful-degrade marker — so upstream auth /
      // quota / prompt failures don't predict it'll fail. The
      // localize chain (openai/normal → claude/skip-polish) hits this
      // path when OpenAI returns 401 or admin uses a non-OpenAI
      // localize primary.
      const shouldBail =
        cls === '4xx-auth' ||
        cls === '4xx-other' ||
        !isTriggered(cls, policy.triggers);
      if (shouldBail) {
        const skipIdx = nextSkipPolishIdx(i + 1);
        if (skipIdx === -1) break;
        // Jump to the skip-polish step on the next iteration.
        i = skipIdx - 1; // -1 because the loop will increment
        continue;
      }
      // Else (trigger-matching error) keep walking.
    }
  }

  console.error(
    `[llm-fallback] ${scenario}/${locale} chain exhausted; hops:`,
    hops.map((h) => `${h.provider}/${h.model}=${h.errorClass}`).join(' → '),
  );

  // 2026-05 bug fix: when EVERY chain step was skipped because the
  // provider lacks an API key (or has no adapter for this scenario),
  // no step ever throws — firstError stays null and the old
  // `throw firstError ?? new Error(...)` produced a generic Error
  // that route handlers mapped to 500. The correct shape is
  // LLMRequiredError → 503 + { code: 'LLM_REQUIRED' } so the editor
  // banner can render its specific "缺 LLM key" state. This path
  // matters for fresh installs / dev environments where the operator
  // hasn't configured any LLM key yet.
  if (
    firstError === null &&
    skippedNoKeyCount + skippedNoAdapterCount === policy.chain.length
  ) {
    const feature =
      scenario === 'extract'
        ? 'extract'
        : scenario === 'localize'
          ? 'localize-gpt'
          : scenario === 'strategy'
            ? 'strategy'
            : 'module-regen'; // covers 'copy' and 'judge' too
    // Report the first chain step's expected env var as the missing
    // one — that's the most-actionable hint for the operator (configure
    // the primary provider's key first; fallback chain rarely needs
    // multiple keys configured to start working).
    const primary = policy.chain[0]?.provider;
    const missing =
      primary === 'claude'
        ? 'ANTHROPIC_API_KEY'
        : primary === 'deepseek'
          ? 'DEEPSEEK_API_KEY'
          : primary === 'openai'
            ? 'OPENAI_API_KEY'
            : primary === 'gemini'
              ? 'GEMINI_API_KEY'
              : 'any-llm';
    throw new LLMRequiredError(
      feature,
      missing,
      `${scenario} chain has no usable provider — every step is missing its API key (chain[0] expects ${missing})`,
    );
  }

  throw firstError ?? new Error(`${scenario} chain exhausted with no error captured`);
}

/**
 * Back-compat alias — used to be `executeWithFallback(scenario, primary,
 * executor)` in v1. v2 prefers `executeScenario(scenario, locale, executor)`
 * because primary is no longer separate from the chain. Kept as a thin
 * shim for any in-flight refactors that haven't moved over.
 */
export async function executeWithFallback<T>(
  scenario: LLMScenario,
  locale: string,
  executor: (step: ScenarioStep) => Promise<T>,
): Promise<FallbackOutcome<T>> {
  return executeScenario(scenario, locale, executor);
}

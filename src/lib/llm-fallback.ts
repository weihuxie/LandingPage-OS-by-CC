/**
 * Fallback orchestrator (2026-04 新增) — admin-configurable provider
 * swap on transient failure.
 *
 * Origin: a user hit `gpt failed during localize-gpt: 429 You exceeded your
 * current quota` mid-workflow and asked "能不能失败时自动切到别家 LLM". The
 * admin UI's `fallback.{enabled,triggers,chain}` captures the policy; this
 * module executes it.
 *
 * Scope of THIS iteration:
 *   - Generic wrapper `executeWithFallback(scenario, primary, executor)`
 *     so any scenario can opt in.
 *   - Real wiring lives in the `localize` code path today (see
 *     /api/pages/[id]/locales POST). Other scenarios are either
 *     single-adapter (extract → gemini only) or already handled by
 *     `providerFor()`'s "skip primary when its key is missing" logic, so
 *     they don't need chain walking yet.
 *
 * Invariants:
 *   - LLMRequiredError bubbles unchanged. Missing key = configuration
 *     problem. If we silently swapped to cover "ANTHROPIC_API_KEY missing"
 *     the admin would never know to fix it — same fig-leaf trap the
 *     errors.ts refactor removed.
 *   - Non-retryable errors (4xx-auth, 4xx-other) short-circuit the chain.
 *     If Anthropic says "400 invalid prompt", DeepSeek will say the same.
 *     Burning three provider quotas to confirm a bad input is not a feature.
 *   - When fallback is OFF or the error class isn't in the trigger list,
 *     the original error is rethrown immediately — no silent swap.
 *   - Every hop is logged. Callers pass `hops` back to the client so the
 *     UI can surface "fell back from GPT → Claude (429-quota)" instead of
 *     shipping a degraded result without explanation.
 */

import type { LLMProvider, LLMScenario } from './llm-config';
import { readLLMConfig, classifyProviderError } from './llm-config';
import { hasClaudeKey } from './llm-claude';
import { hasDeepseekKey } from './llm-deepseek';
import { hasOpenAIKey } from './llm-openai';
import { hasGeminiKey } from './llm-gemini';
import { LLMRequiredError } from './errors';

/** A single attempted provider in the chain that failed. */
export interface FallbackHop {
  provider: LLMProvider;
  errorClass: '429-quota' | '429-rate' | '5xx' | '4xx-auth' | '4xx-other' | 'network';
  message: string;
}

export interface FallbackOutcome<T> {
  result: T;
  /** Provider that produced `result`. Same as `primary` on the happy path. */
  usedProvider: LLMProvider;
  /** Providers attempted before the one that succeeded. Empty on happy path. */
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

/**
 * Whether a classified error is in the admin-configured trigger list.
 *
 * 4xx-auth / 4xx-other are NEVER retried regardless of triggers — they
 * indicate a bad key or a bad prompt; swapping providers wastes the next
 * provider's quota too.
 *
 * 'network' (no HTTP status — SDK threw before the response) is rolled
 * under the '5xx' trigger: both are infra failures the user hasn't
 * misconfigured.
 */
function isTriggered(
  cls: ReturnType<typeof classifyProviderError>,
  triggers: Array<'429-quota' | '429-rate' | '5xx'>,
): boolean {
  if (cls === null || cls === '4xx-auth' || cls === '4xx-other') return false;
  if (cls === 'network') return triggers.includes('5xx');
  return triggers.includes(cls);
}

/**
 * Execute `executor` with fallback.
 *
 * Flow:
 *   1. Call `executor(primary)`. If it succeeds, return immediately (no
 *      hops). This is the hot path — fallback adds zero overhead when
 *      the primary provider is healthy.
 *   2. On failure, classify the error. If fallback is disabled or the
 *      error class isn't a configured trigger, rethrow. Same goes for
 *      LLMRequiredError (config problem, not transient).
 *   3. Walk `cfg.fallback.chain`, skipping the primary (already tried)
 *      and any provider without a configured API key. First success wins.
 *   4. If every chain entry fails, rethrow the ORIGINAL primary error —
 *      keeping the error class the caller expected (e.g. the route handler
 *      still maps to 502 via errorResponse). Hops are logged but not
 *      attached to the rethrown error; the admin can read them in the
 *      server logs.
 *
 * The executor is responsible for per-provider dispatch. It receives the
 * provider name and returns the scenario's result. Scenario-specific logic
 * (e.g. "for localize, non-openai providers = use claude hydrate output
 * unpolished") lives in the caller, not here.
 */
export async function executeWithFallback<T>(
  scenario: LLMScenario,
  primary: LLMProvider,
  executor: (provider: LLMProvider) => Promise<T>,
): Promise<FallbackOutcome<T>> {
  const cfg = await readLLMConfig();
  const hops: FallbackHop[] = [];

  // Primary attempt.
  let primaryError: unknown;
  try {
    const result = await executor(primary);
    return { result, usedProvider: primary, hops };
  } catch (err) {
    if (err instanceof LLMRequiredError) throw err;
    primaryError = err;

    const cls = classifyProviderError(err);
    const msg = err instanceof Error ? err.message : String(err);

    // Diagnostic — surfaced in Vercel logs so admins can see why fallback
    // either ran or short-circuited. Useful when the user reports
    // "fallback's enabled but I still get a 502" (usually the classifier
    // bucketed the error in 4xx-auth/-other and the trigger list doesn't
    // contain that bucket; intentionally — but the log makes it visible).
    console.warn(
      `[llm-fallback] ${scenario} primary=${primary} threw → ` +
        `classified=${cls ?? 'null'} ` +
        `enabled=${cfg.fallback.enabled} ` +
        `triggers=${cfg.fallback.triggers.join('|')} ` +
        `triggerHit=${isTriggered(cls, cfg.fallback.triggers)} ` +
        `errorType=${err?.constructor?.name ?? typeof err} ` +
        `causeStatus=${(err as any)?.cause?.status ?? 'n/a'} ` +
        `causeMsgHead=${String((err as any)?.cause?.message ?? '').slice(0, 100)}`,
    );

    if (!cfg.fallback.enabled) throw err;
    if (!isTriggered(cls, cfg.fallback.triggers)) throw err;

    hops.push({
      provider: primary,
      errorClass: cls ?? 'network',
      message: msg,
    });
  }

  // Walk the chain. Primary already tried; skip providers without keys
  // so a partial environment (only Claude + DeepSeek configured) still
  // makes progress rather than hitting "gemini: LLM_REQUIRED" as a hop.
  const remaining = cfg.fallback.chain.filter((p) => p !== primary && hasKey(p));
  for (const next of remaining) {
    try {
      const result = await executor(next);
      console.warn(
        `[llm-fallback] ${scenario} fell back ${primary} → ${next} after ${hops.length} failed hop(s)`,
      );
      return { result, usedProvider: next, hops };
    } catch (err2) {
      if (err2 instanceof LLMRequiredError) throw err2;
      const cls2 = classifyProviderError(err2);
      hops.push({
        provider: next,
        errorClass: cls2 ?? 'network',
        message: err2 instanceof Error ? err2.message : String(err2),
      });
      // Non-retryable: stop. A bad-prompt 400 will recur across providers.
      if (cls2 === '4xx-auth' || cls2 === '4xx-other') break;
    }
  }

  // Exhausted the chain. Rethrow the original primary error so the route
  // handler maps it to the same HTTP status the user would have seen
  // without fallback. Hops survive in the server log above; they're not
  // exposed on the rethrown error because the existing error types are
  // intentionally narrow.
  console.error(
    `[llm-fallback] ${scenario} chain exhausted; hops:`,
    hops.map((h) => `${h.provider}=${h.errorClass}`).join(' → '),
  );
  throw primaryError;
}

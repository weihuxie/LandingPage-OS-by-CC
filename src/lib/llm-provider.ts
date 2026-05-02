/**
 * Scenario dispatch layer · v2.
 *
 * Reads the per-scenario policy from llm-config and walks chain[0]→[N].
 * Each chain step carries (provider, model) so the adapter can be told
 * which model to use at runtime — no more global providers.X.model.
 *
 * The dispatch is `executor(step)` style — the caller decides which
 * adapter handles which provider. This file only orchestrates the
 * walk; per-adapter logic stays in llm-claude / llm-deepseek / etc.
 *
 * Public entry points (back-compat with v1 callers):
 *   - generateStrategyViaProvider(...): runs the 'strategy' chain
 *   - regenerateModuleViaProvider(...): runs the 'copy' chain
 * Both accept an optional `onTrace` callback so callers (route handlers)
 * can attach the chosen step + hop history to their HTTP response and
 * the editor's floating toast can show "which provider answered".
 */
import type {
  ProductInputs,
  StrategySummary,
  PageLocale,
  ToneKey,
  ModuleType,
  NarrativeVariant,
} from './types';
import type { ExtractedContext } from './extract';
import {
  hasClaudeKey,
  generateStrategyViaClaude,
  regenerateModuleViaClaude,
  type ClaudeModuleContent,
} from './llm-claude';
import {
  hasDeepseekKey,
  generateStrategyViaDeepseek,
  regenerateModuleViaDeepseek,
} from './llm-deepseek';
import type { LLMProvider, ScenarioStep } from './llm-config';
import { executeScenario, type FallbackHop } from './llm-fallback';
import { LLMCallError } from './errors';

export type TraceCallback = (info: {
  primary: LLMProvider;
  primaryModel: string;
  used: LLMProvider;
  usedModel: string;
  hops: FallbackHop[];
}) => void;

/**
 * Strategy generation. Walks the strategy/<locale> chain. Each step's
 * provider must have a strategy adapter (claude or deepseek today); if
 * the admin configured a non-implementing provider we throw inside the
 * executor so the chain promotes past it on the next iteration.
 */
export async function generateStrategyViaProvider(
  inputs: ProductInputs,
  context?: ExtractedContext,
  onTrace?: TraceCallback,
): Promise<StrategySummary> {
  // Audit Wave 2 #D: capture actual model used by the adapter (may differ
  // from step.model when DeepSeek runtime-swaps to RUNTIME_FALLBACK_MODEL
  // on tool_choice rejection).
  let actualModelUsed: string | undefined;
  const captureModel = (m: string) => { actualModelUsed = m; };
  const outcome = await executeScenario(
    'strategy',
    inputs.locale,
    async (step: ScenarioStep) => {
      if (step.provider === 'claude') {
        return generateStrategyViaClaude(inputs, context, step.model);
      }
      if (step.provider === 'deepseek') {
        return generateStrategyViaDeepseek(inputs, context, step.model, captureModel);
      }
      throw new LLMCallError(
        step.provider === 'gemini' ? 'gemini' : 'gpt',
        'strategy',
        new Error(`provider ${step.provider} has no strategy adapter`),
      );
    },
  );
  if (onTrace) {
    // chain[0] — primary
    const cfg = (await import('./llm-config')).policyFor(
      await (await import('./llm-config')).readLLMConfig(),
      'strategy',
      inputs.locale,
    );
    const primary = cfg.chain[0];
    onTrace({
      primary: primary.provider,
      primaryModel: primary.model,
      used: outcome.usedStep.provider,
      // Prefer the actual model reported by the adapter; fall back to the
      // configured step.model if the adapter didn't report (e.g. Claude
      // — which doesn't runtime-swap models).
      usedModel: actualModelUsed ?? outcome.usedStep.model,
      hops: outcome.hops,
    });
  }
  return outcome.result;
}

/**
 * Module regen — same shape as strategy but on the 'copy' scenario.
 */
export async function regenerateModuleViaProvider(
  type: ModuleType,
  inputs: ProductInputs,
  strategy: StrategySummary,
  tone: ToneKey,
  locale: PageLocale,
  variant?: NarrativeVariant,
  onTrace?: TraceCallback,
): Promise<Partial<ClaudeModuleContent> | null> {
  // Audit Wave 2 #D: see comment in generateStrategyViaProvider above.
  let actualModelUsed: string | undefined;
  const captureModel = (m: string) => { actualModelUsed = m; };
  const outcome = await executeScenario(
    'copy',
    locale,
    async (step: ScenarioStep) => {
      if (step.provider === 'claude') {
        return regenerateModuleViaClaude(type, inputs, strategy, tone, locale, variant, step.model);
      }
      if (step.provider === 'deepseek') {
        return regenerateModuleViaDeepseek(type, inputs, strategy, tone, locale, variant, step.model, captureModel);
      }
      throw new LLMCallError(
        step.provider === 'gemini' ? 'gemini' : 'gpt',
        'module-regen',
        new Error(`provider ${step.provider} has no copy adapter`),
      );
    },
  );
  if (onTrace) {
    const cfg = (await import('./llm-config')).policyFor(
      await (await import('./llm-config')).readLLMConfig(),
      'copy',
      locale,
    );
    const primary = cfg.chain[0];
    onTrace({
      primary: primary.provider,
      primaryModel: primary.model,
      used: outcome.usedStep.provider,
      usedModel: actualModelUsed ?? outcome.usedStep.model,
      hops: outcome.hops,
    });
  }
  return outcome.result;
}

/**
 * Diagnostic helper for /api/capabilities — returns the current primary
 * step for the 'copy' scenario (the one most call paths touch). Kept
 * back-compat with the v1 string return on the `primary` field so the
 * dashboard's existing capability checks keep working without a refactor.
 */
export async function describeCopyPrimary(
  locale: string,
): Promise<{
  primary: LLMProvider;
  primaryModel: string;
  hasClaude: boolean;
  hasDeepseek: boolean;
  configSource: 'kv' | 'fs' | 'default';
  reason: string;
}> {
  const { readLLMConfig, policyFor } = await import('./llm-config');
  const cfg = await readLLMConfig();
  const policy = policyFor(cfg, 'copy', locale);
  const primary = policy.chain[0];
  return {
    primary: primary.provider,
    primaryModel: primary.model,
    hasClaude: hasClaudeKey(),
    hasDeepseek: hasDeepseekKey(),
    configSource: 'kv', // simplification — caller doesn't depend on this anymore
    reason: `chain[0] = ${primary.provider}/${primary.model} for copy/${locale}`,
  };
}

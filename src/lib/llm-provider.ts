/**
 * Provider routing layer — decides which LLM backend handles a given
 * strategy / module-regen call based on locale, configured keys, and an
 * optional operator override.
 *
 * Design:
 *   - Two providers participate: `claude` (Anthropic, premium quality,
 *     expensive) and `deepseek` (OpenAI-compatible, ~30× cheaper, strong
 *     on CJK).
 *   - Default routing is quality-sensitive for Japanese and cost-optimized
 *     for every other locale:
 *       ja   → claude if available, else deepseek, else claude (throws
 *              LLMRequiredError at the adapter layer if neither key set).
 *       *    → deepseek if available, else claude.
 *   - Operator override via `LLM_PRIMARY=claude` or `LLM_PRIMARY=deepseek`
 *     pins every call to one provider regardless of locale. Useful for
 *     debugging output differences side-by-side, or for an emergency
 *     switch if one provider is down.
 *
 * Why JP defaults to Claude:
 *   - Japanese B2B landing pages have the lowest tolerance for stilted
 *     AI-flavored phrasing; 控えめ・信頼ファースト requires genuine
 *     native feel. In blind review, Claude's JP output still beats
 *     DeepSeek's enough to justify the cost at the current traffic
 *     volume. Revisit this if the quality gap closes.
 *   - If ANTHROPIC_API_KEY isn't set, JP transparently falls back to
 *     DeepSeek (quality better than template, still fails loud if
 *     neither key is configured).
 *
 * Throws nothing on its own — only picks the function to call. The chosen
 * adapter throws LLMRequiredError / LLMCallError as normal.
 */

import type {
  ProductInputs,
  StrategySummary,
  PageLocale,
  ToneKey,
  ModuleType,
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

export type LLMPrimary = 'claude' | 'deepseek';

/**
 * Read the operator override from env. Returns undefined if unset or
 * invalid so callers can fall through to locale-based routing.
 */
function readPrimaryOverride(): LLMPrimary | undefined {
  // eslint-disable-next-line dot-notation
  const raw = (process.env['LLM_PRIMARY'] ?? '').toLowerCase().trim();
  if (raw === 'claude' || raw === 'deepseek') return raw;
  return undefined;
}

/**
 * Pick a provider for the given locale.
 *
 * Decision tree:
 *   1. If LLM_PRIMARY env override is set AND that provider has its key
 *      configured → use it.
 *   2. Otherwise use the locale-specific default:
 *      - ja: claude preferred, deepseek fallback
 *      - others: deepseek preferred, claude fallback
 *   3. If NEITHER key is configured, return 'claude' (the adapter will
 *      throw LLMRequiredError with the ANTHROPIC_API_KEY message — this
 *      is the default primary name the rest of the codebase references,
 *      and the UI's capability banner still makes sense).
 */
export function providerFor(locale: PageLocale | undefined): LLMPrimary {
  const hasClaude = hasClaudeKey();
  const hasDeep = hasDeepseekKey();
  const override = readPrimaryOverride();

  // Operator override, honored only if that provider actually has a key.
  // Silently ignoring an override with no key would produce "why is this
  // hitting Claude, I set LLM_PRIMARY=deepseek" confusion — instead we
  // fall through to the default ladder below which will pick whichever
  // provider IS configured.
  if (override === 'claude' && hasClaude) return 'claude';
  if (override === 'deepseek' && hasDeep) return 'deepseek';

  if (locale === 'ja') {
    if (hasClaude) return 'claude';
    if (hasDeep) return 'deepseek';
    return 'claude'; // neither key set; adapter throws LLMRequiredError
  }
  // Non-JP: cost-optimize with DeepSeek first.
  if (hasDeep) return 'deepseek';
  if (hasClaude) return 'claude';
  return 'claude'; // neither key set; adapter throws LLMRequiredError
}

/**
 * Describe the current routing state, for the /api/capabilities endpoint
 * and the status bar in the dashboard. Lets the UI show a sentence like
 * "日本語 tab will use Claude; other locales will use DeepSeek" without
 * the frontend having to replicate this logic.
 */
export function describeRouting(): {
  primary: LLMPrimary;
  reason: string;
  hasClaude: boolean;
  hasDeepseek: boolean;
  override: LLMPrimary | undefined;
} {
  const hasClaude = hasClaudeKey();
  const hasDeepseek = hasDeepseekKey();
  const override = readPrimaryOverride();

  // "Primary" here is what non-JP locales will use. JP is always noted
  // separately in `reason` because it has its own preference.
  let primary: LLMPrimary;
  let reason: string;

  if (override === 'claude' && hasClaude) {
    primary = 'claude';
    reason = 'LLM_PRIMARY=claude override is set';
  } else if (override === 'deepseek' && hasDeepseek) {
    primary = 'deepseek';
    reason = 'LLM_PRIMARY=deepseek override is set';
  } else if (hasDeepseek && hasClaude) {
    primary = 'deepseek';
    reason = 'Cost-optimized: non-JP → DeepSeek, ja → Claude';
  } else if (hasDeepseek) {
    primary = 'deepseek';
    reason = 'Only DEEPSEEK_API_KEY is configured';
  } else if (hasClaude) {
    primary = 'claude';
    reason = 'Only ANTHROPIC_API_KEY is configured';
  } else {
    primary = 'claude';
    reason = 'No LLM key configured — calls will return 503';
  }

  return {
    primary,
    reason,
    hasClaude,
    hasDeepseek,
    override,
  };
}

/**
 * Unified strategy-generation entrypoint. Dispatches to the provider
 * chosen by `providerFor(inputs.locale)`.
 */
export async function generateStrategyViaProvider(
  inputs: ProductInputs,
  context?: ExtractedContext,
): Promise<StrategySummary> {
  const provider = providerFor(inputs.locale);
  if (provider === 'claude') {
    return generateStrategyViaClaude(inputs, context);
  }
  return generateStrategyViaDeepseek(inputs, context);
}

/**
 * Unified module-regen entrypoint. Dispatches to the provider chosen by
 * `providerFor(locale)`.
 */
export async function regenerateModuleViaProvider(
  type: ModuleType,
  inputs: ProductInputs,
  strategy: StrategySummary,
  tone: ToneKey,
  locale: PageLocale,
): Promise<Partial<ClaudeModuleContent> | null> {
  const provider = providerFor(locale);
  if (provider === 'claude') {
    return regenerateModuleViaClaude(type, inputs, strategy, tone, locale);
  }
  return regenerateModuleViaDeepseek(type, inputs, strategy, tone, locale);
}

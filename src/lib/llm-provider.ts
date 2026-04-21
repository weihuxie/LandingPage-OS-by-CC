/**
 * Provider routing layer — picks which LLM adapter handles a given
 * strategy / copy / localize / extract call.
 *
 * 2026-04 refactor: routing USED to be hardcoded (JP → claude, others →
 * deepseek, with an LLM_PRIMARY env override). It's now driven by the
 * admin-editable LLMConfig so operators can rebalance quality vs. cost
 * without a redeploy. The env override still exists as a higher-priority
 * debug lever (useful for A/B between providers without touching KV).
 *
 * Priority chain for each scenario:
 *   1. LLM_PRIMARY env override → that provider, IF its key is configured
 *   2. Admin config's scenarios[scenario][ja|default] → that provider, IF
 *      its key is configured AND it has an implementation for this scenario
 *   3. Hardcoded fallback ladder (the pre-refactor defaults) so the app
 *      stays usable even if the config is missing or points at an
 *      unimplemented combination (e.g. strategy → gemini, which has no
 *      strategy adapter today)
 *
 * The adapters only throw LLMRequiredError if NO key at all is configured.
 * If at least one provider has a key, routing resolves to something
 * callable; the returned provider is never "unreachable".
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
import { readLLMConfig, DEFAULT_LLM_CONFIG, type LLMProvider } from './llm-config';

/**
 * Subset of providers that actually have a strategy+copy adapter. Kept
 * as a narrow type so the admin UI can wire dropdowns to exactly what's
 * implemented rather than advertising choices that silently fall back.
 */
export type LLMPrimary = 'claude' | 'deepseek';

/**
 * Admin-configurable scenarios that this router dispatches. Localize and
 * extract are handled in their own adapter files (llm-openai.ts,
 * llm-gemini.ts) because they route to a single provider today — the
 * config layer records the choice but there's no multi-provider dispatch
 * to orchestrate here yet.
 */
export type RoutedScenario = 'strategy' | 'copy';

function readPrimaryOverride(): LLMPrimary | undefined {
  // eslint-disable-next-line dot-notation
  const raw = (process.env['LLM_PRIMARY'] ?? '').toLowerCase().trim();
  if (raw === 'claude' || raw === 'deepseek') return raw;
  return undefined;
}

/**
 * Coerce an arbitrary LLMProvider (could be openai or gemini, which have
 * no strategy/copy adapter) to a LLMPrimary that does. Used as the last
 * step of routing so the caller always gets a callable function back.
 *
 * Strategy is: if the configured provider is implementable → return it.
 * Otherwise use the hardcoded ladder (ja → claude, others → deepseek),
 * preferring whichever key IS set.
 */
function coerceToPrimary(
  configured: LLMProvider,
  locale: PageLocale | undefined,
): LLMPrimary {
  const hasClaude = hasClaudeKey();
  const hasDeep = hasDeepseekKey();

  if (configured === 'claude' && hasClaude) return 'claude';
  if (configured === 'deepseek' && hasDeep) return 'deepseek';

  // Configured provider isn't implementable (or its key is missing). Use
  // the quality-over-cost ladder for JP, cost-over-quality for others.
  if (locale === 'ja') {
    if (hasClaude) return 'claude';
    if (hasDeep) return 'deepseek';
    return 'claude'; // adapter will throw LLMRequiredError
  }
  if (hasDeep) return 'deepseek';
  if (hasClaude) return 'claude';
  return 'claude'; // adapter will throw LLMRequiredError
}

/**
 * Pick a provider for a given scenario+locale.
 *
 * `scenario` defaults to 'copy' so pre-refactor call sites that used
 * `providerFor(locale)` keep working — both strategy and copy had the
 * same routing under the old hardcoded rules.
 */
export async function providerFor(
  locale: PageLocale | undefined,
  scenario: RoutedScenario = 'copy',
): Promise<LLMPrimary> {
  const override = readPrimaryOverride();
  if (override === 'claude' && hasClaudeKey()) return 'claude';
  if (override === 'deepseek' && hasDeepseekKey()) return 'deepseek';

  let configured: LLMProvider;
  try {
    const cfg = await readLLMConfig();
    configured = locale === 'ja'
      ? cfg.scenarios[scenario].ja
      : cfg.scenarios[scenario].default;
  } catch {
    configured = locale === 'ja'
      ? DEFAULT_LLM_CONFIG.scenarios[scenario].ja
      : DEFAULT_LLM_CONFIG.scenarios[scenario].default;
  }
  return coerceToPrimary(configured, locale);
}

/**
 * Human-readable routing summary for /api/capabilities and the dashboard
 * status strip. Reports the effective primary + reason so operators can
 * audit "why did this call go to DeepSeek" without reading code.
 */
export async function describeRouting(): Promise<{
  primary: LLMPrimary;
  reason: string;
  hasClaude: boolean;
  hasDeepseek: boolean;
  override: LLMPrimary | undefined;
  configSource: 'kv' | 'default';
}> {
  const hasClaude = hasClaudeKey();
  const hasDeepseek = hasDeepseekKey();
  const override = readPrimaryOverride();

  let configSource: 'kv' | 'default' = 'default';
  try {
    await readLLMConfig();
    configSource = 'kv';
  } catch {
    configSource = 'default';
  }

  let primary: LLMPrimary;
  let reason: string;

  if (override === 'claude' && hasClaude) {
    primary = 'claude';
    reason = 'LLM_PRIMARY=claude override';
  } else if (override === 'deepseek' && hasDeepseek) {
    primary = 'deepseek';
    reason = 'LLM_PRIMARY=deepseek override';
  } else {
    // Default (non-JP copy) routing from admin config.
    primary = await providerFor(undefined, 'copy');
    reason = `Admin config · copy.default → ${primary}`;
  }

  return { primary, reason, hasClaude, hasDeepseek, override, configSource };
}

/** Unified strategy-generation entrypoint. */
export async function generateStrategyViaProvider(
  inputs: ProductInputs,
  context?: ExtractedContext,
): Promise<StrategySummary> {
  const provider = await providerFor(inputs.locale, 'strategy');
  if (provider === 'claude') {
    return generateStrategyViaClaude(inputs, context);
  }
  return generateStrategyViaDeepseek(inputs, context);
}

/**
 * Unified module-regen entrypoint.
 *
 * `variant` threads A/B narrative framing into the adapter prompt so
 * hero regeneration produces variant-specific copy. Non-hero modules
 * ignore the hint (see variantHintForModule in llm-claude.ts). User-
 * initiated single-module regen passes the page's activeVariant; the
 * hydrate orchestrator passes 'A' / 'B' explicitly per variant.
 */
export async function regenerateModuleViaProvider(
  type: ModuleType,
  inputs: ProductInputs,
  strategy: StrategySummary,
  tone: ToneKey,
  locale: PageLocale,
  variant?: NarrativeVariant,
): Promise<Partial<ClaudeModuleContent> | null> {
  const provider = await providerFor(locale, 'copy');
  if (provider === 'claude') {
    return regenerateModuleViaClaude(type, inputs, strategy, tone, locale, variant);
  }
  return regenerateModuleViaDeepseek(type, inputs, strategy, tone, locale, variant);
}

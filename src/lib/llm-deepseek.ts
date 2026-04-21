/**
 * DeepSeek adapter — OpenAI-compatible endpoint, cost-optimized primary.
 *
 * Why this exists:
 *   - Anthropic credits exhausted mid-session; routing every page creation
 *     through Opus burned ~$0.05 per landing page just on hero/pain/
 *     benefits/solution/cta hydration. DeepSeek-V3 is roughly 30× cheaper
 *     ($0.27 / $1.10 per M input/output vs Claude Opus $15 / $75), and on
 *     B2B SaaS strategy/copy generation produces output that's
 *     indistinguishable from Claude in blind review at Chinese locales.
 *   - DeepSeek exposes the OpenAI Chat Completions API verbatim —
 *     including function/tool calling AND prompt caching (the two
 *     features Claude made expensive). We reuse the existing `openai`
 *     SDK via baseURL override instead of pulling another dependency.
 *
 * Why not Kimi / GLM / Qwen:
 *   - Kimi's tool-use JSON schema is non-standard (requires
 *     `tool_choice: 'required'` quirks that break the OpenAI client's
 *     typing).
 *   - GLM-4 / Qwen-max are 2-3× more expensive than DeepSeek at similar
 *     quality for English output, and DeepSeek's prompt caching preserves
 *     the warm-cache savings pattern this codebase was built around.
 *
 * Shared prompts:
 *   - STRATEGY_SYSTEM and MODULE_SYSTEM are imported verbatim from
 *     `llm-claude.ts`. DeepSeek's context window (64k) swallows them
 *     without trimming, and keeping one source of truth means edits to
 *     the strategist/copywriter instructions propagate to every provider.
 *
 * Error policy:
 *   - Mirrors llm-claude.ts exactly — LLMRequiredError on missing key,
 *     LLMCallError on network/schema failures, null-return ONLY for the
 *     routing case (module type outside CLAUDE_MODULE_TYPES). No silent
 *     template fallback. See CLAUDE.md §2.1 for the fig-leaf history.
 *
 * Caching:
 *   - DeepSeek API automatically caches prefixes >= 64 tokens and applies
 *     10× discount on cache hits (no explicit cache_control header
 *     required, unlike Anthropic). The long system prompts here (>2k
 *     tokens each) will cache on the very first call. No code change
 *     needed to benefit from this — the API handles it transparently.
 */

import OpenAI from 'openai';
import type {
  ProductInputs,
  StrategySummary,
  PageLocale,
  ToneKey,
  ModuleType,
} from './types';
import type { ExtractedContext } from './extract';
import { LLMRequiredError, LLMCallError } from './errors';
import {
  STRATEGY_SYSTEM,
  MODULE_SYSTEM,
  MODULE_SCHEMAS,
  LLM_MODULE_TYPES,
  extractJsonObject,
  type ClaudeModuleContent,
} from './llm-claude';
import { readLLMConfig, DEFAULT_LLM_CONFIG } from './llm-config';

export function hasDeepseekKey(): boolean {
  // eslint-disable-next-line dot-notation
  return !!process.env['DEEPSEEK_API_KEY'];
}

// Model comes from the admin-configurable llm-config at runtime; the
// default here (deepseek-chat) lives in DEFAULT_LLM_CONFIG. The admin
// can pick deepseek-reasoner from /admin/llm if strategy output needs
// thinking-mode quality.
const MAX_TOKENS = 4096;
const BASE_URL = 'https://api.deepseek.com/v1';

async function resolveModel(): Promise<string> {
  try {
    const cfg = await readLLMConfig();
    return cfg.providers.deepseek.model || DEFAULT_LLM_CONFIG.providers.deepseek.model;
  } catch {
    return DEFAULT_LLM_CONFIG.providers.deepseek.model;
  }
}

function getClient(): OpenAI {
  // eslint-disable-next-line dot-notation
  const apiKey = process.env['DEEPSEEK_API_KEY'];
  if (!apiKey) {
    // Defensive — callers have already checked hasDeepseekKey(). If we got
    // here without a key it's a programming error, not a capability gap.
    throw new LLMRequiredError('strategy', 'DEEPSEEK_API_KEY');
  }
  return new OpenAI({ apiKey, baseURL: BASE_URL });
}

// ====================================================================
// Strategy generation
// ====================================================================

const STRATEGY_TOOL_NAME = 'emit_strategy';
const STRATEGY_SCHEMA = {
  type: 'object' as const,
  properties: {
    audience: { type: 'array' as const, items: { type: 'string' as const } },
    goal: { type: 'array' as const, items: { type: 'string' as const } },
    narrative: { type: 'array' as const, items: { type: 'string' as const } },
    local: { type: 'array' as const, items: { type: 'string' as const } },
  },
  required: ['audience', 'goal', 'narrative', 'local'],
  additionalProperties: false,
};

/**
 * Produce a StrategySummary via real DeepSeek API call.
 *
 * Uses OpenAI-style function calling (tools + tool_choice) — DeepSeek
 * validates tool input against the JSON schema server-side, so we get
 * syntactically valid JSON without prompt-level pleading. Same design
 * as llm-claude.ts's strategy path.
 *
 * Throws:
 *   - LLMRequiredError('strategy', 'DEEPSEEK_API_KEY') when no key.
 *   - LLMCallError('deepseek', 'strategy', cause) when the SDK call
 *     fails, the response has no tool_call, or the payload is malformed.
 *     Route handlers map to 502/503 via errorResponse().
 */
export async function generateStrategyViaDeepseek(
  inputs: ProductInputs,
  context?: ExtractedContext,
): Promise<StrategySummary> {
  if (!hasDeepseekKey()) {
    throw new LLMRequiredError('strategy', 'DEEPSEEK_API_KEY');
  }

  const client = getClient();

  const productBlock = [
    `Product: ${inputs.name}`,
    `Tagline: ${inputs.tagline || '(none)'}`,
    `Category: ${inputs.category || '(unspecified)'}`,
    `Core value: ${inputs.value || '(unspecified)'}`,
    `Target market: ${inputs.market}`,
    `Target locale: ${inputs.locale}`,
    `Conversion goal: ${inputs.cta}`,
    `Primary traffic source: ${inputs.source}`,
    `Audience: ${[inputs.industry, inputs.companySize, inputs.role].filter(Boolean).join(' · ') || '(unspecified)'}`,
  ].join('\n');

  let factsBlock = '';
  if (context && context.textLength > 0) {
    const lines: string[] = [];
    if (context.namedCustomers.length)
      lines.push(`Named customers: ${context.namedCustomers.slice(0, 6).join(', ')}`);
    if (context.metrics.length)
      lines.push(`Concrete metrics: ${context.metrics.slice(0, 6).join(' · ')}`);
    if (context.features.length)
      lines.push(`Features mentioned: ${context.features.slice(0, 6).join(' · ')}`);
    if (context.pains.length)
      lines.push(`Pain phrases (verbatim):\n${context.pains.slice(0, 4).map((p) => `  • ${p}`).join('\n')}`);
    if (context.personas.length)
      lines.push(`Personas mentioned: ${context.personas.slice(0, 4).join(' · ')}`);
    if (context.summary)
      lines.push(`Summary of source material:\n${context.summary.slice(0, 600)}`);
    if (lines.length) {
      factsBlock =
        '\n\n--- Extracted from user-provided materials ---\n' + lines.join('\n');
    }
  }

  const userPrompt = `${productBlock}${factsBlock}

--- Task ---
Produce the four-section strategy summary for the product above.

Mandatory checks before you emit each line:
1. Does this line reference a specific word, number, role, or entity that appears in the product inputs above? If no → rewrite or omit.
2. Could this exact line be pasted onto a different SaaS landing page without changing a word? If yes → rewrite or omit.
3. Does this line reach for a forbidden default ("每周节省 X 小时" / "ROI 计算器" / "Head of RevOps" / "logo 墙" / "提升生产力 X%") that is NOT in the product inputs above? If yes → rewrite or omit.

Locale rules:
- Write audience / goal / narrative bullets in ${inputs.locale}.
- Write local adjustments in ${inputs.locale}.
- Never translate between locales — write natively.

Verbatim rules:
- Use the product name "${inputs.name}" at least once.
- If the tagline "${inputs.tagline || '(none)'}" contains a concrete promise, echo its key nouns/verbs.
- Any named customer, metric, or pain phrase from the extracted materials must appear verbatim — do not round, paraphrase, or soften.`;

  const model = await resolveModel();
  try {
    const response = await client.chat.completions.create({
      model,
      max_tokens: MAX_TOKENS,
      temperature: 0.4,
      messages: [
        { role: 'system', content: STRATEGY_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: STRATEGY_TOOL_NAME,
            description:
              'Emit the four-part strategy summary. Each array must contain 3-5 short declarative strings in the target locale.',
            parameters: STRATEGY_SCHEMA,
          },
        },
      ],
      tool_choice: {
        type: 'function',
        function: { name: STRATEGY_TOOL_NAME },
      },
    });

    const choice = response.choices[0];
    const toolCall = choice?.message?.tool_calls?.[0];

    // Preferred path: tool_call with validated JSON arguments.
    if (toolCall && toolCall.type === 'function') {
      const argsText = toolCall.function.arguments;
      const parsed = extractJsonObject<StrategySummary>(argsText);
      if (
        parsed &&
        Array.isArray(parsed.audience) &&
        Array.isArray(parsed.goal) &&
        Array.isArray(parsed.narrative) &&
        Array.isArray(parsed.local)
      ) {
        return parsed;
      }
      console.error(
        '[deepseek] strategy: tool_call arguments shape mismatch. Raw (first 400):',
        argsText.slice(0, 400),
      );
      // Fall through to text-content fallback.
    }

    // Fallback: some deployments may return JSON in content when
    // tool_choice is honored but arguments are empty. Parse the text.
    const textContent = choice?.message?.content;
    if (!textContent || typeof textContent !== 'string') {
      throw new LLMCallError(
        'deepseek',
        'strategy',
        undefined,
        `DeepSeek returned no tool_call and no text content. finish_reason=${choice?.finish_reason ?? 'unknown'}`,
      );
    }
    const parsed = extractJsonObject<StrategySummary>(textContent);
    if (!parsed) {
      throw new LLMCallError(
        'deepseek',
        'strategy',
        undefined,
        `DeepSeek text fallback was not parseable JSON. Raw (first 400): ${textContent.slice(0, 400)}`,
      );
    }
    if (
      !Array.isArray(parsed.audience) ||
      !Array.isArray(parsed.goal) ||
      !Array.isArray(parsed.narrative) ||
      !Array.isArray(parsed.local)
    ) {
      throw new LLMCallError(
        'deepseek',
        'strategy',
        undefined,
        `DeepSeek JSON missing required arrays. Keys: ${Object.keys(parsed as object).join(',')}`,
      );
    }
    return parsed;
  } catch (e: any) {
    if (e instanceof LLMCallError || e instanceof LLMRequiredError) throw e;
    console.error(
      '[deepseek] strategy generation failed:',
      e?.status ?? '',
      e?.message ?? e,
    );
    throw new LLMCallError('deepseek', 'strategy', e);
  }
}

// ====================================================================
// Module content regeneration
// ====================================================================

const MODULE_TOOL_NAMES: Record<string, string> = {
  hero: 'emit_hero',
  pain: 'emit_pain',
  benefits: 'emit_benefits',
  solution: 'emit_solution',
  cta: 'emit_cta',
};
const MODULE_TOOL_DESCRIPTIONS: Record<string, string> = {
  hero: 'Emit rewritten hero module content in the target locale.',
  pain: 'Emit rewritten pain module content in the target locale.',
  benefits: 'Emit rewritten benefits module content in the target locale.',
  solution: 'Emit rewritten solution module content in the target locale.',
  cta: 'Emit rewritten CTA module content in the target locale.',
};

/**
 * Rewrite a module's content via DeepSeek.
 *
 * Returns:
 *   - Partial<ClaudeModuleContent> on success; caller merges over existing.
 *   - null ONLY when the module type isn't one we handle (form / faq /
 *     testimonial etc. — user-authored from the asset library). That's a
 *     routing decision, not a failure.
 *
 * Throws:
 *   - LLMRequiredError('module-regen', 'DEEPSEEK_API_KEY') when no key.
 *   - LLMCallError('deepseek', 'module-regen', cause) when the SDK call
 *     fails or the payload is malformed.
 */
export async function regenerateModuleViaDeepseek(
  type: ModuleType,
  inputs: ProductInputs,
  strategy: StrategySummary,
  tone: ToneKey,
  locale: PageLocale,
): Promise<Partial<ClaudeModuleContent> | null> {
  if (!hasDeepseekKey()) {
    throw new LLMRequiredError('module-regen', 'DEEPSEEK_API_KEY');
  }
  // "Not my job" — caller routes unsupported types elsewhere.
  if (!LLM_MODULE_TYPES.has(type)) return null;
  if (!MODULE_SCHEMAS[type]) return null;

  const client = getClient();

  const productLines = [
    `Product: ${inputs.name}`,
    `Tagline: ${inputs.tagline || '(none)'}`,
    `Category: ${inputs.category || '(unspecified)'}`,
    `Core value: ${inputs.value || '(unspecified)'}`,
    `Target market: ${inputs.market}`,
    `Target locale: ${locale}`,
    `Conversion goal: ${inputs.cta}`,
    `Primary traffic source: ${inputs.source}`,
    `Tone: ${tone}`,
    `Audience: ${[inputs.industry, inputs.companySize, inputs.role].filter(Boolean).join(' · ') || '(unspecified)'}`,
  ].join('\n');

  const strategyLines = [
    'Strategy summary (use this as the source of truth):',
    `- Audience: ${strategy.audience.slice(0, 5).join(' | ')}`,
    `- Goal: ${strategy.goal.slice(0, 4).join(' | ')}`,
    `- Narrative: ${strategy.narrative.slice(0, 4).join(' | ')}`,
    `- Local adjustments: ${strategy.local.slice(0, 4).join(' | ')}`,
  ].join('\n');

  const toolName = MODULE_TOOL_NAMES[type];
  const userPrompt = [
    productLines,
    '',
    strategyLines,
    '',
    `Rewrite the ${type.toUpperCase()} module. Call the ${toolName} tool with the content in ${locale}. Tone: ${tone}.`,
  ].join('\n');

  const model = await resolveModel();
  async function attempt(): Promise<Partial<ClaudeModuleContent> | null> {
    const response = await client.chat.completions.create({
      model,
      max_tokens: MAX_TOKENS,
      temperature: 0.5,
      messages: [
        { role: 'system', content: MODULE_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: toolName,
            description: MODULE_TOOL_DESCRIPTIONS[type],
            parameters: MODULE_SCHEMAS[type] as Record<string, unknown>,
          },
        },
      ],
      tool_choice: {
        type: 'function',
        function: { name: toolName },
      },
    });

    const choice = response.choices[0];
    const toolCall = choice?.message?.tool_calls?.[0];

    if (toolCall && toolCall.type === 'function') {
      const parsed = extractJsonObject<Partial<ClaudeModuleContent>>(
        toolCall.function.arguments,
      );
      if (parsed && typeof parsed === 'object') return parsed;
      console.error(
        `[deepseek] module ${type}: tool_call arguments not parseable. Raw (first 300):`,
        toolCall.function.arguments.slice(0, 300),
      );
      // Fall through to text fallback.
    }

    const textContent = choice?.message?.content;
    if (!textContent || typeof textContent !== 'string') {
      throw new LLMCallError(
        'deepseek',
        'module-regen',
        undefined,
        `Module ${type}: DeepSeek returned no tool_call and no content. finish_reason=${choice?.finish_reason ?? 'unknown'}`,
      );
    }
    const parsed = extractJsonObject<Partial<ClaudeModuleContent>>(textContent);
    if (!parsed || typeof parsed !== 'object') {
      throw new LLMCallError(
        'deepseek',
        'module-regen',
        undefined,
        `Module ${type}: DeepSeek text fallback not parseable JSON. Raw (first 300): ${textContent.slice(0, 300)}`,
      );
    }
    return parsed;
  }

  // Retry transient failures — same policy as Claude adapter.
  // 429 rate limit + 5xx server errors are retryable; 4xx validation
  // errors are the prompt's fault and retrying won't help.
  const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
  const MAX_ATTEMPTS = 2;
  let lastErr: unknown = undefined;
  for (let tryN = 1; tryN <= MAX_ATTEMPTS; tryN++) {
    try {
      return await attempt();
    } catch (e: any) {
      lastErr = e;
      if (e instanceof LLMCallError || e instanceof LLMRequiredError) break;
      const status: number | undefined = e?.status;
      const isRetryable = !status || RETRYABLE_STATUSES.has(status);
      if (tryN === MAX_ATTEMPTS || !isRetryable) break;
      const delay = 400 + Math.random() * 300;
      console.warn(
        `[deepseek] module ${type} attempt ${tryN} failed (status=${status ?? 'network'}); retrying in ${delay.toFixed(0)}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  if (lastErr instanceof LLMCallError || lastErr instanceof LLMRequiredError) throw lastErr;
  console.error(
    `[deepseek] module regen failed (${type}) after ${MAX_ATTEMPTS} attempts:`,
    (lastErr as any)?.status ?? '',
    (lastErr as any)?.message ?? lastErr,
  );
  throw new LLMCallError('deepseek', 'module-regen', lastErr);
}

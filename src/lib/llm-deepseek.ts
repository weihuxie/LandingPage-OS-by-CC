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
 *
 * Two model families, two protocols (2026-05 split):
 *   - V3 (deepseek-chat) → tool_choice path. Forces structured JSON via
 *     OpenAI-style function calling. ~3s avg, schema enforced server-side.
 *     Will be deprecated 2026-07-24.
 *   - V4 (deepseek-v4-pro / -flash) → response_format=json_object path.
 *     V4 rejects tool_choice (DeepSeek's V4 routes through reasoner
 *     backend internally), but supports json_mode per their official
 *     tool_calls / json_mode docs. ~6-19s avg, schema-by-prompt rather
 *     than server-enforced.
 *   Dispatch via isV4Family(model) at call sites.
 */

import OpenAI from 'openai';
import type {
  ProductInputs,
  StrategySummary,
  PageLocale,
  ToneKey,
  ModuleType,
  NarrativeVariant,
} from './types';
import type { ExtractedContext } from './extract';
import { LLMRequiredError, LLMCallError } from './errors';
import {
  STRATEGY_SYSTEM,
  MODULE_SYSTEM,
  MODULE_SCHEMAS,
  LLM_MODULE_TYPES,
  extractJsonObject,
  variantHintForModule,
  type ClaudeModuleContent,
} from './llm-claude';
// llm-config import removed in v2 — model now flows via parameters.

export function hasDeepseekKey(): boolean {
  // eslint-disable-next-line dot-notation
  return !!process.env['DEEPSEEK_API_KEY'];
}

// Model comes from the admin-configurable llm-config at runtime; the
// default lives in DEFAULT_LLM_CONFIG (currently deepseek-v4-pro).
//
// deepseek-reasoner (R1) is NOT supported by this adapter — both strategy
// and module-regen paths use `tool_choice: { type: 'function', ... }` to
// force structured JSON, and the reasoner endpoint returns 400 "does not
// support this tool_choice". The dropdown in /admin/llm used to list it;
// the option was removed in 2026-04 (see llm-config.ts MODEL_OPTIONS
// note) after a user hit the exact failure mode above. We keep a runtime
// coerce here so any config that was saved BEFORE the dropdown change
// (or typed into the 自定义 field) still produces a working call instead
// of a hard 400. Coercing to chat is safe because both models share the
// same prompt format; reasoner's only advantage (thinking traces) isn't
// exposed through the tool-call path anyway.
const MAX_TOKENS = 4096;
const BASE_URL = 'https://api.deepseek.com/v1';
/**
 * Models the adapter knows are incompatible with its tool_choice flow.
 *
 * Pattern (not exact-match Set): the reasoner family includes `deepseek-
 * reasoner`, `deepseek-r1`, future `deepseek-r2`, `deepseek-reasoner-pro`
 * etc. They all reject `tool_choice: {type: 'function', ...}` with
 * `400 ... does not support this tool_choice`. Match the whole family
 * case-insensitively so admin can't slip one in via the 自定义 field
 * by typing a non-canonical alias. Coercion to the current default
 * (DEFAULT_LLM_CONFIG.providers.deepseek.model — currently deepseek-v4-pro)
 * is safe because all chat-family models share the same prompt → JSON
 * contract on the happy path.
 */
// Broader pattern: anything whose model starts `deepseek-r…` / `deepseek-reasoner…`
// gets coerced to the safe default. Plus we catch standalone "reasoner" /
// "r1" / "r2" tokens. Intentionally over-eager: false positives only cost
// a coercion to deepseek-v4-pro (which works fine), false negatives cost a
// 502 in the user's face.
const REASONER_FAMILY_RE = /^deepseek-(reasoner|r\d+|r-)/i;

export function isReasonerFamily(model: string): boolean {
  if (!model) return false;
  return REASONER_FAMILY_RE.test(model.trim());
}

/**
 * Final-line-of-defense sanitizer. Even if resolveModel() somehow let a
 * reasoner-family alias through (KV race, future model name we haven't
 * predicted, admin typo into 自定义 field), this function intercepts the
 * model string at the very last step before sending to DeepSeek's API.
 *
 * Pattern: defense in depth. resolveModel coerces. The runtime catch retries.
 * This belt prevents the request from ever leaving with a known-bad model.
 */
function safeModelOrDefault(model: string, callsite: string): string {
  if (isReasonerFamily(model)) {
    const safe = HARDCODED_DEEPSEEK_DEFAULT;
    console.warn(
      `[deepseek] safeModelOrDefault: ${callsite} attempted to send "${model}" — coerced to "${safe}". ` +
        `This is the last defense; resolveModel() should have caught this. Update /admin/llm to silence.`,
    );
    return safe;
  }
  return model;
}

const HARDCODED_DEEPSEEK_DEFAULT = 'deepseek-chat';

/**
 * Hardcoded universal-fallback model for the runtime catch path. Used when
 * the configured model AND the in-code default both fail at runtime — at
 * which point we don't trust either, so we drop to the proven-to-work V3
 * chat model.
 *
 * Why a separate constant rather than reusing `DEFAULT_LLM_CONFIG.providers.
 * deepseek.model`: future deploys may ship a new default that ALSO has
 * tool_choice issues (ask the V4-Pro deployment from 2026-04 how that
 * went). When that happens, the runtime catch needs an escape hatch that
 * doesn't depend on what someone made the default this week.
 */
const RUNTIME_FALLBACK_MODEL = 'deepseek-chat';

async function resolveModel(modelOverride?: string): Promise<string> {
  const configured = modelOverride && modelOverride.trim()
    ? modelOverride.trim()
    : HARDCODED_DEEPSEEK_DEFAULT;
  if (isReasonerFamily(configured)) {
    console.warn(
      `[deepseek] configured model "${configured}" doesn't support tool_choice — ` +
      `falling back to ${HARDCODED_DEEPSEEK_DEFAULT}. ` +
      `Update /admin/llm to silence this warning.`,
    );
    return HARDCODED_DEEPSEEK_DEFAULT;
  }
  return configured;
}

/**
 * DeepSeek's API reply for unsupported tool_choice. Match by message body
 * so we catch any future reasoner-family alias that slips through
 * resolveModel — belt-and-suspenders for the admin who pastes raw names
 * into the 自定义 field. Returns true if the error is the specific
 * tool_choice-not-supported case, regardless of which model name DeepSeek
 * canonicalized to in its error reply.
 */
export function isToolChoiceUnsupportedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: number }).status;
  if (status !== 400) return false;
  const msg = String(
    (err as { message?: string }).message ??
      (err as { error?: { message?: string } }).error?.message ??
      '',
  );
  return /does not support this tool_choice/i.test(msg);
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

/**
 * V4 family detector. Used to switch strategy + module-regen calls onto
 * the response_format=json_object path, since V4 rejects the
 * `tool_choice: { type: 'function', name: ... }` we use for V3.
 *
 * History: pre-2026-05 the adapter sent the same tool_choice payload to
 * V4 and let DeepSeek 400 → runtime catch swap to V3. Net effect: admin
 * picks V4 in the dropdown but actually receives V3 output (with a
 * wasted ~1s round-trip on top). 2026-05 probe confirmed V4 supports
 * `response_format=json_object` per DeepSeek's official tool_calls /
 * json_mode docs (their example uses `model="deepseek-v4-pro"`), 15/15
 * rounds returned schema-valid JSON. So we route V4 through json mode
 * and admin gets actual V4 output when they ask for it.
 *
 * Trade-off: V4-pro avg latency ~18s vs V3 ~3s (5-6× slower). V4-flash
 * ~5.7s (1.8× slower). Default chain stays V3-first; V4 is opt-in via
 * /admin/llm.
 *
 * NOT a reasoner family — they're disjoint. isReasonerFamily catches
 * `deepseek-r*` (reasoner / r1 / r2 etc.) and coerces to chat;
 * isV4Family catches `deepseek-v4-*` and switches the call protocol.
 */
export function isV4Family(model: string): boolean {
  if (!model) return false;
  return /^deepseek-v4/i.test(model.trim());
}

/**
 * Strategy path via response_format=json_object (V4 mode).
 *
 * DeepSeek's json_object mode requires:
 *   1. The system or user prompt MUST contain the literal word "json"
 *      (their server-side guard rejects requests otherwise — yes, really).
 *   2. The prompt should describe / show the desired JSON shape so the
 *      model knows what to emit.
 *
 * We satisfy both by appending a compact schema description to the
 * system prompt. The user prompt suffix also re-states "Return as a
 * json object" to satisfy the keyword check belt-and-suspenders.
 */
async function callStrategyV4JsonMode(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<StrategySummary> {
  const jsonSuffix = `

OUTPUT FORMAT — V4 json mode:
You MUST respond with a single valid json object with exactly these keys (no markdown fences, no commentary, no surrounding text):
{
  "audience": ["string", "string", "..."],
  "goal": ["string", "string", "..."],
  "narrative": ["string", "string", "..."],
  "local": ["string", "string", "..."]
}
Each array contains 3-5 short declarative strings in the target locale.`;
  const response = await client.chat.completions.create({
    model: safeModelOrDefault(model, 'strategy:v4-json'),
    max_tokens: MAX_TOKENS,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt + jsonSuffix },
      {
        role: 'user',
        content:
          userPrompt +
          '\n\nReturn the strategy as a json object matching the schema in the system prompt.',
      },
    ],
  });
  const choice = response.choices[0];
  const text = choice?.message?.content;
  if (!text || typeof text !== 'string' || text.trim() === '') {
    // DeepSeek doc warns "API 有概率返回空 content" for json_object mode.
    // Probe was 0/15 empty across V4 pro+flash — but in case it happens,
    // throw LLMCallError so the upper retry loop tries once more, and
    // fallback chain catches the rest.
    throw new LLMCallError(
      'deepseek',
      'strategy',
      undefined,
      `V4 json mode returned empty content. finish_reason=${choice?.finish_reason ?? 'unknown'}`,
    );
  }
  const parsed = extractJsonObject<StrategySummary>(text);
  if (
    !parsed ||
    !Array.isArray(parsed.audience) ||
    !Array.isArray(parsed.goal) ||
    !Array.isArray(parsed.narrative) ||
    !Array.isArray(parsed.local)
  ) {
    throw new LLMCallError(
      'deepseek',
      'strategy',
      undefined,
      `V4 json mode parse failed (model=${model}). Raw (first 400): ${text.slice(0, 400)}`,
    );
  }
  return parsed;
}

/**
 * Module regen path via response_format=json_object (V4 mode).
 * Same json_mode contract as strategy — schema embedded in system,
 * keyword "json" present in both system and user prompts.
 */
async function callModuleV4JsonMode(
  client: OpenAI,
  model: string,
  type: ModuleType,
  systemPrompt: string,
  userPrompt: string,
): Promise<Partial<ClaudeModuleContent>> {
  const schema = MODULE_SCHEMAS[type];
  const jsonSuffix = `

OUTPUT FORMAT — V4 json mode:
You MUST respond with a single valid json object matching this schema (no markdown fences, no commentary):
${JSON.stringify(schema, null, 2)}`;
  const response = await client.chat.completions.create({
    model: safeModelOrDefault(model, `module-regen:${type}:v4-json`),
    max_tokens: MAX_TOKENS,
    temperature: 0.5,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt + jsonSuffix },
      {
        role: 'user',
        content:
          userPrompt +
          `\n\nReturn the ${type} content as a json object matching the schema in the system prompt.`,
      },
    ],
  });
  const choice = response.choices[0];
  const text = choice?.message?.content;
  if (!text || typeof text !== 'string' || text.trim() === '') {
    throw new LLMCallError(
      'deepseek',
      'module-regen',
      undefined,
      `V4 json mode returned empty content for ${type}. finish_reason=${choice?.finish_reason ?? 'unknown'}`,
    );
  }
  const parsed = extractJsonObject<Partial<ClaudeModuleContent>>(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new LLMCallError(
      'deepseek',
      'module-regen',
      undefined,
      `V4 json mode parse failed for ${type} (model=${model}). Raw (first 300): ${text.slice(0, 300)}`,
    );
  }
  return parsed;
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
  modelOverride?: string,
  // Audit Wave 2 #D: optional callback so callers (provider layer) can
  // surface the *actual* model used after any silent runtime swaps
  // (V4 → V3 fallback on tool_choice rejection, etc.). Without this, the
  // trace shown to admins was the REQUESTED model, masking swaps.
  onModelUsed?: (model: string) => void,
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

  let model = await resolveModel(modelOverride);
  const callApi = (m: string) =>
    client.chat.completions.create({
      model: safeModelOrDefault(m, 'strategy'),
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

  // Audit Wave 2 #J: extracted into inner attempt() to mirror module-regen's
  // retry pattern. Old code was single-pass — DeepSeek returning 502/503
  // once jumped straight to the fallback chain (Claude), wasting transient
  // retry potential.
  const attempt = async (): Promise<StrategySummary> => {
    // 2026-05 V4 path — V4 family rejects tool_choice but supports
    // response_format=json_object. Route here directly so admin's V4
    // selection actually produces V4 output (pre-2026-05 the tool_choice
    // call would 400 → runtime catch silently downgraded to V3).
    if (isV4Family(model)) {
      return await callStrategyV4JsonMode(client, model, STRATEGY_SYSTEM, userPrompt);
    }

    let response;
    try {
      response = await callApi(model);
    } catch (e) {
      // Belt-and-suspenders: even if resolveModel didn't catch a model
      // that rejects tool_choice, DeepSeek itself tells us via the 400.
      // Retry once with the hardcoded RUNTIME_FALLBACK_MODEL (deepseek-chat,
      // V3) — proven-working baseline that ignores whatever broken default
      // happens to be configured this week.
      if (isToolChoiceUnsupportedError(e) && model !== RUNTIME_FALLBACK_MODEL) {
        console.warn(
          `[deepseek] strategy: model "${model}" rejected tool_choice at runtime — retrying once with ${RUNTIME_FALLBACK_MODEL}.`,
        );
        model = RUNTIME_FALLBACK_MODEL;
        response = await callApi(model);
      } else {
        throw e;
      }
    }

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
  };

  // Audit Wave 2 #J: same retry policy as module-regen below. 429 + 5xx
  // are transient; 4xx is the prompt's fault. LLMCallError / LLMRequiredError
  // are our own — don't retry, they're deterministic.
  const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
  const MAX_ATTEMPTS = 2;
  let lastErr: unknown = undefined;
  for (let tryN = 1; tryN <= MAX_ATTEMPTS; tryN++) {
    try {
      const result = await attempt();
      // Audit Wave 2 #D: report the actually-used model. `model` may have
      // been swapped to RUNTIME_FALLBACK_MODEL inside attempt() if the
      // configured model rejected tool_choice at runtime.
      onModelUsed?.(model);
      return result;
    } catch (e: any) {
      lastErr = e;
      if (e instanceof LLMCallError || e instanceof LLMRequiredError) break;
      const status: number | undefined = e?.status;
      const isRetryable = !status || RETRYABLE_STATUSES.has(status);
      if (tryN === MAX_ATTEMPTS || !isRetryable) break;
      const delay = 400 + Math.random() * 300;
      console.warn(
        `[deepseek] strategy attempt ${tryN} failed (status=${status ?? 'network'}); retrying in ${delay.toFixed(0)}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  if (lastErr instanceof LLMCallError || lastErr instanceof LLMRequiredError) throw lastErr;
  console.error(
    `[deepseek] strategy generation failed after ${MAX_ATTEMPTS} attempts:`,
    (lastErr as any)?.status ?? '',
    (lastErr as any)?.message ?? lastErr,
  );
  throw new LLMCallError('deepseek', 'strategy', lastErr);
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
  variant?: NarrativeVariant,
  modelOverride?: string,
  // Audit Wave 2 #D: see comment on generateStrategyViaDeepseek.
  onModelUsed?: (model: string) => void,
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

  // Variant hint — shared helper with llm-claude.ts so A/B framing is
  // identical regardless of provider routing. See variantHintForModule doc.
  const variantHint = variant ? variantHintForModule(type, variant, locale) : null;

  const toolName = MODULE_TOOL_NAMES[type];
  const userPrompt = [
    productLines,
    '',
    strategyLines,
    ...(variantHint ? ['', variantHint] : []),
    '',
    `Rewrite the ${type.toUpperCase()} module. Call the ${toolName} tool with the content in ${locale}. Tone: ${tone}.`,
  ].join('\n');

  let model = await resolveModel(modelOverride);
  async function attempt(): Promise<Partial<ClaudeModuleContent> | null> {
    // 2026-05 V4 path — see callStrategyV4JsonMode for the full rationale.
    // Same dispatch: V4 family routes through json_object mode; V3 stays
    // on tool_choice. Variant hint is already in userPrompt.
    if (isV4Family(model)) {
      return await callModuleV4JsonMode(client, model, type, MODULE_SYSTEM, userPrompt);
    }

    let response;
    try {
      response = await client.chat.completions.create({
        model: safeModelOrDefault(model, `module-regen:${type}`),
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
    } catch (e) {
      // Belt-and-suspenders for the same case as the strategy path: if
      // DeepSeek itself rejects the model's tool_choice support at runtime,
      // bring the model to RUNTIME_FALLBACK_MODEL (V3 chat, proven-working)
      // for the rest of this call (and for the retry-loop's next iteration)
      // and try again immediately.
      if (isToolChoiceUnsupportedError(e) && model !== RUNTIME_FALLBACK_MODEL) {
        console.warn(
          `[deepseek] module ${type}: model "${model}" rejected tool_choice at runtime — retrying once with ${RUNTIME_FALLBACK_MODEL}.`,
        );
        model = RUNTIME_FALLBACK_MODEL;
        response = await client.chat.completions.create({
          model: safeModelOrDefault(model, `module-regen:${type}:retry`),
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
      } else {
        throw e;
      }
    }

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
      const result = await attempt();
      // Audit Wave 2 #D: report the actually-used model (may have been
      // swapped to RUNTIME_FALLBACK_MODEL inside attempt()).
      onModelUsed?.(model);
      return result;
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

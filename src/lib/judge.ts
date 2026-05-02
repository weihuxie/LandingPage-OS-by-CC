/**
 * Judge agent · orchestration (Phase 1b).
 *
 * Top-level: evaluatePageWithJudge(input) → JudgeReport.
 *
 * Responsibilities:
 *   1. Pick a cross-family judge provider (athlete-referee separation)
 *   2. Build the system + user prompts
 *   3. Call the judge LLM via tool-use API (single shot, no retry —
 *      judge is advisory, not blocking; if it fails, route returns
 *      the error and the UI shows "评估暂时不可用")
 *   4. Run validateJudgeSuggestions against the raw output
 *   5. Wrap into a JudgeReport with provenance metadata
 *
 * Phase 1 omissions (intentional, expanding in later phases):
 *   - No content-hash cache. Each call re-runs (cheap to do; admin
 *     can add cache later if traffic warrants)
 *   - No KV persistence. JudgeReport is computed and returned, not
 *     stored; user actions (accept/reject) get persisted in Phase 4
 *   - No retry on transient errors. Judge call fails → return error.
 *     Generator already has retries; double-retrying is wasteful.
 *   - No OpenAI judge adapter. Phase 1 supports Claude and DeepSeek
 *     (the two strategy/copy adapters). Adding OpenAI later is
 *     an independent file in the same shape.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { LLMCallError, LLMRequiredError } from './errors';
import {
  buildJudgeSystemPrompt,
  buildJudgeUserPrompt,
  JUDGE_TOOL_NAME,
  JUDGE_TOOL_SCHEMA,
} from './judge-prompt';
import {
  validateJudgeSuggestions,
  type ValidationDrop,
} from './judge-validators';
import {
  JUDGE_RULE_IDS,
  type JudgeInput,
  type JudgeReport,
  type JudgeRuleId,
  type JudgeSuggestion,
} from './judge-types';
import { hasClaudeKey } from './llm-claude';
import { hasDeepseekKey } from './llm-deepseek';
import { policyFor, readLLMConfig, type LLMProvider } from './llm-config';

/**
 * Choose a cross-family judge provider.
 *
 * Rule:
 *   1. If generator known + cross-family adapter has key → use cross
 *   2. If generator known + only same-family has key → use same family,
 *      set sameFamilyWarning=true (UI will show red caveat)
 *   3. If generator unknown → look up the locale's normal copy provider
 *      from admin config and pick its cross-family if possible
 *
 * Phase 1: Claude and DeepSeek are the only judge candidates (the two
 * with strategy/copy adapter parity). OpenAI is excluded — adding it
 * later is a one-file extension.
 */
export interface JudgeProviderChoice {
  provider: LLMProvider;
  model: string;
  sameFamilyWarning: boolean;
}

/**
 * Pick the model for a given provider by walking the copy chain. If the
 * provider doesn't appear in the chain (rare — admin removed it),
 * fall back to a hardcoded sensible default.
 */
function modelForProvider(
  cfg: Awaited<ReturnType<typeof readLLMConfig>>,
  provider: LLMProvider,
): string {
  for (const scenario of ['copy', 'strategy'] as const) {
    const step = cfg.scenarios[scenario].chain.find((s) => s.provider === provider);
    if (step) return step.model;
  }
  // Last resort — known-good defaults that exist as of 2026-04.
  if (provider === 'claude') return 'claude-opus-4-20250514';
  if (provider === 'deepseek') return 'deepseek-chat';
  if (provider === 'openai') return 'gpt-4o';
  return 'gemini-3.0-pro';
}

/**
 * Walk the admin-configured judge chain and return the first step whose
 * provider has both (a) a configured API key, AND (b) a judge adapter
 * implementation in this file. Phase 1 implements claude + deepseek;
 * openai/gemini chain entries are silently skipped (admin can put them
 * for forward-compat without breakage).
 *
 * sameFamilyWarning is computed against the actual page generator,
 * regardless of admin choice — admin may override the routing but the
 * UI still flags loss of independence.
 */
export async function pickJudgeProvider(
  generatorProvider: LLMProvider | undefined,
  locale: string,
): Promise<JudgeProviderChoice> {
  const cfg = await readLLMConfig();
  const judgePolicy = policyFor(cfg, 'judge', locale);
  const claudeOk = hasClaudeKey();
  const deepseekOk = hasDeepseekKey();

  if (!judgePolicy.enabled) {
    throw new LLMRequiredError('module-regen', 'any-llm', 'Judge scenario is disabled in /admin/llm');
  }
  if (!claudeOk && !deepseekOk) {
    // No judge-capable key configured. Even if admin chained openai/gemini,
    // those have no judge adapter in Phase 1.
    throw new LLMRequiredError('module-regen', 'any-llm', 'Judge requires ANTHROPIC_API_KEY or DEEPSEEK_API_KEY');
  }

  // Resolve generator (informational + sameFamilyWarning calc).
  let actualGenerator = generatorProvider;
  if (!actualGenerator) {
    const copyPolicy = policyFor(cfg, 'copy', locale);
    actualGenerator = copyPolicy.chain[0]?.provider;
  }

  // Walk the configured judge chain top-down, skip steps whose provider
  // (a) lacks a key, or (b) doesn't have a judge adapter in this file.
  for (const step of judgePolicy.chain) {
    const supportable =
      (step.provider === 'claude' && claudeOk) ||
      (step.provider === 'deepseek' && deepseekOk);
    if (!supportable) continue;
    return {
      provider: step.provider,
      model: step.model,
      sameFamilyWarning: !!actualGenerator && step.provider === actualGenerator,
    };
  }

  // Admin chain unusable end-to-end (e.g. all entries are openai/gemini
  // without adapter). Fall back to ANY usable adapter, marking same-family
  // if it matches the generator.
  if (claudeOk) {
    return {
      provider: 'claude',
      model: modelForProvider(cfg, 'claude'),
      sameFamilyWarning: actualGenerator === 'claude',
    };
  }
  return {
    provider: 'deepseek',
    model: modelForProvider(cfg, 'deepseek'),
    sameFamilyWarning: actualGenerator === 'deepseek',
  };
}

/**
 * Compute a hash of the page modules for cache invalidation. Phase 1
 * doesn't cache, but the report still carries the hash so future
 * caching can plug in without schema changes.
 *
 * Cheap insertion-order JSON serialization is fine — modules go
 * through a stable shape from the editor.
 */
function hashContent(modules: JudgeInput['pageModules']): string {
  const json = JSON.stringify(modules);
  // FNV-1a 32-bit (cheap, no dep). Not for security, just bucket id.
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// --- Provider-specific call helpers --------------------------------------
//
// Each calls the underlying SDK with the same prompt + tool schema, then
// extracts the tool_use input. Returns the raw suggestions array (NOT
// validated yet — the orchestrator runs validateJudgeSuggestions).

// Bug fix: SDK default timeout is 10 min — far longer than the route's
// maxDuration=60s. Without an explicit AbortSignal the user just sees
// an infinite spinner. 50s leaves 10s margin under maxDuration so we
// throw a useful error before Vercel kills the function.
const JUDGE_SDK_TIMEOUT_MS = 50_000;

// Lowered from 4096 to 2048: judge output is ≤8 suggestions × ~150
// tokens each + rulesChecked ≈ 1500 tokens. 4096 was over-allocated
// and slowed completion — Claude tries to fill the budget.
const JUDGE_MAX_TOKENS = 2048;

async function callClaudeJudge(
  systemPrompt: string,
  userPrompt: string,
  model: string,
): Promise<{ suggestions: unknown[]; rulesChecked: unknown[] }> {
  const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']! });
  const t0 = Date.now();
  console.warn(`[judge] claude call start (model=${model}, system=${systemPrompt.length}ch, user=${userPrompt.length}ch, max_tokens=${JUDGE_MAX_TOKENS})`);
  let response;
  try {
    response = await client.messages.create(
      {
        model,
        max_tokens: JUDGE_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        tools: [
          {
            name: JUDGE_TOOL_NAME,
            description: 'Emit independent-reader judgment of the landing page',
            input_schema: JUDGE_TOOL_SCHEMA as Anthropic.Tool['input_schema'],
          },
        ],
        tool_choice: { type: 'tool', name: JUDGE_TOOL_NAME },
      },
      { timeout: JUDGE_SDK_TIMEOUT_MS },
    );
  } catch (e) {
    const dt = Date.now() - t0;
    console.error(`[judge] claude FAILED after ${dt}ms:`, e instanceof Error ? e.message : e);
    throw e;
  }
  const dt = Date.now() - t0;
  console.warn(`[judge] claude call done in ${dt}ms (stop_reason=${response.stop_reason})`);
  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new LLMCallError('claude', 'module-regen', undefined, `Judge: Claude returned no tool_use block (stop=${response.stop_reason}, content blocks=${response.content.map((b) => b.type).join(',')})`);
  }
  const input = toolUse.input as { suggestions?: unknown[]; rulesChecked?: unknown[] };
  return {
    suggestions: Array.isArray(input.suggestions) ? input.suggestions : [],
    rulesChecked: Array.isArray(input.rulesChecked) ? input.rulesChecked : [],
  };
}

async function callDeepseekJudge(
  systemPrompt: string,
  userPrompt: string,
  model: string,
): Promise<{ suggestions: unknown[]; rulesChecked: unknown[] }> {
  const client = new OpenAI({
    apiKey: process.env['DEEPSEEK_API_KEY']!,
    baseURL: 'https://api.deepseek.com',
    timeout: JUDGE_SDK_TIMEOUT_MS,
  });
  const t0 = Date.now();
  console.warn(`[judge] deepseek call start (model=${model}, system=${systemPrompt.length}ch, user=${userPrompt.length}ch, max_tokens=${JUDGE_MAX_TOKENS})`);
  let resp;
  try {
    resp = await client.chat.completions.create({
      model,
      max_tokens: JUDGE_MAX_TOKENS,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: JUDGE_TOOL_NAME,
            description: 'Emit independent-reader judgment of the landing page',
            parameters: JUDGE_TOOL_SCHEMA,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: JUDGE_TOOL_NAME } },
    });
  } catch (e) {
    const dt = Date.now() - t0;
    console.error(`[judge] deepseek FAILED after ${dt}ms:`, e instanceof Error ? e.message : e);
    throw e;
  }
  const dt = Date.now() - t0;
  console.warn(`[judge] deepseek call done in ${dt}ms (finish=${resp.choices[0]?.finish_reason})`);
  const toolCall = resp.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== 'function') {
    throw new LLMCallError('deepseek', 'module-regen', undefined, `Judge: DeepSeek returned no tool_call (finish=${resp.choices[0]?.finish_reason})`);
  }
  const parsed = JSON.parse(toolCall.function.arguments) as { suggestions?: unknown[]; rulesChecked?: unknown[] };
  return {
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    rulesChecked: Array.isArray(parsed.rulesChecked) ? parsed.rulesChecked : [],
  };
}

/**
 * Public entry. Picks judge provider, calls LLM, validates output,
 * returns a JudgeReport.
 *
 * Throws LLMRequiredError when no judge-capable key is configured.
 * Throws LLMCallError on adapter failure (network / 5xx / parse).
 * Caller (the route) maps these to 503 / 502 respectively.
 */
export async function evaluatePageWithJudge(input: JudgeInput): Promise<JudgeReport> {
  const tStart = Date.now();
  const choice = await pickJudgeProvider(input.generatorProvider, input.locale);
  console.warn(
    `[judge] evaluate start (page=${input.pageId}, locale=${input.locale}, modules=${input.pageModules.length}, generator=${input.generatorProvider ?? 'unknown'}, judge=${choice.provider}/${choice.model}, sameFamily=${choice.sameFamilyWarning})`,
  );

  const systemPrompt = buildJudgeSystemPrompt(input.locale);
  const userPrompt = buildJudgeUserPrompt(input.pageModules, input.inputs, input.context);

  let raw: { suggestions: unknown[]; rulesChecked: unknown[] };
  try {
    if (choice.provider === 'claude') {
      raw = await callClaudeJudge(systemPrompt, userPrompt, choice.model);
    } else {
      raw = await callDeepseekJudge(systemPrompt, userPrompt, choice.model);
    }
  } catch (e) {
    if (e instanceof LLMCallError || e instanceof LLMRequiredError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new LLMCallError(
      choice.provider === 'claude' ? 'claude' : 'deepseek',
      'module-regen',
      e,
      `Judge call failed: ${msg}`,
    );
  }

  const result = validateJudgeSuggestions(
    raw.suggestions as Array<Partial<JudgeSuggestion>>,
    input.pageModules,
    input.inputs,
    input.context,
  );

  if (result.dropped.length > 0) {
    // Log diagnostics — operations can search Vercel logs for "[judge]
    // dropped" to gauge LLM compliance with the hard constraints. Phase 4
    // can graduate this into admin telemetry.
    console.warn(
      `[judge] dropped ${result.dropped.length} suggestion(s) on locale=${input.locale}: ` +
        result.dropped.map((d) => d.reason).join(' | '),
    );
  }

  // Phase 1: trust whatever rulesChecked the LLM emitted, after filtering
  // to the closed enum. This becomes the UI's "rules I evaluated" list.
  const rulesChecked = (raw.rulesChecked as string[]).filter((r): r is JudgeRuleId =>
    JUDGE_RULE_IDS.includes(r as JudgeRuleId),
  );

  // Generator metadata: if caller passed it, use it; otherwise read the
  // copy primary from admin config (best-effort — purely informational
  // for the UI's transparency badge).
  const cfg = await readLLMConfig();
  const copyPrimary = policyFor(cfg, 'copy', input.locale).chain[0];
  const generatorProvider = input.generatorProvider ?? copyPrimary?.provider ?? 'claude';
  const generator = {
    provider: generatorProvider,
    model: copyPrimary?.model ?? modelForProvider(cfg, generatorProvider),
  };

  const totalMs = Date.now() - tStart;
  console.warn(
    `[judge] evaluate done in ${totalMs}ms (kept=${result.kept.length}, dropped=${result.dropped.length}, rulesChecked=${rulesChecked.length})`,
  );

  return {
    contentHash: hashContent(input.pageModules),
    generatedAt: Date.now(),
    judge: { provider: choice.provider, model: choice.model },
    generator,
    suggestions: result.kept,
    rulesChecked,
    sameFamilyWarning: choice.sameFamilyWarning,
  };
}

// Exported for the route handler's diagnostic logging.
export type { ValidationDrop };

/**
 * Claude adapter — real Anthropic API integration.
 *
 * Design notes:
 *
 * 1. Prompt caching is the money saver here. Every strategy call reuses the
 *    same ~2K token framework prompt. With cache_control on the system block:
 *      - first call: pays write premium (~1.25×)
 *      - every later call: 0.1× the base price on cached bytes
 *
 * 2. Bracket notation on process.env is NOT optional. Webpack DefinePlugin
 *    inlines dot-access at build time (known Vercel footgun) and we'd ship
 *    a client permanently wired to "no API key" even when one is set.
 *
 * 3. Adaptive thinking is on for strategy generation. Strategy design is
 *    worth extra thought tokens.
 *
 * 4. JSON-schema outputs keep the response parseable without prompt-level
 *    pleading. If the model refuses or the call fails, we throw a typed
 *    error (LLMRequiredError / LLMCallError from lib/errors). NO silent
 *    null-return / template fallback — that was the fig leaf that let
 *    the "regenerate on 日本語 tab returns Chinese" bug ship.
 *
 * 5. "Not my job" return null is still allowed: when the requested module
 *    type is not in CLAUDE_MODULE_TYPES (e.g. form / socialProof), we
 *    return null because those are user-authored from the asset library,
 *    not generated. That's a routing decision, not a failure. Caller is
 *    expected to branch on null for type routing, and to let errors
 *    bubble up to the route handler.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ProductInputs,
  StrategySummary,
  PageLocale,
  ToneKey,
  ModuleType,
  HeroContent,
  PainContent,
  BenefitsContent,
  SolutionContent,
  CTAContent,
  NarrativeVariant,
} from './types';
import type { ExtractedContext } from './extract';
import { LLMRequiredError, LLMCallError } from './errors';
// llm-config import removed in v2 — model now flows via parameters.

/** Module types we wire through Claude; anything else falls back to template. */
const CLAUDE_MODULE_TYPES: ReadonlySet<ModuleType> = new Set([
  'hero',
  'pain',
  'benefits',
  'solution',
  'cta',
]);

/**
 * Variant-specific instruction appended to the regenerate user prompt.
 *
 * CLAUDE.md §2.3 defines two narrative variants per page:
 *   - A (Pain-Agitate-Solve): eyebrow "THE HIDDEN COST", headline leads
 *     with a loss number.
 *   - B (Benefit-Focused): eyebrow "OUTCOME FIRST", headline leads with
 *     a gain / ROI number.
 *
 * `tintHeroForVariant` in ai.ts seeds variant-specific eyebrow/headline/
 * subhead on the TEMPLATED modules, but `hydrateModulesViaClaude` then
 * invoked Claude (or DeepSeek) ONCE per module type and applied the same
 * returned patch to both variants — Claude's single polished hero
 * overwrote the tinted fields identically on A and B, and the editor's
 * "方案 A / 方案 B" tabs rendered visually identical content. 2026-04 user
 * report.
 *
 * This hint gets appended to the user prompt at call time when
 * `variant` is passed AND type is variant-sensitive. The system prompt
 * (MODULE_SYSTEM) stays untouched so the prompt-cache prefix is
 * preserved — only the last few lines differ between A and B calls.
 *
 * Currently wired for `hero` only. Pain is A-only by design (B's module
 * order excludes pain), so variant-awareness there is moot. benefits /
 * solution / cta share copy between variants — A/B differentiation for
 * those is carried by module ORDER not copy. If future telemetry shows
 * A/B lift is low despite distinct heros, expand this to `benefits`.
 */
export function variantHintForModule(
  type: ModuleType,
  variant: NarrativeVariant,
  locale: PageLocale,
): string | null {
  if (type !== 'hero') return null;
  const eyebrowExamples: Record<PageLocale, { a: string; b: string }> = {
    'en': { a: 'THE HIDDEN COST', b: 'OUTCOME FIRST' },
    'zh-CN': { a: '隐性成本', b: '确定的结果' },
    'zh-TW': { a: '隱性成本', b: '確定的結果' },
    'ja': { a: '現状のコスト', b: '成果の約束' },
  };
  const ey = eyebrowExamples[locale] ?? eyebrowExamples.en;
  if (variant === 'A') {
    return [
      'Variant: A (Pain-Agitate-Solve).',
      'LEAD WITH COST. Headline must quantify what the visitor is LOSING by NOT solving the problem — hours wasted, revenue leaked, errors missed, time-to-market stretched. Prefer a concrete loss number; avoid the word "solution" in the headline.',
      `Eyebrow should signal "hidden cost" in the target locale. Example for ${locale}: "${ey.a}". NOT a generic category label.`,
      'Subhead: one sentence bridging from the cost back to what the product returns (timeframe + scope).',
    ].join(' ');
  }
  return [
    'Variant: B (Benefit-Focused).',
    'LEAD WITH OUTCOME. Headline must quantify the GAIN from the solution — ROI multiplier, hours saved, speed-up factor, percentage improvement. Concrete and dated ("by week one" / "in 30 days") beats vague ("faster", "better").',
    `Eyebrow should signal "outcome first" in the target locale. Example for ${locale}: "${ey.b}". NOT a generic category label.`,
    'Subhead: one sentence naming who the product serves plus a proof point (customer count, industry scale).',
  ].join(' ');
}

export function hasClaudeKey(): boolean {
  // eslint-disable-next-line dot-notation
  return !!process.env['ANTHROPIC_API_KEY'];
}

/** Max tokens per call. Model name comes from the admin-configurable
 * llm-config at runtime (see resolveModel() below); the default is
 * defined in DEFAULT_LLM_CONFIG.providers.claude.model.
 *
 * HISTORY: we used to hardcode `const MODEL = 'claude-opus-4-20250514'`
 * here. That default now lives in llm-config.ts and can be overridden
 * via /admin/llm. The specific pin `claude-opus-4-20250514` remains the
 * code-level default because it's the one we've verified engages prompt
 * caching on the Anthropic API (diagnostic probe — see /api/llm-probe).
 * If a non-pinned alias is picked by the admin and caching doesn't work
 * as expected, the adapter still functions but the cost goes up.
 */
const MAX_TOKENS = 4096;

/**
 * Resolve the model string at call time. Reads the admin config from KV
 * (or falls back to DEFAULT_LLM_CONFIG on KV failure / missing config).
 * Every call hits this — it's effectively a single KV GET. If that
 * becomes a bottleneck (it hasn't in practice) we can cache per-request
 * via React's `cache()` helper.
 */
// v2: model is per-scenario-step, passed in by the caller. The fallback
// here is hardcoded for the rare paths that call adapters directly
// without going through llm-provider (tests, ad-hoc one-shots).
const HARDCODED_CLAUDE_DEFAULT = 'claude-opus-4-20250514';

async function resolveModel(modelOverride?: string): Promise<string> {
  if (modelOverride && modelOverride.trim()) return modelOverride.trim();
  return HARDCODED_CLAUDE_DEFAULT;
}

/**
 * Robust JSON extractor. Claude is told (in the system prompt) to return
 * bare JSON, but real model behavior:
 *   - sometimes wraps in ```json ... ``` fences
 *   - occasionally prefaces with a line of prose ("Here is the JSON:")
 *   - very rarely appends a trailing summary sentence
 *
 * Silently swallowing JSON.parse failures (the previous behavior) looked
 * indistinguishable from "no API key" — the user sees templates either
 * way. This extractor handles all three cases by first trying the raw
 * text, then stripping fences, then locating the outermost balanced
 * {...} region. Returns null only when there is genuinely no JSON object
 * in the response, at which point the caller falls back to template AND
 * logs the raw text to Vercel logs so we can diagnose.
 *
 * Exported so the diagnostic probe can exercise the same code path.
 */
export function extractJsonObject<T = unknown>(text: string): T | null {
  if (!text) return null;
  // 1. direct parse
  try {
    return JSON.parse(text) as T;
  } catch {}
  // 2. strip ```json / ``` fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]) as T;
    } catch {}
  }
  // 3. outermost balanced {...} — scan for first "{" then count braces
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// --- Strategy system prompt (STABLE — this is what gets cached) --------
//
// Intentionally verbose. Prompt caching has a 1024-token minimum prefix
// on Opus/Sonnet — below that, `cache_control: ephemeral` is silently
// ignored. This block must clear the threshold to actually cache.
// The content is not padding: every paragraph encodes a real constraint
// or example that measurably improves output.
// Exported so the /api/llm-probe endpoint can verify that the production
// prompt itself is cacheable, rather than a toy test prompt.

export const STRATEGY_SYSTEM = `You are a landing-page strategist working EXCLUSIVELY from the specific materials the user provides. Your job is NOT to apply a generic SaaS B2B playbook. Your job is to extract what is specific to THIS product — its own name, its own numbers, its own customer words, its own tagline — and amplify that into four strategic sections. Generic output is the failure mode, not the default.

## The core test (apply to every line before emitting it)

Before writing any line, silently ask: "Could this exact sentence be pasted onto a different SaaS product's landing page without changing a single word?" If yes, the line is broken — rewrite it until at least one product-specific anchor appears: the product's name, its tagline's exact words, a number from the input, a named entity, a domain-specific verb, or an audience descriptor the user actually typed. If after rewriting you still cannot ground the line in user-provided signal, OMIT the line. Fewer specific lines beats more generic lines.

## The four sections (each: 3-5 short declarative strings)

1. audience — WHO shows up. Each line must reference (a) a specific role/industry/size token the user typed verbatim, or (b) a quoted pain phrase from extracted materials, or (c) an objection voiced as the buyer would voice it. If the user input said "Head of RevOps, mid-market SaaS", the output uses "Head of RevOps" verbatim — do not abstract to "operations leader" or "ops practitioner". If extracted materials list named customers, one audience line must reference them as social proof the page can lean on.

2. goal — the conversion structure. Lines cover: primary CTA (exactly one, derived from the conversion-goal input verb — NEVER invent a new CTA verb the input did not imply); optional secondary CTA strictly lower-intensity than the primary; form-field count tied to CTA friction (demo → 4-5, trial → 2-3, download → 1-2); urgency level tied to the actual traffic-source input (paid/social → high, SEO/organic search → medium, direct/referral → low) with a one-phrase justification. Do NOT invent assets the product does not have — no "ROI calculator", no "webinar", no "white paper download" unless the input mentions them.

3. narrative — the story angle. Lines cover: lead-with-pain vs lead-with-outcome (paid/social → outcome, SEO → pain, with one-line reason citing the actual traffic-source value from input); emotional hook that quotes the actual pain surface of THIS product (not the generic "teams feel overwhelmed" — name the specific situation); rational hook anchored on a number or claim from the user input or extracted materials (do NOT invent "11 hours/week" or "2× faster" or "22% boost" unless those phrases literally appear in input — if no number exists, anchor on the tagline's concrete promise instead); best proof type matching the product's stage and evidence available.

4. local — market-cultural adjustments, WRITTEN IN THE TARGET LOCALE'S LANGUAGE. 3-4 lines about business culture, NOT translation. Use the specific target-market value from input:
   - JP: trust-first, lead with 実績/導入社数/セキュリティ姿勢; restrained CTA (資料請求/無料相談/デモを見る); zero superlatives.
   - US: ROI-first, direct CTA with numbers up front; named-logo testimonials; CTA verbs Book a Demo / Start Free Trial / Get Pricing.
   - TW: governance and stability; compliance signals; 預約示範/免費試用/聯絡我們.
   - CN: efficiency and density; named enterprise customers preferred; 预约演示/免费试用/联系我们.
   - EU: privacy-first, GDPR/AI-Act aware, understated tone, explicit data-handling statement.

## Forbidden defaults — do NOT emit unless the user input contains the exact phrase

These are the SaaS-generic boilerplate lines that appear on a thousand templated landing pages. Emitting any of these means the model reached for a default instead of the actual input. Do not use them unless the user input literally contains the phrase:
- "每周节省 X 小时" / "saves N hours per week" / "reclaim N hours back" / "give back N hours"
- "ROI 计算器" / "ROI calculator" / "TCO calculator"
- "logo 墙" / "logo wall" / "trusted by [industry leaders]"
- "提升生产力 X%" / "boost productivity by X%" / "N× faster"
- "跨部门协作" / "cross-functional collaboration" / "break down silos"
- "数据驱动决策" / "data-driven decisions"
- "演示 + 免费试用" as the default CTA pair
- "中型科技公司" / "mid-market tech companies" unless industry was specified
- "收入运营主管" / "Head of RevOps" unless the role input said exactly that

If you notice yourself reaching for any phrase in this list, STOP, re-read the product input, and anchor on a product-specific token instead.

## Critical constraints

- Each line: short declarative, max ~60 chars EN / ~30 chars CJK. Long paragraph answers are a bug.
- Write audience/goal/narrative in the target locale's language (zh-CN / zh-TW / ja / en). Write local in the target locale's language. Never translate between locales — write natively in each.
- Use verbatim any customer names, metrics, pain phrases supplied in the user prompt. Do not round, do not paraphrase, do not soften.
- Never use bullet markers ("-", "•", "*", numbered prefixes). Return plain strings; the client renders bullets.
- Filler words forbidden: "transform", "unlock", "empower", "revolutionize", "game-changing", "next-generation", "best-in-class", "seamless", "leverage", "synergy", and in JP 究極の/革新的な/業界No.1/画期的な. Every line is a decision or a fact.
- Exactly one primary CTA. Match the conversion-goal input verb.
- No hedging — "consider mentioning X" is wrong. Say "Mention X" or omit.
- No meta-commentary about the task. No markdown fences. No extra JSON fields.

## Input-signal inventory (run silently before writing each section)

Before each section, answer these to yourself:
1. Product name — what is it, literally? Use it at least once.
2. Tagline — what concrete promise does it make? Quote its nouns/verbs.
3. Category — what specific category, not "SaaS"? Use the narrower term.
4. Value — what outcome did the user type? Echo its key nouns.
5. Audience descriptors — exact role/industry/size the user selected. Use verbatim.
6. Traffic source — paid/SEO/social/direct? Anchor narrative decisions on this.
7. Extracted materials — any named customers / metrics / pain quotes / features? If yes, each must appear at least once in the output.

If the inventory is thin (only name + tagline + category), the output must still be specific, but shorter. Three product-specific lines beat five generic ones.

## Common failure modes (diagnostic checklist)

- Restating the category as the audience ("这是给 SaaS 公司的"). Audience means a real human role in a real situation.
- Inventing named customers or metrics not in extracted materials.
- Using the same four-line "local" template across markets. If JP and US "local" sections look interchangeable, you did not think about culture.
- Recommending 8-field forms for a free-trial CTA. Trial friction should be minimal.
- Writing the local block in English when target locale is Japanese/Chinese/etc.
- Defaulting to "RevOps" / "operations team" / "节省时间" when the actual role/value was something else entirely.

## Output format

The structured output is emitted via tool-use; the tool schema enforces { audience: string[], goal: string[], narrative: string[], local: string[] } with 3-5 strings per array. You focus on the writing — the transport layer handles JSON validity.`;

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
 * Tool-use definition. Using Anthropic's tool-use API instead of asking
 * the model to emit raw JSON in its text response: the API validates
 * tool input against the schema server-side and guarantees valid JSON,
 * which eliminates the class of bugs where Claude emits unescaped inner
 * quotes inside CJK string values (real production failure:
 *   "强调效率和密度：突出"11小时/周"的具体数字"
 * — the inner `"11小时/周"` made JSON.parse fail). Forcing tool_choice
 * to this tool makes Claude call it on every turn.
 */
const STRATEGY_TOOL_NAME = 'emit_strategy';
const STRATEGY_TOOL = {
  name: STRATEGY_TOOL_NAME,
  description:
    'Emit the four-part strategy summary. Each array must contain 3-5 short declarative strings in the target locale.',
  input_schema: STRATEGY_SCHEMA,
};

/**
 * Produce a StrategySummary via real Claude API call.
 *
 * Throws:
 *   - LLMRequiredError('strategy', 'ANTHROPIC_API_KEY') when no key.
 *   - LLMCallError('claude', 'strategy', cause) when the SDK call fails,
 *     the response has no tool_use / text block, or the payload is
 *     malformed. Route handlers map to 502/503 via errorResponse().
 */
export async function generateStrategyViaClaude(
  inputs: ProductInputs,
  context?: ExtractedContext,
  modelOverride?: string,
): Promise<StrategySummary> {
  if (!hasClaudeKey()) {
    throw new LLMRequiredError('strategy', 'ANTHROPIC_API_KEY');
  }

  const client = new Anthropic();

  // Product section — semi-stable; repeats whenever user refines the same product
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

  // Extracted-facts section — only included if we have facts
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

  // The instruction block is deliberately restated at the END of the user
  // message (after the data) because Claude attends more strongly to the
  // trailing tokens of the user turn. The core-test framing mirrors the
  // system prompt's "could this line be pasted onto a different product"
  // check — repeating it here makes it harder for the model to slip into
  // the generic-SaaS default when the product inputs are thin.
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

  const model = await resolveModel(modelOverride);
  try {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      // Tool-use for structured output. The Anthropic API validates the
      // tool input against STRATEGY_SCHEMA server-side, so we always get
      // syntactically valid JSON back — no more quote-escaping bugs on
      // CJK output. tool_choice forces the model to call this tool on
      // every turn; there is no "regular" text response path.
      //
      // Text fallback (extractJsonObject) is retained below in case a
      // future model somehow returns a text block; in practice with
      // tool_choice set, all content comes in a tool_use block.
      system: [
        {
          type: 'text',
          text: STRATEGY_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [STRATEGY_TOOL],
      tool_choice: { type: 'tool', name: STRATEGY_TOOL_NAME },
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Preferred path: tool_use block with validated input.
    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (toolUse && toolUse.type === 'tool_use') {
      const parsed = toolUse.input as StrategySummary;
      if (
        parsed &&
        Array.isArray(parsed.audience) &&
        Array.isArray(parsed.goal) &&
        Array.isArray(parsed.narrative) &&
        Array.isArray(parsed.local)
      ) {
        return parsed;
      }
      console.error('[claude] strategy: tool_use shape mismatch. Keys:',
        Object.keys((parsed ?? {}) as object).join(','));
      // Fall through to text-block fallback below; if that also fails
      // we throw LLMCallError so the route returns 502.
    }

    // Fallback: some SDK versions / settings may still return text. Parse it.
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new LLMCallError(
        'claude',
        'strategy',
        undefined,
        `Claude returned no tool_use or text block. Content types: ${response.content.map((b) => b.type).join(',')}`,
      );
    }
    const parsed = extractJsonObject<StrategySummary>(textBlock.text);
    if (!parsed) {
      throw new LLMCallError(
        'claude',
        'strategy',
        undefined,
        `Claude text fallback was not parseable JSON. Raw (first 400): ${textBlock.text.slice(0, 400)}`,
      );
    }
    if (
      !Array.isArray(parsed.audience) ||
      !Array.isArray(parsed.goal) ||
      !Array.isArray(parsed.narrative) ||
      !Array.isArray(parsed.local)
    ) {
      throw new LLMCallError(
        'claude',
        'strategy',
        undefined,
        `Claude JSON missing required arrays. Keys: ${Object.keys(parsed as object).join(',')}`,
      );
    }
    return parsed;
  } catch (e: any) {
    // Preserve our own typed errors; wrap everything else in LLMCallError
    // so the route handler can translate to a 502 with structured body.
    if (e instanceof LLMCallError || e instanceof LLMRequiredError) throw e;
    console.error('[claude] strategy generation failed:',
      e?.status ?? '', e?.message ?? e);
    throw new LLMCallError('claude', 'strategy', e);
  }
}

// ====================================================================
// Module content regeneration
// ====================================================================
//
// Shared design with strategy:
//   - One STABLE system prompt, cache_control ephemeral → prompt caching
//     amortizes cost across every module regen within 5 min.
//   - Output constrained to per-type JSON schema.
//   - Graceful null-return on any failure; caller falls back to template.
//
// Only the 5 text-heavy modules (hero/pain/benefits/solution/cta) route
// here. Form/testimonial/socialProof/faq stay on templates — users author
// those from the asset library, not from AI.

// Must exceed the 1024-token prompt-cache threshold. The per-module
// constraints below are real (not padding) — they directly lift output
// quality and act as a style guide the model re-reads every call.
//
// Exported so alternate providers (DeepSeek etc.) can reuse the EXACT
// same prompt instead of rewriting it. If you edit this string, every
// provider picks up the change on the next deploy.
export const MODULE_SYSTEM = `You are a senior B2B SaaS landing-page copywriter. You rewrite ONE page module at a time, to production quality. You receive: a product description, a target locale, a tone key, a strategy summary (audience + goal + narrative + local adjustments), and the type of module requested. You return a JSON object matching that module's schema — nothing more, nothing less.

## Universal rules

- Write in the TARGET LOCALE'S language (zh-CN / zh-TW / ja / en). Never translate between locales — write natively in each. A US hero and a JP hero for the same product sound fundamentally different, not translated.
- Follow the TONE exactly. Tone keys map to voice:
  - professional — measured, confident, no hype. Default for enterprise B2B.
  - executive — boardroom-ready, ROI up front, minimal jargon.
  - sales — energetic, outcome-forward, direct CTA, still truthful.
  - friendly — approachable, uses "you", slightly warmer.
  - saas — modern product voice, short sentences, metric-forward.
  - japanese — restrained, trust-first, zero superlatives, no pressure language. Lead with 信頼 / 実績 / 導入企業数. Avoid "業界No.1" / "究極の" / any marketing superlative.
  - enterprise-b2b — Helios-style. Buyer is a large-enterprise procurement/finance decision-maker. Short outcome-oriented headline; no pain-agitation; no emotional hooks. Social proof is logos-plus-numbers, not narrative testimonials. Primary CTA is low-friction ("Request a Demo" / "Contact Us" / "デモを予約" / "预约演示") pointing at an external form. Zero superlatives, zero urgency language. Mention concrete enterprise signals (global offices, customer count, processing volume) when extracted materials supply them.
- REUSE VERBATIM any customer names, metrics, or pain phrases supplied in the user prompt. Do not paraphrase, do not round metrics, do not soften pain language. If the prompt says "22% of pipeline" the output says "22%", not "about a fifth".
- Use short declarative sentences. Cut every adjective that does not earn its spot.
- Avoid forbidden filler words: "revolutionary", "game-changing", "next-generation", "best-in-class", "unlock", "empower", "seamless", "leverage", "synergy", and in JP: "究極の", "革新的な", "画期的な", "業界初".
- Exactly ONE primary CTA per page; a module's CTA field must align with the strategy's primary CTA. Secondary CTAs must be lower-intensity (e.g. "Learn more" vs "Book a demo").
- Return valid JSON matching the requested module's schema. Never add fields beyond the schema. Never wrap in markdown fences.

## Module-specific constraints

### HERO
- eyebrow: 2-4 words. UPPERCASE for Latin-script locales (EN). Short phrase for CJK, not uppercase.
- headline: 1 sentence. <14 words for EN, <22 chars for CJK. Outcome-first for paid/social traffic ("Ship releases 2× faster."). Question-first for SEO traffic ("Why does your release cycle keep slipping?").
- subhead: 1-2 sentences expanding the headline with the concrete benefit. Name the change, not the category.
- primaryCta: 2-4 words. Action verb first. EN: "Book a Demo" / "Start Free Trial" / "Get Pricing". JP: "デモを見る" / "資料請求" / "無料相談". ZH-CN: "预约演示" / "免费试用" / "联系我们". ZH-TW: "預約示範" / "免費試用" / "聯絡我們".
- secondaryCta: OPTIONAL. Lower intensity ("See pricing", "Watch 2-min overview", "閱讀案例").
- bullets: exactly 3 items, each <60 chars (EN) or <24 chars (CJK). Each must name a concrete deliverable, not a vague promise. "SOC 2 Type II certified" > "Enterprise-grade security".

### PAIN
- title: names the COST, not the feeling. Correct: "Your pipeline is leaking 22% to manual handoffs." Wrong: "Team collaboration is hard."
- subtitle: 1 sentence quantifying or scoping the cost. Uses a real number where available.
- items: 3-4 pain points. Each title <30 chars (EN) or <14 chars (CJK). Each body <80 chars (EN) or <40 chars (CJK). Start from symptoms the visitor actively recognizes this week, not abstract categories.

### BENEFITS
- title: outcome-framed, never feature-framed. Correct: "Ship safer releases in half the cycle." Wrong: "Our CI/CD platform."
- items: 3-4 items. Title <40 chars (EN) or <16 chars (CJK). Body <100 chars (EN) or <40 chars (CJK). Each body must connect to a CONCRETE CAPABILITY. "Rollback in one click" > "Flexible deployment options".

### SOLUTION
- title: what the product IS, in 1 line. Category + key differentiator.
- subtitle: 1 sentence of scope — for whom, doing what.
- body: 2-3 sentences. Start with what the user gets, end with how it differs from the obvious alternative.

### CTA
- headline: 1 outcome-focused sentence. "Start shipping safer releases today." > "Join thousands of happy customers."
- subhead: 1 line that removes the LAST objection. "No credit card. 14-day trial." / "Free setup call. No commitment." / "14日間無料・カード登録不要".
- button: 2-4 words matching the strategy's primary CTA verb.
- subhead: 1 line, removes a last-mile objection (e.g. "No credit card. 14-day trial.").
- button: 2-4 words, action verb.`;

const HERO_SCHEMA = {
  type: 'object' as const,
  properties: {
    eyebrow: { type: 'string' as const },
    headline: { type: 'string' as const },
    subhead: { type: 'string' as const },
    primaryCta: { type: 'string' as const },
    secondaryCta: { type: 'string' as const },
    bullets: { type: 'array' as const, items: { type: 'string' as const } },
  },
  required: ['eyebrow', 'headline', 'subhead', 'primaryCta', 'bullets'],
  additionalProperties: false,
};

const PAIN_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' as const },
    subtitle: { type: 'string' as const },
    items: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const },
          body: { type: 'string' as const },
        },
        required: ['title', 'body'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'subtitle', 'items'],
  additionalProperties: false,
};

const BENEFITS_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' as const },
    items: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const },
          body: { type: 'string' as const },
        },
        required: ['title', 'body'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'items'],
  additionalProperties: false,
};

const SOLUTION_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' as const },
    subtitle: { type: 'string' as const },
    body: { type: 'string' as const },
  },
  required: ['title', 'subtitle', 'body'],
  additionalProperties: false,
};

const CTA_SCHEMA = {
  type: 'object' as const,
  properties: {
    headline: { type: 'string' as const },
    subhead: { type: 'string' as const },
    button: { type: 'string' as const },
  },
  required: ['headline', 'subhead', 'button'],
  additionalProperties: false,
};

export const MODULE_SCHEMAS: Record<string, object> = {
  hero: HERO_SCHEMA,
  pain: PAIN_SCHEMA,
  benefits: BENEFITS_SCHEMA,
  solution: SOLUTION_SCHEMA,
  cta: CTA_SCHEMA,
};

/** Exported so alternate providers share the exact same type gate. */
export const LLM_MODULE_TYPES: ReadonlySet<ModuleType> = CLAUDE_MODULE_TYPES;

/**
 * Per-module tool definitions. Same reasoning as STRATEGY_TOOL: we pass
 * these as tools + force tool_choice so Claude emits validated JSON via
 * tool_use instead of free-form text (which is where the CJK-quote
 * escaping bugs lived).
 */
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

export type ClaudeModuleContent =
  | HeroContent
  | PainContent
  | BenefitsContent
  | SolutionContent
  | CTAContent;

/**
 * Rewrite a module's content via Claude.
 *
 * Returns:
 *   - Partial<ClaudeModuleContent> on success; caller merges over existing.
 *   - null ONLY when the module type isn't one we handle (form / faq /
 *     testimonial etc. — user-authored from the asset library). That's a
 *     routing decision, not a failure.
 *
 * Throws:
 *   - LLMRequiredError('module-regen', 'ANTHROPIC_API_KEY') when no key.
 *   - LLMCallError('claude', 'module-regen', cause) when the SDK call
 *     fails or the payload is malformed. Silent null-return on failure
 *     used to produce Japanese templates (wrong-script copy) when the
 *     user clicked "Regenerate copy" — we don't do that anymore.
 */
export async function regenerateModuleViaClaude(
  type: ModuleType,
  inputs: ProductInputs,
  strategy: StrategySummary,
  tone: ToneKey,
  locale: PageLocale,
  variant?: NarrativeVariant,
  modelOverride?: string,
): Promise<Partial<ClaudeModuleContent> | null> {
  if (!hasClaudeKey()) {
    throw new LLMRequiredError('module-regen', 'ANTHROPIC_API_KEY');
  }
  // "Not my job" — the caller routes unsupported types to its own path.
  if (!CLAUDE_MODULE_TYPES.has(type)) return null;

  const client = new Anthropic();
  // MODULE_SCHEMAS are kept as documentation of the expected output shape
  // (see extractJsonObject usage below). They are not passed to the API
  // today because output_config is unreliable on the pinned Opus model.
  if (!MODULE_SCHEMAS[type]) return null;

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

  // Variant hint (hero only today) goes AFTER the strategy so the narrative
  // framing guides tool call output. See variantHintForModule doc.
  const variantHint = variant ? variantHintForModule(type, variant, locale) : null;

  const userPrompt = [
    productLines,
    '',
    strategyLines,
    ...(variantHint ? ['', variantHint] : []),
    '',
    `Rewrite the ${type.toUpperCase()} module. Call the ${MODULE_TOOL_NAMES[type]} tool with the content in ${locale}. Tone: ${tone}.`,
  ].join('\n');

  const toolName = MODULE_TOOL_NAMES[type];
  const tool = {
    name: toolName,
    description: MODULE_TOOL_DESCRIPTIONS[type],
    input_schema: MODULE_SCHEMAS[type] as any,
  };

  const model = await resolveModel(modelOverride);
  // Single attempt — one HTTP call + parse. Kept as a local function so
  // the retry loop below can invoke it multiple times without rebuilding
  // the (moderately expensive) system prompt / user prompt / tool spec.
  async function attempt(): Promise<Partial<ClaudeModuleContent> | null> {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      // Tool-use structured output. See STRATEGY_TOOL comment — same
      // reasoning. Prevents the "unescaped inner double quote in CJK
      // string" class of JSON.parse failures.
      system: [
        {
          type: 'text',
          text: MODULE_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [tool],
      tool_choice: { type: 'tool', name: toolName },
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Preferred path: tool_use with validated input.
    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (toolUse && toolUse.type === 'tool_use') {
      const parsed = toolUse.input as Partial<ClaudeModuleContent>;
      if (parsed && typeof parsed === 'object') return parsed;
      console.error(`[claude] module ${type}: tool_use input not an object`);
      // Fall through to text-block fallback; if that also fails we throw.
    }

    // Fallback: text block (shouldn't happen with forced tool_choice).
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new LLMCallError(
        'claude',
        'module-regen',
        undefined,
        `Module ${type}: Claude returned no tool_use or text block. Content types: ${response.content.map((b) => b.type).join(',')}`,
      );
    }
    const parsed = extractJsonObject<Partial<ClaudeModuleContent>>(textBlock.text);
    if (!parsed || typeof parsed !== 'object') {
      throw new LLMCallError(
        'claude',
        'module-regen',
        undefined,
        `Module ${type}: Claude text fallback not parseable JSON. Raw (first 300): ${textBlock.text.slice(0, 300)}`,
      );
    }
    return parsed;
  }

  // One retry on transient failures. "Transient" = network errors or
  // HTTP statuses that Anthropic documents as retryable (429 rate limit,
  // 5xx server errors). 4xx validation errors (400 bad request, 401
  // auth, 403 permission) are the prompt's fault — retrying won't help,
  // they need a code change. Before this loop was added, a single 429
  // on one of the 5 parallel hydrate calls would tank the whole
  // page-create, even though Anthropic retries usually succeed within
  // a few hundred ms.
  const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
  const MAX_ATTEMPTS = 2;
  let lastErr: unknown = undefined;
  for (let tryN = 1; tryN <= MAX_ATTEMPTS; tryN++) {
    try {
      return await attempt();
    } catch (e: any) {
      lastErr = e;
      // Our own LLMCallError from schema/parse failure — don't retry.
      // Claude produced a response, it just didn't match our tool schema;
      // retrying with the same prompt gets the same shape back.
      if (e instanceof LLMCallError || e instanceof LLMRequiredError) break;
      const status: number | undefined = e?.status;
      const isRetryable = !status /* network */ || RETRYABLE_STATUSES.has(status);
      if (tryN === MAX_ATTEMPTS || !isRetryable) break;
      const delay = 400 + Math.random() * 300; // 400-700ms jitter
      console.warn(
        `[claude] module ${type} attempt ${tryN} failed (status=${status ?? 'network'}); retrying in ${delay.toFixed(0)}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  if (lastErr instanceof LLMCallError || lastErr instanceof LLMRequiredError) throw lastErr;
  console.error(`[claude] module regen failed (${type}) after ${MAX_ATTEMPTS} attempts:`,
    (lastErr as any)?.status ?? '', (lastErr as any)?.message ?? lastErr);
  throw new LLMCallError('claude', 'module-regen', lastErr);
}

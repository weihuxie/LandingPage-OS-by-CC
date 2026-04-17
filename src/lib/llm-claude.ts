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
 *    pleading. If the model refuses, we return null and the caller falls
 *    back to the deterministic template.
 *
 * Only generate.strategy is wired so far. Module generation and localization
 * stay on templates until we see real-user output quality on strategy first.
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
} from './types';
import type { ExtractedContext } from './extract';

/** Module types we wire through Claude; anything else falls back to template. */
const CLAUDE_MODULE_TYPES: ReadonlySet<ModuleType> = new Set([
  'hero',
  'pain',
  'benefits',
  'solution',
  'cta',
]);

export function hasClaudeKey(): boolean {
  // eslint-disable-next-line dot-notation
  return !!process.env['ANTHROPIC_API_KEY'];
}

/** Model + parameters. Change in one place. */
const MODEL = 'claude-opus-4-6';
const MAX_TOKENS = 4096;

// --- Strategy system prompt (STABLE — this is what gets cached) --------
//
// Intentionally verbose. Prompt caching has a 1024-token minimum prefix
// on Opus/Sonnet — below that, `cache_control: ephemeral` is silently
// ignored. This block must clear the threshold to actually cache.
// The content is not padding: every paragraph encodes a real constraint
// or example that measurably improves output.
// Exported so the /api/llm-probe endpoint can verify that the production
// prompt itself is cacheable, rather than a toy test prompt.

export const STRATEGY_SYSTEM = `You are a senior B2B SaaS landing-page strategist. You take a set of product inputs (name, tagline, category, value proposition, target market, target locale, traffic source, conversion goal, audience descriptors) plus optional extracted facts from the customer's uploaded materials (named customers, concrete metrics, pain phrases, features, personas, summary), and you produce a four-part strategy summary that will directly drive module copywriting downstream. Treat this as strategic guidance that a copywriter will read before touching a single headline — not as marketing copy itself.

## The four sections

1. audience — diagnosis of the ideal visitor. 4-5 lines. Cover: (a) who they are — role + seniority + company size + stage; (b) buying phase — are they unaware / problem-aware / solution-aware / vendor-aware / decision-ready; (c) top concerns they are actively trying to resolve; (d) trust triggers that would move them off the fence; (e) the 2-3 objections they will voice if you do not preempt them. If extracted personas exist, use them verbatim rather than inventing new ones. If named customers exist, list them as references the page must leverage.

2. goal — the conversion goal structure. 3-4 lines. Cover: (a) primary CTA — exactly one, named by action verb (Book a Demo / Start Free Trial / Download Guide / Contact Sales / etc); (b) optional secondary CTA that is strictly lower-intensity than the primary (never two "book demo" buttons); (c) form field count recommendation based on goal — demo = 4-5 fields, trial = 2-3, download = 1-2; (d) urgency level — low/medium/high — with a one-phrase justification.

3. narrative — the story angle. 3-4 lines. Cover: (a) whether to lead with pain or with outcome. Default heuristic: SEO traffic (problem-aware visitors) leads with pain; paid/social traffic (interrupt traffic) leads with outcome. (b) the emotional hook — what does the visitor feel before they convert. (c) the rational hook — what concrete number or fact makes this undeniable. (d) the best proof type — named customer logo / short quote + metric / third-party analyst / regulatory certification.

4. local — region-specific adjustments, WRITTEN IN THE TARGET LOCALE'S LANGUAGE. 3-4 lines. These reflect business-culture differences, not translation. Market guardrails:
   - JP: trust-first, restrained CTA, never use pressure language, lead with company heritage and security posture, avoid ROI superlatives; typical CTA verbs — 資料請求 / 無料相談 / デモを見る.
   - US: ROI-first, strong direct CTA, concrete numbers up front, testimonials with named logos; CTA verbs — Book a Demo / Start Free Trial / Get Pricing.
   - TW: governance and stability, compliance signals, professional tone without pressure; 預約示範 / 免費試用 / 聯絡我們.
   - CN: efficiency and density, quick-value framing, named enterprise customers preferred; 预约演示 / 免费试用 / 联系我们.
   - EU: privacy-first, regulation-aware (GDPR, AI Act), understated tone, explicit data-handling statement; CTA verbs kept factual.

## Critical constraints

- Each line must be a SHORT declarative sentence, max ~60 chars (or ~30 CJK chars). Long paragraph-form answers are a bug.
- Write audience/goal/narrative in the TARGET LOCALE's language (zh-CN / zh-TW / ja / en). Never translate between locales — write natively in each.
- If user materials contain named customers, specific metrics, or pain phrases, USE THEM VERBATIM in the output. Do not paraphrase customer names. Do not round metrics. Do not soften pain phrases. The reason we ground the strategy on extracted facts is to prevent AI-generic output.
- Do not use bullet markers ("-", "•", "*", numbered prefixes). Return plain strings; the client renders bullets itself.
- Never include promotional filler such as "transform your business", "unlock potential", "revolutionary", "game-changing", "cutting-edge". Every line must encode a concrete decision or a concrete fact. If you find yourself typing filler, stop and ask what the copywriter actually needs to know.
- One primary CTA only. If the user's inputs suggest multiple primary CTAs, pick the strongest one and say why; do not list two.
- Do not hedge. "Consider mentioning X" is wrong. Say "Mention X" or omit the line.
- Do not output meta-commentary about the task itself.
- Do not output JSON fences or markdown formatting; the structured output is handled at the transport layer.

## Common failure modes to avoid

- Restating the product's category as the audience ("This is for SaaS companies."). Audience means real human role + context.
- Making up customer names that were not in the extracted facts.
- Using the same four-line template for every market. If local looks interchangeable across markets, you did not think about market culture.
- Recommending a form with 8 fields for a Start-Free-Trial CTA. Trial friction should be minimal.
- Writing the local block in English for a Japanese market. The field name is "local" for a reason.

## Output format

Return JSON matching the schema: { audience: string[], goal: string[], narrative: string[], local: string[] }. Every array has 3-5 short strings. No extra fields.`;

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
 * Produce a StrategySummary via real Claude API call.
 * Returns null when the key is missing or the call fails — caller falls back
 * to the deterministic template path in ai.ts.
 */
export async function generateStrategyViaClaude(
  inputs: ProductInputs,
  context?: ExtractedContext,
): Promise<StrategySummary | null> {
  if (!hasClaudeKey()) return null;

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

  const userPrompt = `${productBlock}${factsBlock}\n\nProduce the strategy summary per your framework. Remember: write audience/goal/narrative bullets in the target locale (${inputs.locale}); write local adjustments in the same locale. Use verbatim metrics and customer names from the materials above where relevant.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      // Cache the (large, stable) system prompt. First call pays write; all
      // subsequent calls within 5 minutes across any product pay ~0.1×.
      system: [
        {
          type: 'text',
          text: STRATEGY_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      // Constrain the response to the JSON schema we actually parse.
      output_config: {
        format: {
          type: 'json_schema',
          schema: STRATEGY_SCHEMA,
        },
      } as any,
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Response content is typed blocks; find the text block and parse JSON.
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return null;

    const parsed = JSON.parse(textBlock.text) as StrategySummary;
    // Basic shape validation — model could still slip through
    if (
      !Array.isArray(parsed.audience) ||
      !Array.isArray(parsed.goal) ||
      !Array.isArray(parsed.narrative) ||
      !Array.isArray(parsed.local)
    ) {
      return null;
    }
    return parsed;
  } catch (e: any) {
    // Typed errors would be nicer, but we just want to gracefully fall back
    // to the template. Log enough to diagnose in Vercel logs.
    console.error('[claude] strategy generation failed:', e?.message ?? e);
    return null;
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
const MODULE_SYSTEM = `You are a senior B2B SaaS landing-page copywriter. You rewrite ONE page module at a time, to production quality. You receive: a product description, a target locale, a tone key, a strategy summary (audience + goal + narrative + local adjustments), and the type of module requested. You return a JSON object matching that module's schema — nothing more, nothing less.

## Universal rules

- Write in the TARGET LOCALE'S language (zh-CN / zh-TW / ja / en). Never translate between locales — write natively in each. A US hero and a JP hero for the same product sound fundamentally different, not translated.
- Follow the TONE exactly. Tone keys map to voice:
  - professional — measured, confident, no hype. Default for enterprise B2B.
  - executive — boardroom-ready, ROI up front, minimal jargon.
  - sales — energetic, outcome-forward, direct CTA, still truthful.
  - friendly — approachable, uses "you", slightly warmer.
  - saas — modern product voice, short sentences, metric-forward.
  - japanese — restrained, trust-first, zero superlatives, no pressure language. Lead with 信頼 / 実績 / 導入企業数. Avoid "業界No.1" / "究極の" / any marketing superlative.
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

const MODULE_SCHEMAS: Record<string, object> = {
  hero: HERO_SCHEMA,
  pain: PAIN_SCHEMA,
  benefits: BENEFITS_SCHEMA,
  solution: SOLUTION_SCHEMA,
  cta: CTA_SCHEMA,
};

export type ClaudeModuleContent =
  | HeroContent
  | PainContent
  | BenefitsContent
  | SolutionContent
  | CTAContent;

/**
 * Returns the new content object for a module (keyed off type), or null if:
 *   - no API key
 *   - module type isn't in our Claude-routed set
 *   - the API call fails or returns malformed JSON
 *
 * Caller merges: `{ ...module, content: { ...module.content, ...returned } }`
 * so fields we don't own (layout, media, bullets length guards, etc.) are
 * preserved verbatim.
 */
export async function regenerateModuleViaClaude(
  type: ModuleType,
  inputs: ProductInputs,
  strategy: StrategySummary,
  tone: ToneKey,
  locale: PageLocale,
): Promise<Partial<ClaudeModuleContent> | null> {
  if (!hasClaudeKey()) return null;
  if (!CLAUDE_MODULE_TYPES.has(type)) return null;

  const client = new Anthropic();
  const schema = MODULE_SCHEMAS[type];
  if (!schema) return null;

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

  const userPrompt = [
    productLines,
    '',
    strategyLines,
    '',
    `Rewrite the ${type.toUpperCase()} module. Output JSON matching the ${type} schema, in ${locale}. Tone: ${tone}.`,
  ].join('\n');

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Adaptive is overkill per-module; disable for faster regens.
      system: [
        {
          type: 'text',
          text: MODULE_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema,
        },
      } as any,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return null;

    const parsed = JSON.parse(textBlock.text);
    // Minimal shape check — schema already enforces, but be defensive.
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Partial<ClaudeModuleContent>;
  } catch (e: any) {
    console.error(`[claude] module regen failed (${type}):`, e?.message ?? e);
    return null;
  }
}

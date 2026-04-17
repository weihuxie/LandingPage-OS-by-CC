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

const STRATEGY_SYSTEM = `You are a senior B2B SaaS landing-page strategist. You analyze product inputs and extracted customer materials, then produce a four-part strategy summary:

1. audience — diagnosis of the ideal visitor. 4-5 bullet-lines covering: who they are (role, company size, stage), buying phase, top concerns, trust triggers, common objections.

2. goal — the conversion goal structure. 3-4 bullet-lines covering: primary CTA, optional secondary CTA, form field count recommendation, urgency level.

3. narrative — the story angle. 3-4 bullet-lines covering: whether to lead with pain or outcome (depends on traffic source), emotional hook, rational hook, best proof type.

4. local — region-specific adjustments. 3-4 bullet-lines in the TARGET LOCALE's language. Should reflect the TARGET MARKET's business culture (JP=trust-first restrained CTA; US=ROI-first strong CTA; TW=governance/stability; CN=efficiency/density; EU=privacy/compliance).

## Critical constraints

- Each bullet-line must be a SHORT declarative sentence, max ~60 chars.
- Write audience/goal/narrative in the target locale's language (zh-CN/zh-TW/ja/en).
- If user materials contain named customers, specific metrics, or pain phrases, USE them verbatim in the strategy. Do not invent fake data.
- Do not use bullet markers (no "-" or "•"). Return plain strings; the client renders bullets.
- Never include promotional filler. Every line must give the user a concrete decision or fact.
- One primary CTA only. Flag extra CTAs as a risk if inputs suggest them.

## Output format

Return JSON matching the schema: { audience: string[], goal: string[], narrative: string[], local: string[] }.`;

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

const MODULE_SYSTEM = `You are a senior B2B SaaS landing-page copywriter. You rewrite ONE page module at a time.

Given a product, a locale, a tone, a strategy summary (audience + goal + narrative + local adjustments), and the type of module requested, produce copy that:

- Speaks in the target locale's language (zh-CN / zh-TW / ja / en). Never translate — write natively per locale.
- Follows the tone: professional / executive / sales / friendly / saas / japanese (japanese = restrained, trust-first, no superlatives).
- Reuses VERBATIM any customer names, metrics, or pain phrases supplied in the prompt. Do not invent data.
- Uses short declarative sentences. Avoid filler, superlatives, and ad-speak.
- Has exactly ONE primary CTA. Any secondary CTA must be lower-intensity.
- Returns valid JSON matching the schema for the requested module type. Do not add extra fields.

Module-specific constraints:

HERO:
- eyebrow: 2-4 words, UPPERCASE for Latin-script locales, short phrase for CJK.
- headline: 1 sentence, <14 words (EN) / <22 chars (CJK). Outcome-first for paid/social traffic; question-first for SEO traffic.
- subhead: 1-2 sentences expanding the headline. Concrete benefit.
- primaryCta: 2-4 words, action verb first.
- secondaryCta: optional, softer.
- bullets: 3 items, each <60 chars, each a concrete deliverable.

PAIN:
- title: names the cost, not the feeling. E.g. "Your pipeline is leaking 22% to manual handoffs."
- subtitle: 1 sentence that quantifies or scopes the cost.
- items: 3-4 pain points. Each title <30 chars, body <80 chars. Start from symptoms the visitor recognizes.

BENEFITS:
- title: outcome-framed, not feature-framed. "Ship safer releases in half the cycle" not "Our CI platform".
- items: 3-4 items, title <40 chars, body <100 chars. Each maps to a concrete capability, not a vague promise.

SOLUTION:
- title: what it is, in 1 line.
- subtitle: 1 sentence of scope.
- body: 2-3 sentences. Lead with what the user gets, end with how it differs.

CTA:
- headline: single sentence, outcome-focused.
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

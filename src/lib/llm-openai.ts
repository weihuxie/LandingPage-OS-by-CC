/**
 * OpenAI adapter — cross-cultural localization (PRD v5.1 §4.1).
 *
 * Purpose: when a user adds a new locale to a LandingPage, the wizard
 * currently stamps out the new-locale variants from localized templates
 * (ai.ts `L` table). That's OK for shape but generic in voice. This
 * adapter takes each module's content and rewrites it natively in the
 * target locale — NOT a translation — so JP visitors see JP-native
 * sentence flow, US visitors see concise benefit-forward copy, etc.
 *
 * Scope: only the 5 text-heavy modules (hero/pain/benefits/solution/cta).
 * Structural modules (form/socialProof/testimonial/faq/useCase) pass
 * through unchanged — their content is either user-authored (testimonials
 * from the asset library) or schema-shaped (form field names).
 *
 * Error policy (post-fig-leaf cleanup):
 *   - No key → throw LLMRequiredError. Silent "add locale without the
 *     OpenAI polish pass" used to let generic templates ship as the
 *     locale's "native" copy; that's the exact fig leaf we removed.
 *   - Call / parse failure → throw LLMCallError. The route handler maps
 *     these to 502/503 so the user sees why the add-locale button failed.
 *   - Module type not in OPENAI_MODULE_TYPES → return null. That's a
 *     structural routing decision (form / testimonial aren't localized
 *     via GPT), not a degradation.
 */

import OpenAI from 'openai';
import type {
  PageModule,
  PageLocale,
  MarketCode,
  ToneKey,
  ModuleType,
} from './types';
import { LLMRequiredError, LLMCallError } from './errors';

export function hasOpenAIKey(): boolean {
  // eslint-disable-next-line dot-notation
  return !!process.env['OPENAI_API_KEY'];
}

const MODEL = 'gpt-4o-2024-08-06';

/** Which module types get routed through GPT-4o. Others pass through. */
const OPENAI_MODULE_TYPES: ReadonlySet<ModuleType> = new Set([
  'hero',
  'pain',
  'benefits',
  'solution',
  'cta',
]);

const LOCALIZE_SYSTEM = `You are a senior B2B SaaS copywriter and cross-cultural localization lead. You receive a landing-page module's content written in one locale, and you produce the TARGET-LOCALE version.

This is NOT translation. It is NATIVE REWRITING. The goal is: if a native speaker of the target locale read the output cold, they would not be able to tell it was adapted from another locale. Every idiom, every sentence rhythm, every CTA verb must be what a local copywriter would have written from scratch.

## Target-locale native style rules

- en: direct, benefit-forward, short sentences, active voice. Metrics up front. CTA verbs: "Book a Demo" / "Start Free Trial" / "Get Pricing" / "Talk to Sales".
- zh-CN: 紧凑，信息密度高，结果导向，可以用短句加数字。避免"赋能"、"革命性"一类互联网套话。CTA 动词："预约演示" / "免费试用" / "联系我们" / "获取报价"。
- zh-TW: 專業穩健，重視治理與安全，語氣自信但不壓迫。CTA 動詞："預約示範" / "免費試用" / "聯絡我們"。
- ja: 控えめ、信頼ファースト、誇張表現を完全に回避する。実績・導入企業数・セキュリティを前面に出す。CTA 動詞："デモを見る" / "資料請求" / "無料相談"。禁止語: "究極の"、"革新的な"、"業界No.1"、"画期的な"。

## Market-specific adjustments (applied on top of locale)

- US market: lead with ROI, comfortable with strong direct CTA.
- JP market: lead with trust signals (company heritage, security, referenceable customer count), soft CTA.
- TW market: compliance and governance signals, professional tone.
- CN market: efficiency and speed, named enterprise customers preferred.
- EU market: privacy-first, GDPR/AI-Act awareness, understated tone.
- GLOBAL market: balanced universal framing, explicit about currency/timezone.

## Critical constraints

- Preserve any concrete numbers, named customer names, and regulatory certifications VERBATIM. Never translate a customer name. Never round a metric.
- Keep the same JSON shape as the input — same fields, same array lengths when possible.
- Do NOT add new fields. Do NOT add commentary. Return ONLY the JSON object.
- Match the requested tone: professional / executive / sales / friendly / saas / japanese (japanese = extra restraint).
- One primary CTA only. If the source has a primaryCta, the output's primaryCta must be semantically the same action, just in the target locale's natural phrasing.

## Output format

Return a SINGLE JSON object matching the same schema as the input content. No markdown fences, no commentary.`;

/**
 * Localize a single module's content via GPT-4o.
 *
 * Returns:
 *   - PageModule with rewritten content on success.
 *   - null ONLY when the module type isn't one we route through GPT
 *     (form, testimonial, socialProof, faq — these are user-authored
 *     from the asset library). Routing, not failure.
 *
 * Throws:
 *   - LLMRequiredError('localize-gpt', 'OPENAI_API_KEY') when no key.
 *   - LLMCallError('gpt', 'localize-gpt', cause) on empty response,
 *     malformed JSON, or SDK errors.
 */
export async function localizeModuleViaGpt(
  module: PageModule,
  toLocale: PageLocale,
  market: MarketCode,
  tone: ToneKey,
): Promise<PageModule | null> {
  if (!hasOpenAIKey()) {
    throw new LLMRequiredError('localize-gpt', 'OPENAI_API_KEY');
  }
  // "Not my job" — caller keeps the source module unchanged.
  if (!OPENAI_MODULE_TYPES.has(module.type)) return null;

  const client = new OpenAI();

  const userPrompt = [
    `Target locale: ${toLocale}`,
    `Target market: ${market}`,
    `Tone: ${tone}`,
    `Module type: ${module.type}`,
    '',
    'Source content (JSON):',
    JSON.stringify(module.content, null, 2),
    '',
    `Produce the ${toLocale} version. Return ONLY the new content JSON with the same schema.`,
  ].join('\n');

  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      messages: [
        { role: 'system', content: LOCALIZE_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    });
    const text = resp.choices[0]?.message?.content;
    if (!text) {
      throw new LLMCallError(
        'gpt',
        'localize-gpt',
        undefined,
        `GPT-4o returned empty content for ${module.type} → ${toLocale}`,
      );
    }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') {
      throw new LLMCallError(
        'gpt',
        'localize-gpt',
        undefined,
        `GPT-4o returned non-object for ${module.type} → ${toLocale}: ${text.slice(0, 200)}`,
      );
    }

    // Merge — preserve fields GPT might not have returned (media, layout,
    // bullets arrays if they came back wrong length, etc.)
    return {
      ...module,
      content: { ...(module.content as any), ...parsed },
    };
  } catch (e: any) {
    if (e instanceof LLMCallError || e instanceof LLMRequiredError) throw e;
    console.error(
      `[openai] localize failed (${module.type} → ${toLocale}):`,
      e?.message ?? e,
    );
    throw new LLMCallError('gpt', 'localize-gpt', e);
  }
}

/**
 * Parallel-localize a list of modules.
 *
 * Throws:
 *   - LLMRequiredError('localize-gpt', 'OPENAI_API_KEY') when no key.
 *     The previous silent pass-through (returning the source modules
 *     unchanged when no key was configured) is the fig leaf: it made
 *     "add Japanese locale" appear to succeed while the output was
 *     still the English/default-locale template. Now the route handler
 *     returns 503 and the UI surfaces the missing-key state.
 *   - Propagates LLMCallError from individual module calls. Promise.all
 *     short-circuits on first rejection — intentional: if one module
 *     fails we want the whole add-locale to fail loud rather than ship
 *     a half-localized page.
 */
export async function localizeModulesViaGpt(
  modules: PageModule[],
  toLocale: PageLocale,
  market: MarketCode,
  tone: ToneKey,
): Promise<PageModule[]> {
  if (!hasOpenAIKey()) {
    throw new LLMRequiredError('localize-gpt', 'OPENAI_API_KEY');
  }
  return Promise.all(
    modules.map(async (m) => {
      const localized = await localizeModuleViaGpt(m, toLocale, market, tone);
      // null = module type not routed through GPT (form / testimonial /
      // etc.); keep source unchanged. Not a degradation — those modules
      // are user-authored from the asset library.
      return localized ?? m;
    }),
  );
}

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
// llm-config import removed in v2 — model now flows via parameters.

export function hasOpenAIKey(): boolean {
  // eslint-disable-next-line dot-notation
  return !!process.env['OPENAI_API_KEY'];
}

/**
 * Optional custom base URL for OpenAI-compatible proxies.
 *
 * Set `OPENAI_BASE_URL` to route calls through a gateway that speaks the
 * OpenAI Chat Completions wire format (e.g. Kingsoft Cloud's `kspmas`,
 * Azure OpenAI compatibility shims, internal gateways). When unset, the
 * SDK defaults to `https://api.openai.com/v1`.
 *
 * Only the URL is swapped — the SDK still reads OPENAI_API_KEY, so the
 * key you set needs to be one the proxy accepts (often the proxy vendor's
 * own key, not an openai.com key).
 *
 * We read it once, lazily, because Vercel env vars are static per
 * invocation. A misspelled value surfaces as a 4xx/network error on the
 * first call — we don't pre-validate it (can't tell a good URL from a
 * bad one without hitting the wire).
 */
function getOpenAIBaseURL(): string | undefined {
  // eslint-disable-next-line dot-notation
  const raw = (process.env['OPENAI_BASE_URL'] ?? '').trim();
  return raw.length > 0 ? raw : undefined;
}

/**
 * Build an OpenAI client with the configured key + optional custom base
 * URL. Kept as a helper so both `localizeModuleViaGpt` call sites (single
 * and batch) share the identical construction path.
 */
function buildOpenAIClient(): OpenAI {
  const baseURL = getOpenAIBaseURL();
  return baseURL ? new OpenAI({ baseURL }) : new OpenAI();
}

/**
 * DeepSeek's API speaks OpenAI's Chat Completions protocol verbatim.
 * The localize prompt + JSON-mode response shape transfer 1:1 — only
 * the endpoint and API key differ. So we reuse the OpenAI SDK with the
 * DeepSeek base URL when a localize step's provider is 'deepseek'.
 *
 * Why not put this in llm-deepseek.ts: keeping it co-located with
 * localizeModuleViaGpt avoids duplicating the (long) prompt template
 * and module-shape-aware parsing. DeepSeek is, for this purpose,
 * "OpenAI with a different URL".
 */
export function buildDeepseekClient(): OpenAI {
  // eslint-disable-next-line dot-notation
  const apiKey = process.env['DEEPSEEK_API_KEY'];
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY not configured (localize via deepseek)');
  }
  return new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com/v1',
  });
}

/**
 * List models the configured OpenAI endpoint reports as available.
 * Used by the admin diagnostic to show "what model IDs is the gateway
 * actually willing to serve" — important for KSP / Azure / other proxy
 * setups where the activated model list differs from openai.com.
 *
 * Throws on any HTTP failure. The admin UI surfaces the message.
 */
export async function listOpenAIModels(): Promise<{
  baseURL: string;
  models: Array<{ id: string; ownedBy?: string; created?: number }>;
}> {
  if (!hasOpenAIKey()) throw new Error('OPENAI_API_KEY not configured');
  const client = buildOpenAIClient();
  const baseURL = getOpenAIBaseURL() ?? 'https://api.openai.com/v1';
  // The SDK's models.list() pages, but for a diagnostic we only need
  // the first page (gateways rarely return >50 models, and the list
  // endpoint without `after` cursor returns the entire catalog inline).
  const page = await client.models.list();
  const out = page.data.map((m) => ({
    id: m.id,
    ownedBy: (m as any).owned_by,
    created: (m as any).created,
  }));
  return { baseURL, models: out };
}

// Model comes from the admin-configurable llm-config at runtime; default
// (gpt-4o-2024-08-06) is defined in DEFAULT_LLM_CONFIG.
const HARDCODED_OPENAI_DEFAULT = 'gpt-4o';

async function resolveModel(modelOverride?: string): Promise<string> {
  if (modelOverride && modelOverride.trim()) return modelOverride.trim();
  return HARDCODED_OPENAI_DEFAULT;
}

/**
 * Which module types get routed through GPT-4o.
 *
 * 2026-04 post-inheritance fix: this was previously a narrow 5-type allow-
 * list (hero/pain/benefits/solution/cta). That was safe for the from-
 * scratch path because hydrate produces target-locale text for those 5
 * modules and the rest (form / testimonial / faq / useCase / socialProof /
 * productShowcase / videoEmbed / logosScroll) happen to default to locale-
 * aware templates via ai.ts `L`. But the inheritance path clones the
 * SOURCE-LOCALE modules verbatim, so the skipped 5+ types stayed in source
 * language even after localize ran — user reported the "适合这些人" title
 * and "产品市场 / 获客团队 / 创业者" items still in Chinese under the English
 * tab.
 *
 * Fix: route every module type through GPT and lean on the system prompt's
 * "preserve customer names / URLs / enum keys" rules to protect the few
 * fields that shouldn't be translated (testimonial.items[].author/company,
 * form.fields[], any MediaRef URLs). Cost is ~10 GPT calls per variant
 * (was ~5) when inheriting; still parallelized, still under the 60s
 * maxDuration ceiling.
 */
const OPENAI_MODULE_TYPES: ReadonlySet<ModuleType> = new Set<ModuleType>([
  'hero',
  'pain',
  'benefits',
  'solution',
  'cta',
  'useCase',
  'faq',
  'form',
  'testimonial',
  'socialProof',
  'productShowcase',
  'videoEmbed',
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

## Per-schema field rules (applies to ANY module type we send you)

These rules override any instinct to "translate everything". If a field in the source JSON matches one of these patterns, keep it as-is in the output:

- **Proper nouns**: customer names, author names, company names — exactly as the source spelled them, even if the alphabet differs from the target locale. ("张三" stays "张三" in the English version; "Acme Corp" stays "Acme Corp" in the Chinese version.) Applies to: testimonial.items[].author, testimonial.items[].company, socialProof.logos[].name.
- **URLs / href / externalUrl / src / poster / slug**: never translated. Copy the string byte-for-byte.
- **Enum keys and IDs**: form.fields[] is an array of machine keys like "name" / "email" / "company" / "phone" / "message" / "smsCode". NEVER translate them. form.fieldSchemas[].key is the same contract.
- **Media references**: MediaRef objects (kind / url / alt). \`kind\` and \`url\` are verbatim. \`alt\` IS user-facing — translate it.
- **Layout / mode / fontScale / variant**: string enums like 'cards' | 'alternating', 'inline' | 'external', 'sm' | 'md' | 'lg' — keep as-is.

## Per-module intent (what counts as "display text")

- hero / pain / solution / cta: eyebrow, headline, subhead, body, button, primaryCta / secondaryCta labels = translate. Numbers in headlines = keep the digit, translate any unit (e.g. "120+ hours/month" in zh-CN: "120+ 小时/月").
- benefits: title, items[].title, items[].body = translate.
- useCase: title, items[].role, items[].scenario = translate. These are AUDIENCE LABELS and USE-CASE DESCRIPTIONS, not user quotes — always translate. Previous inheritance bug left "适合这些人 / 产品市场 / 获客团队" in Chinese under an English tab; do not repeat that.
- faq: title, items[].q, items[].a = translate. Preserve the same number of FAQ items.
- testimonial: title = translate. items[].quote = translate (this is NOT a legal quote; it's a landing-page social-proof string, and leaving source-locale quotes under a target-locale tab looks broken to readers). items[].author / items[].company = PRESERVE as noted above.
- form: title, subtitle, submitLabel = translate. fieldSchemas[].label / fieldSchemas[].placeholder = translate. fields[] and fieldSchemas[].key = PRESERVE (enum).
- socialProof: label / title / description fields = translate. logos[].name = PRESERVE (brand names). URL fields = PRESERVE.
- productShowcase / videoEmbed: title, caption, any alt text = translate. All URL/src/poster fields = PRESERVE.

If a field isn't user-facing text (no natural-language sentence, no audience-facing copy), default to PRESERVE. Better to leave a technical string untouched than to translate an enum and break rendering.

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
/**
 * Length-sensitive array fields per module type (Audit Wave 3 #B).
 *
 * If GPT's localized response returns a SHORTER array than the source
 * for any of these fields, we keep the source array and log a warning
 * — the shallow merge would otherwise drop the missing item silently
 * and the rendered page would show e.g. 2 bullets instead of 3.
 *
 * Why per-type: the schema names differ (hero.bullets vs benefits.items).
 * Centralizing the table in one place keeps the merge logic mechanical.
 */
const LENGTH_SENSITIVE_FIELDS: Partial<Record<ModuleType, readonly string[]>> = {
  hero: ['bullets'],
  pain: ['items'],
  benefits: ['items'],
  useCase: ['items'],
  testimonial: ['items'],
  faq: ['items'],
  form: ['fields'],
  socialProof: ['logos', 'stats'],
  productShowcase: ['items'],
};

export interface LocalizeMergeResult {
  content: Record<string, unknown>;
  /** Field names where GPT's array was shorter; source array kept. */
  preservedFields: string[];
}

/**
 * Pure merge function for localize output. Shallow-merges source +
 * parsed, but for length-sensitive arrays falls back to source if GPT's
 * version is shorter. Returns both the merged content and the list of
 * preserved fields so the caller can log the discrepancy.
 *
 * Equal length and longer (e.g. GPT split a long bullet into two) are
 * accepted — only shrinkage is treated as a loss.
 */
export function mergeLocalizedContent(
  type: ModuleType,
  source: Record<string, unknown>,
  parsed: Record<string, unknown>,
): LocalizeMergeResult {
  const fields = LENGTH_SENSITIVE_FIELDS[type] ?? [];
  const preserved: string[] = [];
  const safeParsed: Record<string, unknown> = { ...parsed };
  for (const f of fields) {
    const srcVal = source[f];
    const newVal = safeParsed[f];
    if (Array.isArray(srcVal) && Array.isArray(newVal) && newVal.length < srcVal.length) {
      // GPT shrank the array — keep source's longer version, drop the
      // shorter from the merge so the spread below preserves source.
      delete safeParsed[f];
      preserved.push(f);
    }
  }
  return {
    content: { ...source, ...safeParsed },
    preservedFields: preserved,
  };
}

export async function localizeModuleViaGpt(
  module: PageModule,
  toLocale: PageLocale,
  market: MarketCode,
  tone: ToneKey,
  modelOverride?: string,
  /** When 'deepseek', route through api.deepseek.com using
   *  DEEPSEEK_API_KEY. Same prompt, same JSON-mode parsing — DeepSeek
   *  is OpenAI-protocol-compatible so the only difference is the
   *  base URL. */
  endpoint: 'openai' | 'deepseek' = 'openai',
): Promise<PageModule | null> {
  if (endpoint === 'openai' && !hasOpenAIKey()) {
    throw new LLMRequiredError('localize-gpt', 'OPENAI_API_KEY');
  }
  // "Not my job" — caller keeps the source module unchanged.
  if (!OPENAI_MODULE_TYPES.has(module.type)) return null;

  const client = endpoint === 'deepseek' ? buildDeepseekClient() : buildOpenAIClient();

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

  const model = await resolveModel(modelOverride);
  try {
    const resp = await client.chat.completions.create({
      model,
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
    // bullets arrays if they came back wrong length, etc.).
    // Audit Wave 3 #B: also defend against GPT returning a SHORTER array
    // for length-sensitive fields (bullets / items / logos / stats /
    // fields). The shallow-merge would otherwise replace [A,B,C] with
    // [A,C] silently, losing one bullet/item from the localized page.
    const merged = mergeLocalizedContent(
      module.type,
      module.content as unknown as Record<string, unknown>,
      parsed as Record<string, unknown>,
    );
    if (merged.preservedFields.length > 0) {
      // Audit Wave 3 #B: GPT returned a shorter array for these fields.
      // We kept source's longer version. Logged but not fatal — output
      // is still locale-native (un-localized array values are placeholders
      // the user can re-translate inline if needed).
      console.warn(
        `[openai] localize ${module.type} → ${toLocale}: preserved source array(s) [${merged.preservedFields.join(', ')}] (GPT response was shorter — would have dropped item(s)).`,
      );
    }
    return {
      ...module,
      content: merged.content as unknown as PageModule['content'],
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
  modelOverride?: string,
  endpoint: 'openai' | 'deepseek' = 'openai',
): Promise<PageModule[]> {
  if (endpoint === 'openai' && !hasOpenAIKey()) {
    throw new LLMRequiredError('localize-gpt', 'OPENAI_API_KEY');
  }
  return Promise.all(
    modules.map(async (m) => {
      const localized = await localizeModuleViaGpt(m, toLocale, market, tone, modelOverride, endpoint);
      // null = module type not routed through GPT (form / testimonial /
      // etc.); keep source unchanged. Not a degradation — those modules
      // are user-authored from the asset library.
      return localized ?? m;
    }),
  );
}

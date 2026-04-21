/**
 * Gemini adapter — long document ingestion.
 *
 * Purpose: when a user pastes / uploads substantial content (> ~2K chars),
 * route it through Gemini 1.5 Pro (2M token context) to produce a richer,
 * more accurate ExtractedContext than the regex heuristics in extract.ts
 * can deliver.
 *
 * Output shape is IDENTICAL to what extractFromText() returns, so every
 * caller (strategy generation, product-page POST, projects POST) consumes
 * it without change.
 *
 * Error policy (post-fig-leaf cleanup):
 *   - No key → throw LLMRequiredError('extract', 'GEMINI_API_KEY'). The
 *     orchestrator in extract.ts catches this specifically and logs /
 *     tags the output source as "regex" so the UI can surface that
 *     Gemini wasn't consulted. Silent null-on-no-key was cheap but it
 *     meant the operator could deploy to prod without a Gemini key and
 *     never notice that long-document ingestion was degraded.
 *   - Text below GEMINI_MIN_CHARS → return null. That's intentional
 *     routing ("regex is fine for short texts"), not degradation.
 *   - API / parse failure → throw LLMCallError so the route handler
 *     reports a 502 instead of silently dropping to regex.
 */

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { ExtractedContext } from './extract';
import { LLMRequiredError, LLMCallError } from './errors';
import { readLLMConfig, DEFAULT_LLM_CONFIG } from './llm-config';

export function hasGeminiKey(): boolean {
  // eslint-disable-next-line dot-notation
  return !!process.env['GOOGLE_API_KEY'];
}

// Model comes from the admin-configurable llm-config at runtime; default
// is DEFAULT_LLM_CONFIG.providers.gemini.model (gemini-3.0-pro per the
// explicit admin decision on 2026-04). If that ID isn't served by the
// Gemini API yet, the call returns a clear error and the admin can
// switch to gemini-2.5-pro / gemini-1.5-pro-latest from /admin/llm in
// one click.
async function resolveModel(): Promise<string> {
  try {
    const cfg = await readLLMConfig();
    return cfg.providers.gemini.model || DEFAULT_LLM_CONFIG.providers.gemini.model;
  } catch {
    return DEFAULT_LLM_CONFIG.providers.gemini.model;
  }
}
// Keep the request well under the 2M-token context window even for oddly
// large paste payloads. 200K chars ≈ ~50K tokens, more than enough for
// any realistic landing-page source material.
const MAX_INPUT_CHARS = 200_000;

const EXTRACT_SYSTEM = `You extract structured marketing facts from B2B SaaS source material (websites, sales decks, whitepapers, customer interviews). You produce a JSON object with the exact shape:

{
  "namedCustomers": string[],   // company names mentioned as customers or partners, verbatim
  "metrics": string[],          // concrete numbers with units: "3.8x ROI", "11 hours/week saved", "50% faster", "$2.4M ARR", "200+ customers"
  "features": string[],         // short capability phrases, ideally from bullet lists: "real-time alerts", "unified inbox", "SOC 2 compliance"
  "pains": string[],            // verbatim sentences the source uses to describe problems the product solves, keep customer voice
  "personas": string[],         // job titles / roles mentioned: "VP of Engineering", "Head of RevOps", "产品经理", "マーケティング担当"
  "summary": string             // 1-2 sentence plain-English summary of what the product is and who it's for
}

Rules:
- Every list item must come from the source material — never invent.
- Preserve the source's exact wording. Do not translate, round, or paraphrase.
- Pain sentences should be 8-160 characters, in whatever language the source used.
- Cap each list at 10 items; pick the most specific / most quotable.
- If the source contains nothing for a bucket, return an empty array.
- summary must be neutral and factual (no marketing hype), max 280 chars.`;

const EXTRACT_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    namedCustomers: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    metrics: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    features: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    pains: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    personas: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    summary: {
      type: SchemaType.STRING,
    },
  },
  required: ['namedCustomers', 'metrics', 'features', 'pains', 'personas', 'summary'],
};

/**
 * Threshold: only route through Gemini if the text is actually long enough
 * to benefit from LLM-grade extraction. Short pastes (URL teaser blurbs,
 * quick notes) are handled fine by regex and don't justify the latency.
 */
export const GEMINI_MIN_CHARS = 1500;

export async function extractViaGemini(
  text: string,
  source: 'paste' | 'url' | 'file',
): Promise<ExtractedContext | null> {
  if (!hasGeminiKey()) {
    throw new LLMRequiredError('extract', 'GEMINI_API_KEY');
  }
  // Routing decision — short texts don't benefit from Gemini; return null
  // and the caller uses regex. Not a failure.
  if (!text || text.length < GEMINI_MIN_CHARS) return null;

  // eslint-disable-next-line dot-notation
  const genAI = new GoogleGenerativeAI(process.env['GOOGLE_API_KEY']!);
  const modelName = await resolveModel();
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: EXTRACT_SYSTEM,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: EXTRACT_SCHEMA as any,
      temperature: 0.1, // extraction task — want determinism
    },
  });

  try {
    const clipped = text.slice(0, MAX_INPUT_CHARS);
    const resp = await model.generateContent(
      `Extract structured facts from the following source material. Return JSON only.\n\n<<<SOURCE>>>\n${clipped}\n<<<END>>>`,
    );
    const raw = resp.response.text();
    const parsed = JSON.parse(raw);

    // Minimal validation — schema guards most of this, but be defensive.
    if (!parsed || typeof parsed !== 'object') {
      throw new LLMCallError(
        'gemini',
        'extract',
        undefined,
        `Gemini returned non-object for ${source}: ${raw.slice(0, 200)}`,
      );
    }

    return {
      sourceKinds: [source],
      namedCustomers: Array.isArray(parsed.namedCustomers)
        ? parsed.namedCustomers.slice(0, 10)
        : [],
      metrics: Array.isArray(parsed.metrics) ? parsed.metrics.slice(0, 10) : [],
      features: Array.isArray(parsed.features) ? parsed.features.slice(0, 10) : [],
      pains: Array.isArray(parsed.pains) ? parsed.pains.slice(0, 8) : [],
      personas: Array.isArray(parsed.personas) ? parsed.personas.slice(0, 8) : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 280) : '',
      textLength: text.length,
    };
  } catch (e: any) {
    if (e instanceof LLMCallError || e instanceof LLMRequiredError) throw e;
    console.error('[gemini] extract failed:', e?.message ?? e);
    throw new LLMCallError('gemini', 'extract', e);
  }
}

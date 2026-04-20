/**
 * Extract concrete facts from free-form user input (pastedContent, URL HTML,
 * uploaded document text). The sync regex path is always available; the
 * async path additionally tries Gemini 1.5 Pro for higher-quality pulls on
 * long documents.
 *
 * Provenance (post-fig-leaf cleanup): ExtractedContext now carries an
 * `extractor` tag so downstream code and the UI can tell whether the
 * output came from Gemini or from regex. Pre-cleanup, a silent fall-back
 * from Gemini to regex was indistinguishable in callers — users couldn't
 * tell if their pasted whitepaper got the "AI extraction" treatment or a
 * regex scrape of the same text. `extractor` makes that honest; the UI
 * can surface a badge and the operator can tell from logs whether their
 * Gemini key is actually in play.
 */

export type ExtractorEngine = 'regex' | 'gemini';

export interface ExtractedContext {
  sourceKinds: Array<'paste' | 'url' | 'file'>;

  /** Which engine produced this context. */
  extractor?: ExtractorEngine;
  /** When extractor='regex' on the async path, why Gemini was skipped. */
  extractorReason?: string;

  // Named customers / company names mentioned
  namedCustomers: string[];

  // Concrete metrics with units: "3.8x ROI", "11 hours/week", "50% faster"
  metrics: string[];

  // Feature phrases: noun phrases that look like product capabilities
  features: string[];

  // Pain phrases: sentences containing negative signal words
  pains: string[];

  // Persona mentions: VP / Director / PM / etc.
  personas: string[];

  // Short product description (first ~280 chars of clean text)
  summary?: string;

  // Raw text length, for cache keys / diagnostics
  textLength: number;
}

const EMPTY: ExtractedContext = {
  sourceKinds: [],
  namedCustomers: [],
  metrics: [],
  features: [],
  pains: [],
  personas: [],
  textLength: 0,
};

const UP_CH = /[A-Z][A-Za-z0-9]{2,}/g;
const COMMON_STOP = new Set([
  'SaaS', 'AI', 'API', 'SDK', 'CRM', 'ROI', 'UX', 'UI', 'CEO', 'CTO', 'COO',
  'CMO', 'PMM', 'PMF', 'GTM', 'KPI', 'OKR', 'SEO', 'CPL', 'CAC', 'LTV', 'MQL',
  'SQL', 'B2B', 'B2C', 'US', 'EU', 'UK', 'JP', 'CN', 'TW', 'HTML', 'CSS', 'JS',
  'North', 'South', 'East', 'West', 'Acme', // Acme is placeholder
  'Hero', 'Footer', 'Header', 'Section', 'CTA',
]);

function extractNamedCustomers(text: string): string[] {
  // Heuristic: capitalized multi-char words that appear NOT as sentence starts.
  // Skip common SaaS jargon acronyms + stop list.
  const out = new Set<string>();
  const sentences = text.split(/[.!?。！？\n]/);
  for (const s of sentences) {
    // skip first word of each sentence (often capitalized)
    const words = s.trim().split(/\s+/).slice(1);
    for (const w of words) {
      const m = w.match(/^[A-Z][A-Za-z0-9-&]{2,30}$/);
      if (m && !COMMON_STOP.has(m[0])) out.add(m[0]);
    }
  }
  // Also match 中日文的公司后缀
  const cjkMatches = text.matchAll(
    /([\u4e00-\u9fa5々]{2,10}(?:株式会社|公司|科技|集团|有限公司))/g,
  );
  for (const m of cjkMatches) out.add(m[1]);
  return [...out].slice(0, 8);
}

function extractMetrics(text: string): string[] {
  const out = new Set<string>();
  // Number + unit patterns
  const patterns = [
    /\d+(?:\.\d+)?\s?[xX×倍]\s?(?:ROI|growth|improvement|faster|quicker)?/g,
    /\d+(?:,\d{3})*(?:\.\d+)?\s?(?:hours?|hrs?|mins?|weeks?|days?|months?)\s?\/?\s?(?:week|month|day)?/gi,
    /\d+(?:\.\d+)?\s?%\s?(?:faster|lower|higher|more|less|improvement|increase|decrease|reduction)?/gi,
    /\$\s?\d+(?:,\d{3})*(?:\.\d+)?[KMB]?/g,
    /¥\s?\d+(?:,\d{3})*/g,
    /\d+\+?\s?(?:teams?|customers?|users?|companies|clients?)/gi,
    /\d+(?:\.\d+)?\s?(?:小时|時間)\s?\/?\s?(?:周|週)/g,
    /\d+(?:\.\d+)?\s?倍/g,
  ];
  for (const p of patterns) {
    const matches = text.matchAll(p);
    for (const m of matches) out.add(m[0].trim());
  }
  return [...out].slice(0, 8);
}

function extractFeatures(text: string): string[] {
  // "auto-triage", "realtime notifications", "unified inbox", etc.
  // Heuristic: short phrases near words like "feature" / "capability" / "module"
  const out = new Set<string>();
  const bulletLines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-•*·●]/.test(l) || /^\d+\./.test(l));
  for (const l of bulletLines) {
    const clean = l.replace(/^[-•*·●\d.]+\s*/, '').slice(0, 60);
    if (clean.length >= 4 && clean.length <= 60) out.add(clean);
  }
  return [...out].slice(0, 8);
}

function extractPains(text: string): string[] {
  // Sentences mentioning: "pain", "slow", "manual", "stuck", "waste",
  // "冗長", "手作業", "效率低", "丢失", "lose", "churn", etc.
  const triggers = /pain|slow|manual|stuck|waste|lose|lost|missed|broken|friction|手作業|冗長|效率|慢|丢失|漏|卡|痛/i;
  const out = new Set<string>();
  const sentences = text
    .split(/[.!?。！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 160);
  for (const s of sentences) {
    if (triggers.test(s)) out.add(s);
  }
  return [...out].slice(0, 6);
}

function extractPersonas(text: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\b(?:VP|Director|Head|Lead|Manager|Chief|President)\s+of\s+[A-Z][A-Za-z ]{2,30}/g,
    /\b(?:VP|Director)\s+[A-Z][A-Za-z ]{2,30}/g,
    /\b(?:CEO|CTO|COO|CMO|CFO|CPO|CRO|VPE|VPM)\b/g,
    /\b(?:Product\s+(?:Marketing\s+)?Manager|Engineering\s+Manager|Demand\s+Gen)\b/gi,
    /(产品经理|市场总监|销售总监|运营总监|技术总监)/g,
    /(マーケティング|営業|製品|運営)(部長|責任者|担当)?/g,
  ];
  for (const p of patterns) {
    const matches = text.matchAll(p);
    for (const m of matches) out.add(m[0].trim());
  }
  return [...out].slice(0, 6);
}

function extractSummary(text: string): string {
  // Strip markdown and HTML, take first coherent paragraph
  const clean = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`~>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const firstBreak = clean.indexOf('. ');
  if (firstBreak > 80 && firstBreak < 280) return clean.slice(0, firstBreak + 1);
  return clean.slice(0, 280);
}

/**
 * Main entry: given some free-form text, produce a structured context.
 * Always tagged `extractor: 'regex'`.
 */
export function extractFromText(
  text: string,
  source: 'paste' | 'url' | 'file',
): ExtractedContext {
  if (!text || text.trim().length < 10) return { ...EMPTY, extractor: 'regex' };
  return {
    sourceKinds: [source],
    extractor: 'regex',
    namedCustomers: extractNamedCustomers(text),
    metrics: extractMetrics(text),
    features: extractFeatures(text),
    pains: extractPains(text),
    personas: extractPersonas(text),
    summary: extractSummary(text),
    textLength: text.length,
  };
}

/**
 * Async: try Gemini long-doc ingestion first; fall back to regex on known
 * not-configured conditions.
 *
 * Contract:
 *   - extractor='gemini' when Gemini actually ran and returned data.
 *   - extractor='regex' when we used regex — either because the text was
 *     below the Gemini threshold (not worth the call), OR because Gemini
 *     threw LLMRequiredError (no key configured). In the no-key case we
 *     set `extractorReason` so the UI / ops logs can distinguish
 *     "too short to bother" from "production is missing GEMINI_API_KEY".
 *   - LLMCallError (a real Gemini call failure — HTTP / parse / schema) is
 *     PROPAGATED, not swallowed. That's the honest signal: a configured
 *     Gemini that errors out is an ops problem the operator should see,
 *     not a silent degrade to regex.
 */
export async function extractFromTextSmart(
  text: string,
  source: 'paste' | 'url' | 'file',
): Promise<ExtractedContext> {
  if (!text || text.trim().length < 10) return { ...EMPTY, extractor: 'regex' };
  // Lazy-import to keep the module graph light for callers that only use
  // the sync regex path (e.g. tests).
  const { extractViaGemini } = await import('./llm-gemini');
  const { LLMRequiredError } = await import('./errors');
  try {
    const gemini = await extractViaGemini(text, source);
    if (gemini) return { ...gemini, extractor: 'gemini' };
    // null = routing decision (text too short for Gemini). Use regex; tag why.
    const regex = extractFromText(text, source);
    return {
      ...regex,
      extractorReason: 'text-below-gemini-threshold',
    };
  } catch (e) {
    if (e instanceof LLMRequiredError) {
      // No Gemini key configured — fall back to regex but record the
      // reason so the UI can show a subtle badge "using regex (Gemini
      // key not configured)" instead of pretending this is full-fat AI
      // extraction.
      const regex = extractFromText(text, source);
      return {
        ...regex,
        extractorReason: 'gemini-key-missing',
      };
    }
    // LLMCallError and anything else → propagate. A configured Gemini
    // that errored out is an ops problem that should surface to the
    // route handler (which will 502), not a silent regex fallback.
    throw e;
  }
}

/**
 * Merge multiple contexts (paste + multiple URLs + multiple files) into one.
 * Deduplicates by string equality; preserves order of first appearance.
 *
 * Provenance merge rule: if ANY input used Gemini, the merged context is
 * tagged 'gemini'. extractorReason is preserved only from the highest-
 * fidelity input that had one (the Gemini-failure reason is more
 * actionable than "text-below-threshold" on another input).
 */
export function mergeContexts(ctxs: ExtractedContext[]): ExtractedContext {
  const dedupe = (arr: string[][]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const a of arr) for (const s of a) {
      const k = s.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(s);
      }
    }
    return out;
  };
  const allSources = new Set<'paste' | 'url' | 'file'>();
  for (const c of ctxs) for (const s of c.sourceKinds) allSources.add(s);
  const anyGemini = ctxs.some((c) => c.extractor === 'gemini');
  const firstReason = ctxs
    .map((c) => c.extractorReason)
    .find((r): r is string => !!r);
  return {
    sourceKinds: [...allSources],
    extractor: anyGemini ? 'gemini' : 'regex',
    ...(firstReason && !anyGemini ? { extractorReason: firstReason } : {}),
    namedCustomers: dedupe(ctxs.map((c) => c.namedCustomers)).slice(0, 10),
    metrics: dedupe(ctxs.map((c) => c.metrics)).slice(0, 10),
    features: dedupe(ctxs.map((c) => c.features)).slice(0, 10),
    pains: dedupe(ctxs.map((c) => c.pains)).slice(0, 8),
    personas: dedupe(ctxs.map((c) => c.personas)).slice(0, 8),
    summary: ctxs.find((c) => c.summary)?.summary,
    textLength: ctxs.reduce((s, c) => s + c.textLength, 0),
  };
}

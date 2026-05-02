/**
 * Judge output validation (Phase 1 + 2 · pure functions).
 *
 * The judge LLM emits suggestions via tool-use with a JSON schema —
 * shape is enforced server-side by Anthropic / DeepSeek. But shape
 * compliance is NOT semantic compliance. Hard constraints we check
 * here:
 *
 *   1. evidenceQuote is non-empty AND actually appears in some
 *      module's content (the model can't fabricate quotes)
 *   2. proposedReplacement is non-empty AND meaningfully different
 *      from the quote (judge isn't proposing the same thing back)
 *   3. reusedAssets is non-empty AND every entry references a real
 *      asset path that exists in the input inventory (judge can't
 *      invent customer names or metrics)
 *   4. moduleId references an actual module in the input
 *   5. ruleId is in the closed enum (already enforced by tool schema
 *      but we double-check defensively)
 *
 * Suggestions failing any check are dropped — never reach the user.
 *
 * The validator returns BOTH the kept suggestions AND a list of drops
 * with reasons, so the judge call site can log diagnostics ("LLM
 * fabricated 3 customer names — dropped").
 */
import type { ProductInputs, PageModule } from './types';
import type { ExtractedContext } from './extract';
import {
  JUDGE_RULE_IDS,
  type JudgeSuggestion,
  type JudgeRuleId,
} from './judge-types';

export interface ValidationDrop {
  /** The raw suggestion as the LLM emitted it (or partial — may be
   *  missing fields if the schema validation already let nulls pass). */
  raw: Partial<JudgeSuggestion>;
  reason: string;
}

export interface ValidationResult {
  kept: JudgeSuggestion[];
  dropped: ValidationDrop[];
}

/**
 * Build the universe of valid asset paths from the user-typed inputs +
 * extracted context. Used by the reusedAssets check.
 *
 * Mirror buildJudgeUserPrompt's asset inventory exactly — these are
 * the strings we tell the LLM it can reference, so these are the
 * strings we accept back.
 */
export function buildAssetPathSet(
  inputs: ProductInputs,
  context?: ExtractedContext,
): Set<string> {
  const paths = new Set<string>();
  if (inputs.name) paths.add('product.name');
  if (inputs.tagline) paths.add('product.tagline');
  if (inputs.category) paths.add('product.category');
  if (inputs.value) paths.add('product.value');
  if (inputs.industry) paths.add('product.industry');
  if (inputs.role) paths.add('product.role');
  if (context) {
    (context.namedCustomers ?? []).slice(0, 6).forEach((_, i) => paths.add(`extracted.namedCustomers[${i}]`));
    (context.metrics ?? []).slice(0, 6).forEach((_, i) => paths.add(`extracted.metrics[${i}]`));
    (context.features ?? []).slice(0, 6).forEach((_, i) => paths.add(`extracted.features[${i}]`));
    (context.pains ?? []).slice(0, 4).forEach((_, i) => paths.add(`extracted.pains[${i}]`));
  }
  return paths;
}

/**
 * Recursively collect all string values from a module's content for
 * the evidenceQuote check. We can't predict where the judge will
 * quote from (title vs body vs items[i].body), so we just check the
 * quote appears SOMEWHERE in the rendered text.
 */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (value.length > 0) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
}

/**
 * Normalize for evidence-quote matching. The LLM might paraphrase a
 * single space or punctuation — but it shouldn't paraphrase whole
 * words. We strip whitespace + a few common punct marks and lowercase
 * for the comparison. Same idea as template-detection.ts normalize.
 */
function normalizeForQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：（）「」『』,.;:!?()'"`\-—–]/g, '');
}

/**
 * Apply all 5 hard constraints to a list of raw suggestions.
 *
 * Pure function: no LLM calls, no IO. Caller passes the raw output of
 * the judge tool_use, gets back validated + dropped.
 */
export function validateJudgeSuggestions(
  raw: Array<Partial<JudgeSuggestion>>,
  modules: PageModule[],
  inputs: ProductInputs,
  context: ExtractedContext | undefined,
): ValidationResult {
  const moduleIds = new Set(modules.map((m) => m.id));
  const assetPaths = buildAssetPathSet(inputs, context);

  // Build the corpus of all module text for evidence-quote matching.
  // Normalized once, since we may match many quotes against it.
  const allText: string[] = [];
  for (const m of modules) collectStrings(m.content, allText);
  const normalizedCorpus = allText.map(normalizeForQuote).join('||');

  const kept: JudgeSuggestion[] = [];
  const dropped: ValidationDrop[] = [];
  let autoIdSeq = 0;

  for (const s of raw) {
    // Constraint 5 — ruleId enum check (defensive against future drift)
    if (!s.ruleId || !JUDGE_RULE_IDS.includes(s.ruleId as JudgeRuleId)) {
      dropped.push({ raw: s, reason: `unknown ruleId: ${String(s.ruleId)}` });
      continue;
    }
    // Constraint 4 — moduleId references a real module
    if (!s.moduleId || !moduleIds.has(s.moduleId)) {
      dropped.push({ raw: s, reason: `moduleId not found: ${String(s.moduleId)}` });
      continue;
    }
    // Constraint 1 — evidenceQuote non-empty AND appears in module content
    const quote = (s.evidenceQuote ?? '').trim();
    if (quote.length === 0) {
      dropped.push({ raw: s, reason: 'empty evidenceQuote' });
      continue;
    }
    const nq = normalizeForQuote(quote);
    if (nq.length === 0 || !normalizedCorpus.includes(nq)) {
      dropped.push({ raw: s, reason: `evidenceQuote not found in any module text: ${quote.slice(0, 60)}` });
      continue;
    }
    // Constraint 2 — proposedReplacement non-empty AND different from quote
    const replacement = (s.proposedReplacement ?? '').trim();
    if (replacement.length === 0) {
      dropped.push({ raw: s, reason: 'empty proposedReplacement' });
      continue;
    }
    if (normalizeForQuote(replacement) === nq) {
      dropped.push({ raw: s, reason: 'proposedReplacement equals evidenceQuote (no change)' });
      continue;
    }
    // Constraint 3 — reusedAssets non-empty AND every entry is a real path
    const assets = Array.isArray(s.reusedAssets) ? s.reusedAssets : [];
    if (assets.length === 0) {
      dropped.push({ raw: s, reason: 'reusedAssets empty (judge must reuse user material)' });
      continue;
    }
    const fakeAssets = assets.filter((a) => !assetPaths.has(a));
    if (fakeAssets.length > 0) {
      dropped.push({
        raw: s,
        reason: `reusedAssets references non-existent paths: ${fakeAssets.join(', ')}`,
      });
      continue;
    }

    // Passed all 5. Assign a stable id (we'll dedup against re-runs by
    // hashing ruleId + moduleId + fieldPath + evidence later if needed).
    const id = `js_${s.ruleId}_${s.moduleId}_${autoIdSeq++}`;
    kept.push({
      id,
      ruleId: s.ruleId as JudgeRuleId,
      severity: (s.severity ?? 'med') as JudgeSuggestion['severity'],
      moduleId: s.moduleId,
      fieldPath: (s.fieldPath ?? '').trim() || 'content',
      reason: (s.reason ?? '').trim(),
      evidenceQuote: quote,
      reusedAssets: assets,
      proposedReplacement: replacement,
    });
  }

  return { kept, dropped };
}

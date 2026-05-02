/**
 * Judge agent · types (Phase 1).
 *
 * The judge is an independent LLM that critiques a hydrated landing page
 * and returns actionable suggestions. Designed to be cross-family from
 * the generator (Claude generated → DeepSeek/GPT judges, etc.) so the
 * judgment is structurally independent — see CLAUDE.md global §5
 * "athlete-referee" warning.
 *
 * Suggestions follow 5 hard constraints (see judge-prompt.ts):
 *   1. Must quote page content verbatim (evidenceQuote)
 *   2. Must propose a concrete replacement (proposedReplacement)
 *   3. Must reuse user-typed assets (reusedAssets non-empty)
 *   4. Must acknowledge unknowns ("I don't see X" rather than fabricating)
 *   5. Must be expressed as conditional advice, not commands
 *
 * Suggestions failing any constraint are dropped server-side before
 * reaching the user.
 */
import type { LLMProvider } from './llm-config';

export type JudgeSeverity = 'high' | 'med' | 'low';

export type JudgeRejectionReason = 'preference' | 'judge_wrong' | 'not_important';

/**
 * Rubric IDs — kept as a closed enum so rejection-rate tracking can
 * aggregate across pages.
 *
 * Phase 1: 6 items. Each maps to a section of the judge's system prompt.
 */
export const JUDGE_RULE_IDS = [
  'hero-anchors-number',         // Hero contains concrete metric / digit
  'hero-anchors-product',        // Hero references product name / tagline / category by their actual words
  'cross-module-coherence',      // Pain → solution → benefits all reference the same problem space
  'cta-specific',                // Primary CTA verb is concrete (not "Learn more")
  'locale-cultural-fit',         // Language / tone / proof shape matches market expectations
  'trust-signals-present',       // Some form of social proof — logos / testimonials / cases / certs
] as const;

export type JudgeRuleId = (typeof JUDGE_RULE_IDS)[number];

export interface JudgeSuggestion {
  /** Stable suggestion id — survives accept/reject so user actions can
   *  be deduped if the same critique re-appears across re-runs. */
  id: string;
  /** Which rubric this came from (rejection-rate aggregation key). */
  ruleId: JudgeRuleId;
  severity: JudgeSeverity;
  /** PageModule.id where the issue lives. */
  moduleId: string;
  /** Field within the module's content (e.g. 'subhead', 'items[2].title'). */
  fieldPath: string;
  /** Human-readable judge reasoning ("I as a CTO reading this..."). */
  reason: string;
  /** Verbatim slice of page content the judge is reacting to. */
  evidenceQuote: string;
  /** Tokens from the user's product inputs / extracted context this
   *  suggestion reuses (e.g. ['tagline', 'extracted_metrics[0]']).
   *  Hard-required to be non-empty — judge can't invent material. */
  reusedAssets: string[];
  /** Concrete replacement text the user can one-click apply. */
  proposedReplacement: string;
}

export interface JudgeReport {
  /** Hash of the page content the judgment is for. Cache invalidates
   *  when content changes (Phase 1: not persisted; computed at call
   *  time for future cache use). */
  contentHash: string;
  /** Unix ms timestamp. */
  generatedAt: number;
  /** Who judged (transparency for the user; also the cross-family proof). */
  judge: { provider: LLMProvider; model: string };
  /** Who generated the page being judged (for cross-family check). */
  generator: { provider: LLMProvider; model: string };
  /** Suggestions that passed all 5 hard constraints. */
  suggestions: JudgeSuggestion[];
  /** Rules that were evaluated (so the UI can show "checked X but no
   *  finding" rather than the user wondering whether the judge missed
   *  a category). */
  rulesChecked: JudgeRuleId[];
  /** Tells the UI "this was a same-family judgment" — should be false
   *  in normal operation; if true the UI shows a red caveat. */
  sameFamilyWarning: boolean;
}

/**
 * What the judge needs to evaluate a page. Includes the user's typed
 * inputs and extracted context so the reusedAssets check has real
 * material to reference.
 */
export interface JudgeInput {
  pageId: string;
  pageModules: import('./types').PageModule[];
  inputs: import('./types').ProductInputs;
  context?: import('./extract').ExtractedContext;
  locale: import('./types').PageLocale;
  /** Which generator wrote this page — used to pick a cross-family
   *  judge. Defaults to the locale's normal copy provider if unknown. */
  generatorProvider?: LLMProvider;
}

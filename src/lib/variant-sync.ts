/**
 * A↔B variant content sync — pure helpers.
 *
 * When the user edits a "brand-asset"-class field in variant A (or B), we
 * mirror the change into the other variant's same-type module IN THE SAME
 * LOCALE. Cross-locale never syncs — zh-CN logos are 大陆客户, en logos are
 * 欧美客户, those are independent worlds.
 *
 * What's eligible for sync:
 *   - socialProof: entire content (logos / stats / variant / logoMode)
 *     — A/B differ in narrative, not in brand background
 *   - hero: media + layout + fontScale + CTA hrefs
 *     — visual + destination are page-level, copy is variant-level
 *   - form: entire content
 *     — lead capture is infrastructure, not narrative
 *
 * What's NOT eligible (deliberately):
 *   - hero.eyebrow / headline / subhead / primaryCta / secondaryCta /
 *     bullets — A says "lead with cost", B says "lead with outcome",
 *     same words would defeat the test
 *   - pain.* — pain only exists in A
 *   - solution.* / benefits.* / cta.* — copy diverges by narrative
 *   - testimonial.* — different testimonials may be picked per narrative
 *     (A picks "saved hours", B picks "grew revenue")
 *   - useCase / productShowcase / videoEmbed / faq — holding off until
 *     real usage shows users want this
 *
 * Granularity rule: filter at FIELD level inside content, not module level.
 * Even hero — we sync media/layout but NOT headline. So we can't just
 * blanket-copy the content object.
 */
import type { PageModule, ModuleType } from './types';

/**
 * Per-module-type allowlist. Each entry is either:
 *   - '*'           — sync the entire content object as-is
 *   - string[]      — sync only these top-level field names from content
 *
 * No nested-path support yet (e.g. 'items.*.media'). If we need that later,
 * extend the filter helper. For now top-level fields cover all v1 cases.
 */
const SYNC_FIELDS: Partial<Record<ModuleType, '*' | string[]>> = {
  socialProof: '*',
  hero: ['media', 'layout', 'fontScale', 'primaryCtaHref', 'secondaryCtaHref'],
  form: '*',
  // Conservative start. Add more as users actually demand them.
  // Candidates for the next pass (when we hear "I want X to sync too"):
  //   benefits: ['layout'],     // visual choice, not copy
  //   useCase: [],              // probably never — role/scenario is locale-specific
  //   productShowcase: [],      // screenshots may differ per locale anyway
  //   videoEmbed: ['media'],    // demo URL probably same
};

/**
 * Given a content patch for a module of type `t`, return a NEW patch
 * containing only the fields that are sync-eligible. Returns null when
 * nothing should sync (or the type isn't in the allowlist at all).
 *
 * `patch` is what was passed into setContent — a partial of the content
 * object. We don't expect it to BE the full content (caller passes the
 * fields they actually changed, but in practice setContent gets the whole
 * object back from the spread {...c, headline: x}). Either way the filter
 * works: we just pick allowlisted keys from whatever's in the input.
 */
export function filterContentForSync(
  type: ModuleType,
  contentPatch: Record<string, unknown>,
): Record<string, unknown> | null {
  const rule = SYNC_FIELDS[type];
  if (!rule) return null;
  if (!contentPatch || typeof contentPatch !== 'object') return null;

  if (rule === '*') {
    // Whole content is sync-eligible. Return a shallow clone so callers
    // can't accidentally entangle the two variants' object references.
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(contentPatch)) out[k] = contentPatch[k];
    return Object.keys(out).length > 0 ? out : null;
  }

  // Top-level allowlist: pick only listed fields that are present.
  const out: Record<string, unknown> = {};
  for (const k of rule) {
    if (k in contentPatch) out[k] = contentPatch[k];
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Apply a sync patch onto an existing module's content, producing a new
 * module object. Used by updateModule to compute the other-variant cell
 * after filtering.
 *
 * Returns a new PageModule with merged content, or null if the module
 * isn't found / type mismatch.
 */
export function mergeSyncedContent(
  target: PageModule,
  syncedFields: Record<string, unknown>,
): PageModule {
  // Cast through `unknown` — TypeScript's discriminated-union content type
  // doesn't have an index signature, but at runtime each variant content
  // is a plain object and shallow-merging an allowlisted partial is safe.
  // Caller (filterContentForSync) has already filtered to known field
  // names for that module type.
  const merged = {
    ...(target.content as unknown as Record<string, unknown>),
    ...syncedFields,
  } as unknown as PageModule['content'];
  return { ...target, content: merged };
}

/**
 * Given the current variant's modules + the OTHER variant's modules, find
 * the same-type module in the other variant. Returns the index or -1.
 *
 * Why not match by id: regenerate / hydrate paths preserve module id
 * across variants in some flows but not all. Type-matching is more robust
 * for this use case (sync of brand assets), and ambiguity is unlikely —
 * v1 only syncs hero / socialProof / form, and the LLM-generated layouts
 * don't put two of the same type in one variant.
 */
export function findSyncTargetIndex(
  otherVariantMods: PageModule[],
  type: ModuleType,
): number {
  return otherVariantMods.findIndex((m) => m.type === type);
}

/** Exposed for tests. */
export const __test__ = { SYNC_FIELDS };

/**
 * Parallel-locale migration (P2 of the 2026-04 refactor · CLAUDE.md §四 TODO #1).
 *
 * Splits a legacy "one row owns all locales" LandingPage into N sibling rows,
 * one per locale, linked by a shared `localeGroupId`. Pure planning is
 * separated from writes so an admin endpoint can preview impact (`?dryRun=1`)
 * before committing.
 *
 * Decisions locked with user (方案 B · 一次继承后各自独立):
 *   · Primary sibling = the row with locale === page.defaultLocale. Keeps
 *     the original id so legacy URLs (/zh-CN/projects/<id>), leads.projectId,
 *     and analytics events.projectId stay valid. Also owns the slug-map
 *     pointer so `getLandingPageBySlug` still resolves to a canonical row.
 *     Inherits `published` / `publishedAt` / `deploy` from source — the
 *     Vercel HTML already referred to this locale.
 *   · Non-primary siblings = new rows (fresh nanoid). Same productId, slug,
 *     localeGroupId. `deploy` = null, `published` = false, `publishedAt`
 *     cleared. They start unpublished because they have no independent
 *     deploy record; user re-publishes each explicitly when ready (P5).
 *     This matches the rule "写入新 KV row: published=false, 不继承源的
 *     发布状态" — applied consistently to any newly-created sibling row,
 *     whether created via migration (P2) or user-initiated localize (P4).
 *   · `hydrationFailed` inherited (if source had it, all siblings do; user
 *     re-hydrates individually).
 *   · First-time inheritance only — content is copied once here (and, in
 *     P4, again on user-initiated localize), then each sibling diverges.
 *     Editing zh-CN never touches en; deleting zh-CN never deletes en.
 *
 * Idempotency: if `page.localeGroupId` is already set, `planPageMigration`
 * returns `alreadyMigrated: true` and an empty siblings list. `applyPageMigration`
 * no-ops on that shape. Safe to re-run.
 */

import { nanoid } from 'nanoid';
import type { LandingPage, LocalizedContent, PageLocale } from './types';
import { saveLandingPage } from './storage';

export interface PageMigrationPlan {
  pageId: string;            // id of the source page (= primaryUpdate.id post-plan)
  slug: string;
  alreadyMigrated: boolean;  // true when source already has a localeGroupId
  groupId: string;           // the localeGroupId stamped on every sibling
  primaryUpdate: LandingPage;  // what the existing row becomes
  newSiblings: LandingPage[];  // new rows to create (one per non-primary locale)
}

/**
 * Build the migration plan for a single page. Pure — does not touch storage.
 */
export function planPageMigration(page: LandingPage): PageMigrationPlan {
  if (page.localeGroupId) {
    return {
      pageId: page.id,
      slug: page.slug,
      alreadyMigrated: true,
      groupId: page.localeGroupId,
      primaryUpdate: page,
      newSiblings: [],
    };
  }

  const groupId = `lg_${nanoid(12)}`;
  const defaultLocale = page.defaultLocale;

  // Defensive: if availableLocales is empty or missing the defaultLocale,
  // treat defaultLocale as the canonical set. Happens on very old rows
  // where the field was added after creation.
  const declared = (page.availableLocales && page.availableLocales.length > 0)
    ? page.availableLocales
    : [defaultLocale];
  const uniqueLocales = Array.from(new Set<PageLocale>([defaultLocale, ...declared]));

  const primaryUpdate = buildSibling(page, defaultLocale, groupId, true, page.id);
  const newSiblings: LandingPage[] = [];
  for (const loc of uniqueLocales) {
    if (loc === defaultLocale) continue;
    const sibling = buildSibling(page, loc, groupId, false, `p_${nanoid(12)}`);
    newSiblings.push(sibling);
  }

  return {
    pageId: page.id,
    slug: page.slug,
    alreadyMigrated: false,
    groupId,
    primaryUpdate,
    newSiblings,
  };
}

/**
 * Construct one sibling row from the source page + target locale.
 *   · variants.{A|B} pruned to `{ [locale]: modules }` (empty array if the
 *     source didn't have content for this locale — shouldn't happen if
 *     availableLocales was truthful, but defended).
 *   · stats sliced per-locale via byLocale / byVariantLocale; abStats
 *     reduced to this locale's A+B cells.
 *   · deploy: kept only on primary (source Vercel render was defaultLocale).
 *   · timestamps: primary keeps createdAt, non-primary gets now.
 */
function buildSibling(
  src: LandingPage,
  locale: PageLocale,
  groupId: string,
  isPrimary: boolean,
  id: string,
): LandingPage {
  const variantA = src.variants?.A?.[locale] ?? [];
  const variantB = src.variants?.B?.[locale] ?? [];

  const byLoc = src.stats?.byLocale?.[locale] ?? { views: 0, leads: 0 };
  const varLocA = src.stats?.byVariantLocale?.A?.[locale] ?? { views: 0, leads: 0 };
  const varLocB = src.stats?.byVariantLocale?.B?.[locale] ?? { views: 0, leads: 0 };

  return {
    ...src,
    id,
    locale,
    localeGroupId: groupId,
    defaultLocale: locale,       // each sibling is self-consistent for its locale
    availableLocales: [locale],
    variants: {
      A: { [locale]: variantA } as LocalizedContent,
      B: { [locale]: variantB } as LocalizedContent,
    },
    // Primary inherits deploy/published (legacy HTML was its render);
    // non-primary starts fresh and unpublished — rule: "published=false,
    // 不继承源的发布状态".
    deploy: isPrimary ? (src.deploy ?? null) : null,
    published: isPrimary ? src.published : false,
    publishedAt: isPrimary ? src.publishedAt : undefined,
    createdAt: isPrimary ? src.createdAt : Date.now(),
    updatedAt: Date.now(),
    stats: {
      views: byLoc.views,
      leads: byLoc.leads,
      byLocale: { [locale]: byLoc } as LandingPage['stats']['byLocale'],
      byVariantLocale: {
        A: { [locale]: varLocA },
        B: { [locale]: varLocB },
      } as LandingPage['stats']['byVariantLocale'],
      abStats: {
        A: { views: varLocA.views, leads: varLocA.leads },
        B: { views: varLocB.views, leads: varLocB.leads },
      },
    },
  };
}

/**
 * Execute the plan against storage. Primary first (with slug-map write) so
 * `getLandingPageBySlug` keeps resolving to the canonical row; then siblings
 * with `skipSlugMap: true` so they don't overwrite the primary pointer.
 * Group SADD happens inside `saveLandingPage` whenever `localeGroupId` is set.
 */
export async function applyPageMigration(plan: PageMigrationPlan): Promise<void> {
  if (plan.alreadyMigrated) return;
  await saveLandingPage(plan.primaryUpdate);
  for (const sibling of plan.newSiblings) {
    await saveLandingPage(sibling, { skipSlugMap: true });
  }
}

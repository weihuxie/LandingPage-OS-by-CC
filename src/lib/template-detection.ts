/**
 * Template-fingerprint detector.
 *
 * Reason this file exists: generateModules() in ai.ts stamps every new page
 * with "believable-looking" fallback copy (e.g. "3.8 倍 ROI，上线当周就开始")
 * so the preview isn't empty before Claude runs. If Claude hydration then
 * FAILS silently (no API key / timeout / bad JSON), that fallback ships to
 * the live page and the user never learns that AI didn't write it.
 *
 * This module knows the exact strings ai.ts emits. Callers can:
 *   - flag a LandingPage as `hydrationFailed` right after create/add-locale
 *   - lint every active variant before deploy
 *   - warn in the editor when the hero is still 100% template
 *
 * Keep in sync with: lossPhrase(), outcomePhrase(), L[locale].headlineTmpl
 * in src/lib/ai.ts.
 */
import type { PageModule, PageLocale } from './types';

/** Fingerprints for Variant A (pain-driven) and Variant B (benefit-driven)
 *  hero headlines that get stamped when no product.value is extracted AND
 *  Claude never overwrote the module. */
const TEMPLATE_HERO_HEADLINES_STATIC: readonly string[] = [
  // lossPhrase — Variant A
  '每周有 11 小时，被本可避免的手工活吃掉。',
  '每週有 11 小時,被本可避免的手動作業吃掉。',
  '週 11 時間、避けられるはずの手作業に奪われています。',
  '11 hours a week, lost to work that should never exist.',
  // outcomePhrase — Variant B
  '3.8 倍 ROI，上线当周就开始。',
  '3.8 倍 ROI,上線當週就開始。',
  '3.8 倍の ROI、公開週から。',
  '3.8× ROI — starting the week you launch.',
];

/** Fingerprints for `${name}, built for results.`-style default headlines
 *  that fire when the user didn't provide a value prop. Parametric because
 *  they interpolate the product name. */
function isNameBasedDefaultHeadline(headline: string, name: string | undefined): boolean {
  if (!name || !headline) return false;
  const trimmed = headline.trim();
  // Replace name occurrences with a marker so multiple products using the
  // same template shape collapse to one fingerprint.
  const normalized = trimmed.split(name).join('{name}');
  return (
    normalized === '{name}, built for results.' ||
    normalized === '{name}，为结果而生。' ||
    normalized === '{name},為結果而生。' ||
    normalized === '{name}、成果のために。'
  );
}

/** Default bullet lists stamped onto new heroes. Signals Claude didn't
 *  rewrite the bullets. We only flag if ALL THREE bullets match a known
 *  default set — partial matches may be legitimate hybrid edits. */
const TEMPLATE_HERO_BULLET_SETS: readonly (readonly string[])[] = [
  ['Up and running in minutes', 'Built for fast-moving teams', 'Measurable ROI from week one'],
  ['分钟级上线', '专为快速团队打造', '第一周就能看到 ROI'],
  ['分鐘級上線', '專為快速團隊打造', '第一週就能看到 ROI'],
  ['数分で稼働開始', 'スピード重視のチームに最適', '初週から測定可能な ROI'],
];

/**
 * Does the hero module's headline still look like the default template?
 *
 * Returns true when the headline EXACTLY matches one of the known fallback
 * strings. We intentionally don't fuzzy-match: a user who deliberately
 * writes "11 hours a week..." has made a choice, and we shouldn't flag
 * their prose. Exact-match catches the "nobody touched it" case.
 */
export function isHeroHeadlineTemplate(
  headline: string | undefined,
  name?: string,
): boolean {
  if (!headline) return true; // empty counts as un-hydrated
  const trimmed = headline.trim();
  if (TEMPLATE_HERO_HEADLINES_STATIC.includes(trimmed)) return true;
  if (isNameBasedDefaultHeadline(trimmed, name)) return true;
  return false;
}

/** Are the hero bullets the exact template set? */
export function isHeroBulletsTemplate(
  bullets: string[] | undefined,
): boolean {
  if (!bullets || bullets.length !== 3) return false;
  return TEMPLATE_HERO_BULLET_SETS.some(
    (set) => set[0] === bullets[0] && set[1] === bullets[1] && set[2] === bullets[2],
  );
}

/** Top-level check: does this module set look like an un-hydrated page? */
export interface HeroTemplateReport {
  headline: boolean;
  bullets: boolean;
  /** `headline || bullets` — rough single-number signal */
  anyTemplate: boolean;
}

export function reportHeroTemplate(
  modules: PageModule[],
  name: string,
): HeroTemplateReport {
  const hero = modules.find((m) => m.type === 'hero');
  if (!hero) return { headline: false, bullets: false, anyTemplate: false };
  const c = hero.content as { headline?: string; bullets?: string[] };
  const headline = isHeroHeadlineTemplate(c.headline, name);
  const bullets = isHeroBulletsTemplate(c.bullets);
  return { headline, bullets, anyTemplate: headline || bullets };
}

/**
 * Scan all variant/locale cells and report which ones still carry template
 * hero copy. The caller (POST /api/projects, POST .../locales, deploy
 * pre-check) decides what to do with this — set a flag, show a banner,
 * block deploy.
 */
export function scanPageForTemplateHeroes(
  variants: { A: Partial<Record<PageLocale, PageModule[]>>; B: Partial<Record<PageLocale, PageModule[]>> },
  name: string,
): { variant: 'A' | 'B'; locale: PageLocale; report: HeroTemplateReport }[] {
  const out: { variant: 'A' | 'B'; locale: PageLocale; report: HeroTemplateReport }[] = [];
  for (const v of ['A', 'B'] as const) {
    for (const locale of Object.keys(variants[v]) as PageLocale[]) {
      const mods = variants[v][locale];
      if (!mods) continue;
      const report = reportHeroTemplate(mods, name);
      if (report.anyTemplate) out.push({ variant: v, locale, report });
    }
  }
  return out;
}

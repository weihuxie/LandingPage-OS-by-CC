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
 *   - warn in the editor when ANY hydrated module is still 100% template
 *
 * Keep in sync with: lossPhrase(), outcomePhrase(), L[locale].headlineTmpl,
 * L[locale].painTitle / painItems, L[locale].solutionTitle / solutionBody,
 * L[locale].benefitsTitle / benefits, L[locale].ctaHeadline / ctaSub
 * in src/lib/ai.ts.
 */
import type { PageModule, PageLocale, ModuleType } from './types';

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

// =====================================================================
// Non-hero module template fingerprints (Phase: hydrate reliability)
// =====================================================================
//
// The old post-hydrate check was hero-only. Claude can return template-
// looking pain/benefits/cta copy just as easily — a user with thin
// product inputs would get "Why teams switch" as their benefits title
// (straight out of ai.ts L.en.benefitsTitle) with no red flag anywhere.
// The per-module fingerprints below let hydrateModulesViaClaude retry
// (or surface) EACH module that came back template, not just hero.
//
// MAINTENANCE: every time ai.ts L[locale] adds/changes a static string
// used by generateModules, mirror the change here. A missing fingerprint
// means a template string ships live undetected.

// --- PAIN ----------------------------------------------------------------

const TEMPLATE_PAIN_TITLES: readonly string[] = [
  'The old way isn’t working',
  '旧的做法已经不管用',
  '舊的做法已經不管用',
  '従来のやり方では限界です',
];
const TEMPLATE_PAIN_ITEM_TITLES: readonly string[] = [
  // en
  'Manual work eats your week',
  'Tools don’t talk to each other',
  'Slow feedback loops',
  // zh-CN
  '手工活吃掉整周',
  '工具之间不互通',
  '反馈链路太长',
  // zh-TW
  '手動作業吃掉整週',
  '工具之間不互通',
  '回饋鏈路太長',
  // ja
  '手作業が週を奪う',
  'ツール同士がつながらない',
  'フィードバックが遅い',
];

// --- SOLUTION ------------------------------------------------------------

const TEMPLATE_SOLUTION_TITLES: readonly string[] = [
  'A single place that just works',
  '一个地方把事情做完',
  '一個地方把事情做完',
  'ひとつの場所で完結',
];
const TEMPLATE_SOLUTION_BODIES: readonly string[] = [
  'Bring your product info, audience, and materials — get a localized, conversion-ready page. Edit anything, publish, collect leads.',
  '输入产品信息、受众和资料 — 拿到一张本地化、围绕转化的落地页。随时编辑、发布、收集线索。',
  '輸入產品資訊、受眾與資料 — 取得一張在地化、以轉化為核心的落地頁。隨時編輯、發布、收集名單。',
  '製品情報・ターゲット・資料を渡せば、ローカライズ済み・コンバージョン設計済みのページが手に入ります。編集・公開・リード獲得まで。',
];

// --- BENEFITS ------------------------------------------------------------

const TEMPLATE_BENEFITS_TITLES: readonly string[] = [
  'Why teams switch',
  '为什么团队会切换过来',
  '為什麼團隊會切換過來',
  'なぜ乗り換えるのか',
];
const TEMPLATE_BENEFITS_ITEM_TITLES: readonly string[] = [
  // en
  'Faster time-to-page',
  'Localized, not translated',
  'Conversion-first modules',
  // zh-CN
  '更快的上线速度',
  '本地化而非翻译',
  '以转化为导向的模块',
  // zh-TW
  '更快的上線速度',
  '在地化而非翻譯',
  '以轉化為導向的模組',
  // ja
  'ページが早く立ち上がる',
  '翻訳ではなくローカライズ',
  'コンバージョン起点のモジュール',
];

// --- CTA -----------------------------------------------------------------
//
// We fingerprint headline + subhead but NOT button. Button labels come
// from ctaLabels[goal] (e.g. "Book a Demo" / "预约演示") — those are
// industry-standard phrases Claude may legitimately emit even on well-
// grounded output. Checking them would produce false positives.

const TEMPLATE_CTA_HEADLINES: readonly string[] = [
  'Ready to ship your page?',
  '准备好上线了吗？',
  '準備好上線了嗎?',
  '公開の準備はできていますか?',
];
const TEMPLATE_CTA_SUBHEADS: readonly string[] = [
  'Start with a single product — add more any time.',
  '从一个产品开始，之后随时加。',
  '從一個產品開始,之後隨時加。',
  'まずは 1 製品から。いつでも追加できます。',
];

// --- Per-module predicates -----------------------------------------------
//
// Each returns true when the module's content still clearly matches a
// template fingerprint. The heuristic is "title matches OR the body
// shape matches" — either alone is strong enough to flag. Partial
// rewrites (Claude returned title but not items) still get caught
// because the unrewritten field keeps its template value through the
// patch-merge in hydrateModulesViaClaude.

export function isPainTemplate(content: unknown): boolean {
  const c = content as { title?: string; items?: Array<{ title?: string }> } | null;
  if (!c) return false;
  if (c.title && TEMPLATE_PAIN_TITLES.includes(c.title.trim())) return true;
  const items = c.items ?? [];
  if (items.length > 0) {
    const allTemplate = items.every(
      (it) => typeof it.title === 'string' && TEMPLATE_PAIN_ITEM_TITLES.includes(it.title.trim()),
    );
    if (allTemplate) return true;
  }
  return false;
}

export function isSolutionTemplate(content: unknown): boolean {
  const c = content as { title?: string; body?: string } | null;
  if (!c) return false;
  if (c.title && TEMPLATE_SOLUTION_TITLES.includes(c.title.trim())) return true;
  if (c.body && TEMPLATE_SOLUTION_BODIES.includes(c.body.trim())) return true;
  return false;
}

export function isBenefitsTemplate(content: unknown): boolean {
  const c = content as { title?: string; items?: Array<{ title?: string }> } | null;
  if (!c) return false;
  if (c.title && TEMPLATE_BENEFITS_TITLES.includes(c.title.trim())) return true;
  const items = c.items ?? [];
  if (items.length > 0) {
    const allTemplate = items.every(
      (it) => typeof it.title === 'string' && TEMPLATE_BENEFITS_ITEM_TITLES.includes(it.title.trim()),
    );
    if (allTemplate) return true;
  }
  return false;
}

export function isCtaTemplate(content: unknown): boolean {
  const c = content as { headline?: string; subhead?: string } | null;
  if (!c) return false;
  if (c.headline && TEMPLATE_CTA_HEADLINES.includes(c.headline.trim())) return true;
  if (c.subhead && TEMPLATE_CTA_SUBHEADS.includes(c.subhead.trim())) return true;
  return false;
}

// --- Unified entry -------------------------------------------------------

export interface ModuleTemplateReport {
  type: ModuleType;
  isTemplate: boolean;
  /** Short human-readable reason, for logs / banner diagnostics. */
  reason?: string;
}

/**
 * Return a list of module types whose content still matches a template
 * fingerprint. Types not in the hydrate set (form / socialProof / ...)
 * are never flagged — they're user-authored or schema-shaped, not
 * AI-generated, so "template" doesn't apply.
 */
export function findTemplateModules(
  modules: PageModule[],
  name: string,
): ModuleTemplateReport[] {
  const out: ModuleTemplateReport[] = [];
  for (const m of modules) {
    switch (m.type) {
      case 'hero': {
        const r = reportHeroTemplate(modules, name);
        if (r.anyTemplate) {
          const parts: string[] = [];
          if (r.headline) parts.push('headline');
          if (r.bullets) parts.push('bullets');
          out.push({ type: 'hero', isTemplate: true, reason: parts.join('+') });
        }
        break;
      }
      case 'pain':
        if (isPainTemplate(m.content)) out.push({ type: 'pain', isTemplate: true });
        break;
      case 'solution':
        if (isSolutionTemplate(m.content)) out.push({ type: 'solution', isTemplate: true });
        break;
      case 'benefits':
        if (isBenefitsTemplate(m.content)) out.push({ type: 'benefits', isTemplate: true });
        break;
      case 'cta':
        if (isCtaTemplate(m.content)) out.push({ type: 'cta', isTemplate: true });
        break;
      // hero handled separately — can't switch-case duplicate
      default:
        break;
    }
  }
  return out;
}

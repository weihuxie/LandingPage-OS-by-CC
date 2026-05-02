/**
 * Page diagnostics — pure rule engine that scans a module list and surfaces
 * "things that look unfinished" without calling the LLM.
 *
 * Why this lives in its own file: there are already two layers that look
 * adjacent but are NOT this:
 *   - `template-detection.ts` knows the EXACT fingerprints `ai.ts` stamps
 *     before Claude runs. It answers "did Claude run at all" — binary.
 *   - `NoticeBanner` in Editor.tsx surfaces ERRORS (503, 502, hydration
 *     failed). Reactive, code-driven.
 *
 * `page-diagnostics` is the third layer: heuristic quality checks that
 * fire even when there are no errors AND the page is fully hydrated. It
 * answers "the LLM ran but the output is mediocre, did the user notice?".
 *
 * Design rules:
 *  - Pure function: `findIssues(modules, locale, productName)` → `Issue[]`
 *  - Zero LLM cost — only string inspection
 *  - One rule per concern, easy to add/remove
 *  - Each issue carries an `action` hint so the banner can wire it to a
 *    concrete handler in Editor.tsx (jump to module, retrigger regen,
 *    open relocalize) — diagnostics never executes its own actions.
 *  - Severity ordering: 'high' shown first, then 'med', then 'low'
 *
 * 2026-04 added: pattern ②, "Inline 诊断 banner" from the AI-introduction
 * design doc. Sits above the editor grid as a yellow strip — distinct from
 * the red error NoticeBanner so the user can tell "fix" vs "improve" apart
 * at a glance.
 */
import type { ModuleType, PageLocale, PageModule } from './types';
import { findTemplateModules } from './template-detection';
import { findForbiddenPhrases, type ProductSurface } from './forbidden-phrases';

export type IssueSeverity = 'high' | 'med' | 'low';

export type IssueAction =
  | { kind: 'select-module'; moduleId: string }
  | { kind: 'regenerate-module'; moduleId: string }
  | { kind: 'relocalize' };

export interface Issue {
  id: string;
  severity: IssueSeverity;
  /** One-line summary shown in the collapsed list. */
  title: string;
  /** Optional second line / longer rationale shown when expanded. */
  detail?: string;
  /** Suggested user action — banner wires this to a callback in Editor. */
  action?: IssueAction;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HAS_DIGIT_OR_METRIC = /[0-9]|%|×|x|\$|￥|¥|€|£|倍|小时|hours?|hr|min|分|分钟/i;

/** Words/phrases that flag a weak CTA — locale-aware. List is short on
 *  purpose; we want clear hits, not regex tag wars. */
const WEAK_CTA_BY_LOCALE: Record<PageLocale, string[]> = {
  'zh-CN': ['了解更多', '查看详情', '点击这里', '更多'],
  'zh-TW': ['了解更多', '查看詳情', '點擊這裡', '更多'],
  ja: ['詳細はこちら', '詳しく見る', 'もっと見る', '続きを読む'],
  en: ['learn more', 'click here', 'read more', 'find out more'],
};

/** Detect "page looks untranslated" — content language doesn't match the
 *  locale tab. Cheap heuristic, not a full language detector. */
function looksUntranslated(text: string, locale: PageLocale): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;
  const total = trimmed.length;

  // Count CJK ideographs (Han block) and Hiragana/Katakana (kana blocks).
  let cjk = 0;
  let kana = 0;
  for (const ch of trimmed) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x4e00 && cp <= 0x9fff) cjk++;
    else if (cp >= 0x3040 && cp <= 0x30ff) kana++;
  }

  if (locale === 'en') {
    // English page should have negligible CJK ideographs.
    return cjk / total > 0.15;
  }
  if (locale === 'ja') {
    // Japanese should have visible kana. Pure-Han content is Chinese.
    if (cjk / total > 0.2 && kana === 0) return true;
    return false;
  }
  // zh-CN / zh-TW: don't try to tell simplified from traditional via
  // codepoint heuristics — the overlap is huge and would false-positive
  // on common chars. Skip.
  return false;
}

function firstHero(modules: PageModule[]): PageModule | null {
  return modules.find((m) => m.type === 'hero') ?? null;
}

function firstByType(modules: PageModule[], type: ModuleType): PageModule | null {
  return modules.find((m) => m.type === type) ?? null;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

interface RuleContext {
  modules: PageModule[];
  locale: PageLocale;
  productName: string;
  hero: PageModule | null;
  /** Optional product surface for forbidden-phrase context (Wave 4 #K).
   *  When the user typed a forbidden phrase verbatim into their inputs,
   *  the rule silences itself — they own that phrase. */
  productSurface?: ProductSurface;
}

type Rule = (ctx: RuleContext) => Issue[];

/** R1 — template fingerprints still present (Claude didn't write this). */
const ruleTemplateModules: Rule = ({ modules, productName }) => {
  const reports = findTemplateModules(modules, productName);
  if (reports.length === 0) return [];
  return reports.map((r) => {
    const target = modules.find((m) => m.type === r.type);
    const reasonTail = r.reason ? `（${r.reason}）` : '';
    return {
      id: `template-${r.type}`,
      severity: 'high' as const,
      title: `${labelFor(r.type)} 仍是模板文案${reasonTail}`,
      detail:
        '当前内容是 ai.ts 在 LLM 运行前铺的占位骨架，看起来像真文案但其实没经过 Claude/DeepSeek 改写。建议点击右侧"重新生成文案"或运行 hydrate。',
      action: target
        ? { kind: 'regenerate-module', moduleId: target.id }
        : undefined,
    };
  });
};

/** R2 — hero subhead has no concrete metric (no number / % / × / 倍 …). */
const ruleValuePropSoft: Rule = ({ hero }) => {
  if (!hero) return [];
  const c: any = hero.content;
  const sub: string = (c?.subhead ?? '').trim();
  if (!sub) return [];
  if (HAS_DIGIT_OR_METRIC.test(sub)) return [];
  return [
    {
      id: 'hero-subhead-soft',
      severity: 'med',
      title: 'Hero 副标题缺少具体数字/指标',
      detail:
        '高转化落地页的 Hero 副标题通常含有可量化的承诺（"3.8 倍 ROI"、"减少 60% 工时"）。当前副标题是描述性语言，建议加入一个具体数字。',
      action: { kind: 'select-module', moduleId: hero.id },
    },
  ];
};

/** R3 — Hero primary CTA looks like a weak generic phrase. */
const ruleWeakCta: Rule = ({ modules, locale, hero }) => {
  const out: Issue[] = [];
  const weak = WEAK_CTA_BY_LOCALE[locale] ?? [];
  if (hero) {
    const c: any = hero.content;
    const label: string = (c?.primaryCta ?? '').trim().toLowerCase();
    if (label && weak.some((w) => label === w.toLowerCase() || label.includes(w.toLowerCase()))) {
      out.push({
        id: 'hero-cta-weak',
        severity: 'med',
        title: `Hero 主 CTA 文案太弱："${c.primaryCta}"`,
        detail:
          'CTA 文案最好带动作感和具体收益（"免费试用 30 天"、"30 秒生成第一页"），避免"了解更多 / Learn more"这类无承诺的词。',
        action: { kind: 'select-module', moduleId: hero.id },
      });
    }
  }
  // Also scan the dedicated CTA module if present (CTAContent.button)
  const ctaMod = firstByType(modules, 'cta');
  if (ctaMod) {
    const c: any = ctaMod.content;
    const raw: string = (c?.button ?? '').trim();
    const label = raw.toLowerCase();
    if (label && weak.some((w) => label === w.toLowerCase() || label.includes(w.toLowerCase()))) {
      out.push({
        id: 'cta-module-weak',
        severity: 'med',
        title: `底部 CTA 文案太弱："${raw}"`,
        action: { kind: 'select-module', moduleId: ctaMod.id },
      });
    }
  }
  return out;
};

/** R4 — content language doesn't look like locale (e.g. EN tab full of CJK). */
const ruleUntranslated: Rule = ({ modules, locale }) => {
  if (locale !== 'en' && locale !== 'ja') return [];
  const hero = firstByType(modules, 'hero');
  if (!hero) return [];
  const c: any = hero.content;
  // Concatenate the visible long-form fields — most likely place to detect
  // an untranslated chunk.
  const sample = [c?.headline, c?.subhead, ...(c?.bullets ?? [])]
    .filter((s) => typeof s === 'string')
    .join(' ');
  if (!looksUntranslated(sample, locale)) return [];
  return [
    {
      id: `untranslated-${locale}`,
      severity: 'high',
      title: `${locale} 标签下的 Hero 文字看起来还是源语言`,
      detail:
        '检测到 Hero 字段含大量非目标语言字符。可能是本地化失败回退到源语言、或本地化后某些字段没被覆盖。建议触发"重新本地化当前语言"。',
      action: { kind: 'relocalize' },
    },
  ];
};

/** R5 — page has no social proof module at all. */
const ruleMissingSocialProof: Rule = ({ modules }) => {
  if (modules.some((m) => m.type === 'socialProof')) return [];
  // Only flag if the page is fairly developed (has hero + one of pain/benefits)
  const looksRealPage = modules.some((m) => m.type === 'hero')
    && modules.some((m) => m.type === 'pain' || m.type === 'benefits');
  if (!looksRealPage) return [];
  return [
    {
      id: 'missing-social-proof',
      severity: 'low',
      title: '页面没有客户 logo / 数据社会证明',
      detail:
        '在 Hero 之后放一行客户 logo + 关键数字能显著提升转化信心。从左下"添加模块"里加"socialProof"。',
    },
  ];
};

/** R6 — hero bullets empty or default-shaped. */
const ruleEmptyBullets: Rule = ({ hero }) => {
  if (!hero) return [];
  const c: any = hero.content;
  const bullets: string[] = Array.isArray(c?.bullets) ? c.bullets : [];
  const real = bullets.filter((b) => typeof b === 'string' && b.trim().length > 0);
  if (real.length === 0) {
    return [
      {
        id: 'hero-bullets-empty',
        severity: 'low',
        title: 'Hero 没有 bullets（关键卖点）',
        detail:
          '即使副标题写得好，3 行 bullets 仍是访客最容易扫读的"卖点速览"。建议补 2–4 条。',
        action: { kind: 'select-module', moduleId: hero.id },
      },
    ];
  }
  return [];
};

/**
 * R7 — forbidden default phrases (Audit Wave 4 #K).
 *
 * The prompt asks Claude to avoid SaaS-generic boilerplate ("ROI 计算器" /
 * "logo wall" / "every team saves N hours/week" etc.). Claude self-checks
 * via the prompt's "Forbidden defaults" section, but enforcement was
 * 100% prompt-side — athlete refereeing themselves (CLAUDE.md global §5).
 *
 * This rule is the deterministic backstop: scan output for the exact
 * regex patterns the LLM was told to avoid, surface a med-severity issue
 * if any slipped through. Silenced when the user's own product input
 * contains the phrase.
 */
const ruleForbiddenPhrases: Rule = ({ modules, productSurface }) => {
  const issues: Issue[] = [];
  for (const m of modules) {
    const c = m.content as unknown as Record<string, unknown>;
    // Scan string-valued top-level fields. Could recurse into items[]
    // arrays for tighter coverage; keep MVP shallow.
    for (const [key, val] of Object.entries(c)) {
      if (typeof val !== 'string' || val.length === 0) continue;
      const hits = findForbiddenPhrases(val, productSurface);
      for (const hit of hits) {
        issues.push({
          id: `forbidden-${m.id}-${key}-${hit.rule.id}`,
          severity: 'med' as const,
          title: `${labelFor(m.type)} 命中默认套话「${hit.snippet.trim()}」`,
          detail: hit.rule.reason,
          action: { kind: 'select-module', moduleId: m.id },
        });
      }
    }
  }
  return issues;
};

const RULES: Rule[] = [
  ruleTemplateModules,
  ruleValuePropSoft,
  ruleWeakCta,
  ruleUntranslated,
  ruleMissingSocialProof,
  ruleEmptyBullets,
  ruleForbiddenPhrases,
];

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function findIssues(
  modules: PageModule[],
  locale: PageLocale,
  productName: string = '',
  // Audit Wave 4 #K: optional product surface (name/tagline/category/value)
  // for the forbidden-phrase rule's `unless` check. When omitted, the rule
  // still fires but never silences itself.
  productSurface?: ProductSurface,
): Issue[] {
  if (!Array.isArray(modules) || modules.length === 0) return [];
  const ctx: RuleContext = {
    modules,
    locale,
    productName,
    hero: firstHero(modules),
    productSurface,
  };
  const all = RULES.flatMap((r) => {
    try {
      return r(ctx);
    } catch {
      // A bad rule must not break the editor — diagnostics are advisory.
      return [];
    }
  });
  return all.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function severityRank(s: IssueSeverity): number {
  return s === 'high' ? 0 : s === 'med' ? 1 : 2;
}

function labelFor(t: ModuleType): string {
  switch (t) {
    case 'hero': return 'Hero';
    case 'pain': return '痛点';
    case 'solution': return '解决方案';
    case 'benefits': return '核心收益';
    case 'cta': return '底部 CTA';
    case 'socialProof': return '社会证明';
    case 'testimonial': return '客户证言';
    case 'useCase': return '使用场景';
    case 'faq': return 'FAQ';
    case 'form': return '表单';
    case 'productShowcase': return '产品展示';
    case 'videoEmbed': return '视频';
    default: return String(t);
  }
}

export const __test__ = { looksUntranslated, HAS_DIGIT_OR_METRIC };

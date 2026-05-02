/**
 * Forbidden default phrases (Audit Wave 4 #K).
 *
 * Why this file exists: llm-claude.ts STRATEGY_SYSTEM has a long
 * "Forbidden defaults" section telling Claude not to emit certain
 * SaaS-generic boilerplate phrases. Empirically this in-prompt
 * instruction works ~90% of the time, but Claude still slips. The
 * old detection relied on Claude self-checking ("Before writing any
 * line, silently ask...") — that's the athlete refereeing themselves
 * (CLAUDE.md global §5).
 *
 * This module is the deterministic backstop: regex patterns the LLM
 * never sees, server-side rule engine flags any output containing
 * them. Athlete-referee separation enforced.
 *
 * The patterns intentionally mirror the prompt's list 1:1 so the
 * "what's forbidden" definition has a single source of truth (this
 * file) — the prompt cites this list by reference (see the runtime
 * exporter `forbiddenPhrasesPromptBlock()` for the prompt-side text).
 *
 * Usage:
 *   - llm-claude.ts STRATEGY_SYSTEM imports forbiddenPhrasesPromptBlock()
 *     to embed the human-readable list into Claude's prompt
 *   - page-diagnostics.ts runs findForbiddenPhrasesInModules() at the
 *     post-validation pass to catch any phrase that slipped past
 *
 * Each rule has an `unless` field — a simple substring check against
 * the user's product inputs. If the user themselves typed "ROI 计算器"
 * into the wizard, the page CAN say "ROI 计算器" without false flag.
 */

export interface ForbiddenRule {
  /** Stable identifier for telemetry / banner deduplication. */
  id: string;
  /** Regex matched against the page output. case-insensitive. */
  pattern: RegExp;
  /** Human-readable description in zh-CN — surfaced in the editor banner. */
  reason: string;
  /** If any of these tokens appear verbatim in the user's product input
   *  (name / tagline / category / value), the rule is silenced. */
  unless?: readonly string[];
}

/**
 * The canonical forbidden-defaults list. Mirrors the markdown list
 * inside STRATEGY_SYSTEM in llm-claude.ts, at the same level of
 * specificity. New entries: add here AND add a regex case-insensitive
 * pattern.
 */
export const FORBIDDEN_DEFAULTS: readonly ForbiddenRule[] = [
  {
    id: 'hours-per-week',
    pattern: /每周\s*节省\s*\d+\s*小时|每周\s*省\s*\d+\s*小时|saves?\s+\d+\s+hours?\s+per\s+week|reclaim(?:s)?\s+\d+\s+hours?\s+(?:back|per\s+week)|give\s+(?:them|you)\s+\d+\s+hours?\s+back/i,
    reason: '"每周节省 X 小时 / saves N hours/week" 是模板默认 — 除非用户输入里写了，否则换具体的 outcome 描述',
    unless: ['每周', 'hours per week', 'reclaim', 'hours back'],
  },
  {
    id: 'roi-calculator',
    pattern: /ROI\s*计算器|ROI\s+calculator|TCO\s+calculator/i,
    reason: '"ROI 计算器" 通常是没人真做的 vapor-feature — 除非产品确实有，否则不要承诺',
    unless: ['ROI 计算器', 'ROI calculator', 'TCO calculator'],
  },
  {
    id: 'logo-wall',
    pattern: /logo\s*墙|logo\s+wall|trusted\s+by\s+(?:industry\s+leaders?|leading\s+(?:companies|teams|enterprises))/i,
    reason: '"logo 墙 / Trusted by industry leaders" 是 logo 占位的 placeholder — 用真实客户名替换',
    unless: ['logo 墙', 'logo wall'],
  },
  {
    id: 'productivity-boost',
    pattern: /提升\s*生产力\s*\d+\s*%|boost\s+productivity\s+by\s+\d+\s*%|\d+\s*[x×]\s+faster/i,
    reason: '"提升生产力 X% / N× faster" 是没产品锚点的 fluff — 用户没写就别编',
    unless: ['提升生产力', 'boost productivity', 'faster'],
  },
  {
    id: 'cross-functional',
    pattern: /跨\s*部门\s*协作|cross[-\s]functional\s+collaboration|break\s+down\s+silos/i,
    reason: '"跨部门协作 / break down silos" 几乎所有 SaaS 都说，已无差异化',
    unless: ['跨部门'],
  },
  {
    id: 'data-driven',
    pattern: /数据\s*驱动\s*决策|data[-\s]driven\s+decisions/i,
    reason: '"数据驱动决策" 是过度使用的 SaaS 套话',
    unless: ['数据驱动'],
  },
  {
    id: 'demo-and-trial',
    pattern: /演示\s*\+\s*免费试用|demo\s+(?:and|\+|or)\s+(?:free\s+)?trial/i,
    reason: '"演示 + 免费试用" 默认 CTA 组合 — 应改成单一明确的下一步',
    unless: ['演示', 'free trial'],
  },
  {
    id: 'mid-market-tech',
    pattern: /中型\s*科技\s*公司|mid[-\s]market\s+tech(?:nology)?\s+companies/i,
    reason: '"中型科技公司" 是用户输入未指定行业时的兜底 — 应是真实行业名',
    unless: ['中型', 'mid-market', 'tech companies', '科技公司'],
  },
];

/**
 * Page input shape for the unless-check. Uses string-input shape rather
 * than ProductInputs so the helper has zero coupling to the types module.
 */
export interface ProductSurface {
  name?: string;
  tagline?: string;
  category?: string;
  value?: string;
}

function userInputContains(input: ProductSurface | undefined, token: string): boolean {
  if (!input) return false;
  const haystack = [input.name, input.tagline, input.category, input.value]
    .filter((s): s is string => typeof s === 'string')
    .join(' ');
  return haystack.toLowerCase().includes(token.toLowerCase());
}

export interface ForbiddenHit {
  rule: ForbiddenRule;
  /** The first ~120-char snippet around the match for the editor banner. */
  snippet: string;
}

/**
 * Find forbidden default phrases in arbitrary text (typically a hero
 * headline / pain item / cta subhead). Filters out hits where the
 * user's own product input contains the phrase (legitimate use).
 *
 * Returns an empty array on no matches — caller can `if (hits.length)`.
 */
export function findForbiddenPhrases(text: string, input?: ProductSurface): ForbiddenHit[] {
  if (!text) return [];
  const hits: ForbiddenHit[] = [];
  for (const rule of FORBIDDEN_DEFAULTS) {
    const m = text.match(rule.pattern);
    if (!m) continue;
    const silenced = (rule.unless ?? []).some((tok) => userInputContains(input, tok));
    if (silenced) continue;
    const start = Math.max(0, (m.index ?? 0) - 30);
    const end = Math.min(text.length, (m.index ?? 0) + (m[0]?.length ?? 0) + 60);
    hits.push({
      rule,
      snippet: (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : ''),
    });
  }
  return hits;
}

/**
 * Returns a Markdown-formatted string suitable for embedding into the
 * STRATEGY_SYSTEM prompt. Produces the same content the prompt has
 * historically had inline; centralizing here ensures the runtime
 * post-check and the prompt list never drift.
 *
 * Format: numbered/bulleted list of "phrase pattern + short reason".
 */
export function forbiddenPhrasesPromptBlock(): string {
  const lines = FORBIDDEN_DEFAULTS.map((r) => {
    // Sample short patterns from the regex source to make the prompt
    // readable to the LLM (regex syntax in the prompt itself confuses
    // some models).
    const examples = r.pattern.source
      .split('|')
      .slice(0, 3)
      .map((s) => s.replace(/\\s\*?/g, ' ').replace(/\\s\+/g, ' ').replace(/\\d\+/g, 'N').replace(/[\\()?]/g, '').trim())
      .filter(Boolean)
      .map((s) => `"${s}"`)
      .join(' / ');
    return `- ${examples}`;
  });
  return lines.join('\n');
}

/**
 * Judge prompt construction (Phase 1 · pure functions, no LLM).
 *
 * The system prompt has 4 jobs:
 *   1. Establish "independent reader" persona (NOT the writer)
 *   2. Lay down the 5 hard output constraints
 *   3. Walk the model through the 6 rubric items as a checklist
 *   4. Force structured output via tool-use schema (defined here too)
 *
 * Per CLAUDE.md global §5: this prompt explicitly tells the model
 * NOT to evaluate "good vs bad" but to react as a buyer reading the
 * page. Reaction-style framing avoids the Goodhart trap of training
 * the writer to please a quality grader.
 *
 * Locale-aware framing matters: a JP CTO has different proof
 * preferences than a US CTO. Each locale gets its own persona blurb.
 */
import type { ProductInputs, PageLocale, PageModule } from './types';
import type { ExtractedContext } from './extract';
import { JUDGE_RULE_IDS, type JudgeRuleId } from './judge-types';

/**
 * Buyer persona per locale. Drives WHAT the judge looks for —
 * different markets weight proof differently. The persona blurbs
 * intentionally use the target locale's phrasing so the judge thinks
 * in-culture.
 */
const BUYER_PERSONA: Record<PageLocale, string> = {
  'zh-CN':
    '你是一位中国 SaaS 公司的 CTO / 业务负责人，正在评估一个新工具。' +
    '你的关注点：能否解决具体痛点、客户案例可信度、价格透明度、上手成本。' +
    '你 30 秒内会决定要不要看下去。语气：务实、追问数字、警惕空话。',
  'zh-TW':
    '你是一位台灣 SaaS 公司的 CTO / 業務負責人，正在評估一個新工具。' +
    '關注點：能否解決具體痛點、客戶案例可信度、價格透明度、上手成本。' +
    '你 30 秒內會決定要不要繼續看。語氣：務實、追問數字、警惕空話。',
  ja:
    'あなたは日本の SaaS 企業の CTO / 事業責任者で、新しいツールを評価中です。' +
    '重視するポイント：実績（導入社数）、運用負荷、セキュリティ、サポート体制。' +
    '誇張表現や数字の根拠が薄い主張は信頼を失います。30 秒で続きを読むか判断します。' +
    '日本語の読者として、過度な売り込みや英語からの直訳調を見抜いてください。',
  en:
    'You are a CTO / VP at a US tech company evaluating a new SaaS tool. ' +
    'You care about: ROI (concrete numbers), named customer logos, deployment speed, ' +
    'integration with what you already use. You scan in 30 seconds and decide ' +
    'whether to read on. Tone: pragmatic, ROI-driven, allergic to fluff.',
};

const RUBRIC_DESCRIPTIONS: Record<JudgeRuleId, string> = {
  'hero-anchors-number':
    '【必查】Hero (headline / subhead / bullets) 是否含具体数字、百分比、时间或量化结果？没有具体锚点的承诺读起来像通用 SaaS 模板。',
  'hero-anchors-product':
    '【必查】Hero 是否引用产品名、tagline 实际词汇或所属类别的具体名称？纯抽象描述不能让人记住"这是什么产品"。',
  'cross-module-coherence':
    '【整页结构】Pain → Solution → Benefits 这条叙事链是否扣回到同一组痛点 / 收益？跨模块的话题如果跳跃，读者建不起完整故事。',
  'cta-specific':
    '【转化点】Primary CTA 动词是否具体（"预约 30 分钟演示" / "开始 14 天试用"）？"了解更多 / Learn more / 詳細はこちら" 是默认值，没有承诺。',
  'locale-cultural-fit':
    '【市场契合】文案语气、证明方式、CTA 强度是否符合该 locale 市场的商业期待？JP 不应过度宣传；US 应有真实客户名；中文市场需要清晰的"为我而设"。',
  'trust-signals-present':
    '【信任元素】是否有可验证的社会证明？真实 logo / 带名字的 testimonial / 案例 / 认证 / 数字规模——任一缺失都让 B2B 决策更难。',
};

/**
 * Build the per-call system prompt. Composed of:
 *   - Persona (locale-specific buyer)
 *   - 5 hard output constraints
 *   - 6 rubric items as a self-checklist
 *
 * The user message (built separately by buildJudgeUserPrompt) carries
 * the actual page content + product inputs.
 */
export function buildJudgeSystemPrompt(locale: PageLocale): string {
  const persona = BUYER_PERSONA[locale] ?? BUYER_PERSONA.en;
  const rubric = JUDGE_RULE_IDS.map((id, i) => `${i + 1}. [${id}] ${RUBRIC_DESCRIPTIONS[id]}`).join('\n');

  return [
    persona,
    '',
    '## 你的角色',
    '',
    '你是独立的 evaluator。**不要评判"好坏"或打分**——而是写下：作为一个真实读者，',
    '你读到这页的具体反应、记不住什么、想追问什么、哪里跳出去。每条反应必须可执行——',
    '让运营拿到立刻知道下一步改什么。',
    '',
    '## 5 条硬约束（违反 = suggestion 被自动丢弃）',
    '',
    '1. **必须引用页面原文**：每条 suggestion 的 evidenceQuote 是你反应的那段原文（≤80 字符），不能空、不能改写。',
    '2. **必须给替代写法**：每条 suggestion 的 proposedReplacement 是你认为更好的具体文案，不是"建议改进"这种元描述。',
    '3. **必须复用用户素材**：每条 suggestion 的 reusedAssets 数组列出你用到的用户输入字段（"product.name" / "product.tagline" / "extracted.metrics[0]" / "extracted.namedCustomers[1]" 等）。**必须非空**——你不能凭空发明数字、客户名、卖点。如果用户没提供素材让你复用，omit this suggestion。',
    '4. **承认不知道**：看不到的信息（pricing / 客户规模 / 安全合规）就直说 "页面没看到 X"，不要编造判断。',
    '5. **可拒绝表达**：用 "如果你的产品..." / "可以试试..." 而非 "必须 / 应该 / 一定要"。读者可能有他自己的理由。',
    '',
    '## 6 个评估维度（self-checklist · 每条最多 1-2 个 suggestion）',
    '',
    rubric,
    '',
    '## 输出格式',
    '',
    '通过 emit_judge_report 工具输出。suggestions 数组每项严格遵守上面 5 条硬约束。' +
      '如果某个 ruleId 你检查后没有 finding，把它放进 rulesChecked 数组——这让用户知道你确实看了这条。' +
      '总 suggestion 数 ≤ 8（多了用户读不完，反而 dilute 重要的）。',
  ].join('\n');
}

/**
 * Build the per-call user prompt — page content + asset inventory.
 *
 * The asset inventory is the key device for hard-constraint #3:
 * we hand the model the EXACT material it can reuse, and the
 * validator checks suggestion.reusedAssets references against this
 * list afterwards.
 */
export function buildJudgeUserPrompt(
  modules: PageModule[],
  inputs: ProductInputs,
  context?: ExtractedContext,
): string {
  const assetLines: string[] = [];
  if (inputs.name) assetLines.push(`- product.name: "${inputs.name}"`);
  if (inputs.tagline) assetLines.push(`- product.tagline: "${inputs.tagline}"`);
  if (inputs.category) assetLines.push(`- product.category: "${inputs.category}"`);
  if (inputs.value) assetLines.push(`- product.value: "${inputs.value}"`);
  if (inputs.industry) assetLines.push(`- product.industry: "${inputs.industry}"`);
  if (inputs.role) assetLines.push(`- product.role (target audience): "${inputs.role}"`);
  if (context) {
    if (context.namedCustomers?.length) {
      context.namedCustomers.slice(0, 6).forEach((c, i) =>
        assetLines.push(`- extracted.namedCustomers[${i}]: "${c}"`),
      );
    }
    if (context.metrics?.length) {
      context.metrics.slice(0, 6).forEach((m, i) =>
        assetLines.push(`- extracted.metrics[${i}]: "${m}"`),
      );
    }
    if (context.features?.length) {
      context.features.slice(0, 6).forEach((f, i) =>
        assetLines.push(`- extracted.features[${i}]: "${f}"`),
      );
    }
    if (context.pains?.length) {
      context.pains.slice(0, 4).forEach((p, i) =>
        assetLines.push(`- extracted.pains[${i}]: "${p.slice(0, 100)}"`),
      );
    }
  }
  const assetBlock = assetLines.length
    ? assetLines.join('\n')
    : '(用户素材库为空——这种情况下你大概率只能输出 trust-signals-present / cta-specific 这种结构性 suggestion，不要凭空发明 reusedAssets)';

  const moduleBlock = modules
    .filter((m) => m.enabled !== false)
    .map((m, i) => {
      // Lean serialization — only the user-visible content fields, no
      // ids/metadata that pollute the prompt.
      return `### Module ${i} · ${m.type} (id=${m.id})\n` +
        '```json\n' +
        JSON.stringify(m.content, null, 2).slice(0, 1500) +
        '\n```';
    })
    .join('\n\n');

  return [
    '## User-typed product inputs (你能 reuse 的素材清单)',
    '',
    assetBlock,
    '',
    '## 当前 landing page 内容',
    '',
    moduleBlock,
    '',
    '现在以独立读者视角评估这页。每条 suggestion 必须满足 5 条硬约束。',
  ].join('\n');
}

/**
 * Tool-use schema for the judge's structured output. Anthropic + DeepSeek
 * both validate against this server-side, so a wrong-shape response is
 * extremely rare.
 */
export const JUDGE_TOOL_NAME = 'emit_judge_report';

export const JUDGE_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    suggestions: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          ruleId: {
            type: 'string' as const,
            enum: [...JUDGE_RULE_IDS],
            description: 'Which rubric item this suggestion is for',
          },
          severity: {
            type: 'string' as const,
            enum: ['high', 'med', 'low'],
          },
          moduleId: {
            type: 'string' as const,
            description: 'PageModule.id from the input',
          },
          fieldPath: {
            type: 'string' as const,
            description: 'Field within the module content (e.g. "subhead", "items[2].title")',
          },
          reason: {
            type: 'string' as const,
            description: 'Your reaction in first-person, ≤2 sentences',
          },
          evidenceQuote: {
            type: 'string' as const,
            description: 'Verbatim quote from the page content (≤80 chars)',
          },
          reusedAssets: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'Asset paths from the inventory you reused. Non-empty.',
          },
          proposedReplacement: {
            type: 'string' as const,
            description: 'Concrete alternative text the user can apply',
          },
        },
        required: [
          'ruleId',
          'severity',
          'moduleId',
          'fieldPath',
          'reason',
          'evidenceQuote',
          'reusedAssets',
          'proposedReplacement',
        ],
        additionalProperties: false,
      },
    },
    rulesChecked: {
      type: 'array' as const,
      items: { type: 'string' as const, enum: [...JUDGE_RULE_IDS] },
      description: 'Rubric ids you evaluated (some may have produced no findings)',
    },
  },
  required: ['suggestions', 'rulesChecked'],
  additionalProperties: false,
};

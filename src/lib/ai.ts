import type {
  ProductInputs,
  StrategySummary,
  PageModule,
  LocaleCode,
  MarketCode,
  CTAGoal,
  ToneKey,
  PageLocale,
  ModuleType,
} from './types';
import { nanoid } from 'nanoid';
import type { ExtractedContext } from './extract';
import {
  generateStrategyViaProvider,
  regenerateModuleViaProvider,
} from './llm-provider';
import { findTemplateModules } from './template-detection';

/**
 * Guard against users pasting a multi-paragraph "core value" into the hero
 * headline. We truncate to the first sentence (split on . / 。 / ! / ? /
 * newline) and hard-cap at `maxChars`. Without this, a 1245-char paste
 * became the H1 verbatim — visible in production as the zh-CN hero redline
 * "Hero 标题 1245 字, 偏长". Kept even with Claude wired because Claude
 * can still fail / fall back to template under the graceful-degradation
 * contract, and template must never render raw body-text as a headline.
 */
function firstSentence(text: string | undefined, maxChars: number): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^[^.。！？!?\n]+[.。！？!?]?/);
  const head = (match ? match[0] : trimmed).trim();
  if (head.length <= maxChars) return head;
  return head.slice(0, maxChars - 1).trimEnd() + '…';
}

// --- Localized snippets --------------------------------------------------

const L = {
  en: {
    eyebrow: (cat: string) => (cat ? cat.toUpperCase() : 'PRODUCT'),
    headlineTmpl: (name: string, value: string) =>
      value ? `${value}` : `${name}, built for results.`,
    subheadTmpl: (tagline: string, name: string) =>
      tagline || `${name} helps your team ship outcomes — not more work.`,
    bullets: (value: string) => [
      'Up and running in minutes',
      'Built for fast-moving teams',
      value ? `Outcome: ${value.split('。')[0].split('.')[0]}` : 'Measurable ROI from week one',
    ],
    ctaLabels: {
      demo: 'Book a Demo',
      trial: 'Start Free Trial',
      download: 'Download the Guide',
      contact: 'Talk to Sales',
      quote: 'Get a Custom Quote',
    } as Record<CTAGoal, string>,
    trustTitle: 'Trusted by high-performing teams',
    painTitle: 'The old way isn’t working',
    painItems: [
      { title: 'Manual work eats your week', body: 'Spreadsheets and context-switching quietly kill momentum.' },
      { title: 'Tools don’t talk to each other', body: 'Stitched-together stacks lose data and trust.' },
      { title: 'Slow feedback loops', body: 'By the time you see the metric, the quarter is over.' },
    ],
    solutionTitle: 'A single place that just works',
    solutionBody:
      'Bring your product info, audience, and materials — get a localized, conversion-ready page. Edit anything, publish, collect leads.',
    benefitsTitle: 'Why teams switch',
    benefits: [
      { title: 'Faster time-to-page', body: 'From brief to live page in an afternoon, not a sprint.' },
      { title: 'Localized, not translated', body: 'Tone and structure adapt to each market — JP ≠ US.' },
      { title: 'Conversion-first modules', body: 'Every block exists to move a visitor forward.' },
    ],
    useCaseTitle: 'Built for these people',
    useCases: [
      { role: 'Product Marketing', scenario: 'Launching a product in a new market without waiting on design.' },
      { role: 'Demand Gen', scenario: 'Spinning up per-campaign pages without burning dev cycles.' },
      { role: 'Founder', scenario: 'Running 3 products with 1 designer — and shipping anyway.' },
    ],
    testimonialTitle: 'What customers say',
    testimonials: [
      { quote: 'We shipped four localized pages in one week. That used to be a quarter.', author: 'Alex M.', company: 'VP Marketing' },
      { quote: 'The strategy summary alone stopped us from launching a weak page.', author: 'Riko T.', company: 'Head of Growth' },
    ],
    faqTitle: 'Frequently Asked',
    faqs: [
      { q: 'How long until my page is live?', a: 'Usually the same day. Inputs → strategy → generated modules → edit → publish.' },
      { q: 'Does it really localize, not just translate?', a: 'Yes — tone, CTA intensity, and even module order adapt per market.' },
      { q: 'Where are my leads stored?', a: 'In your project dashboard, exportable. Integrations with HubSpot, Salesforce, and webhooks are supported.' },
      { q: 'Can I use my own domain?', a: 'Yes. Each project can attach a custom domain with SSL.' },
    ],
    ctaHeadline: 'Ready to ship your page?',
    ctaSub: 'Start with a single product — add more any time.',
    formTitle: 'Get started',
    formSub: 'Tell us a bit about your team. We’ll get back within one business day.',
  },
  'zh-CN': {
    eyebrow: (cat: string) => (cat || '产品').toUpperCase(),
    headlineTmpl: (name: string, value: string) => value || `${name}，为结果而生。`,
    subheadTmpl: (tagline: string, name: string) =>
      tagline || `${name} 让团队产出结果，而不是堆叠工作。`,
    bullets: (value: string) => [
      '几分钟内上线',
      '为快节奏团队设计',
      value ? `结果：${value.split('。')[0].split('.')[0]}` : '从第一周就能衡量 ROI',
    ],
    ctaLabels: {
      demo: '预约演示',
      trial: '免费试用',
      download: '下载资料',
      contact: '联系销售',
      quote: '获取报价',
    } as Record<CTAGoal, string>,
    trustTitle: '已被高绩效团队采用',
    painTitle: '旧的做法已经不管用',
    painItems: [
      { title: '手工活吃掉整周', body: '表格和频繁切换在悄悄消耗团队势能。' },
      { title: '工具之间不互通', body: '拼凑的工具栈让数据与信任一起丢失。' },
      { title: '反馈链路太长', body: '当你看到指标，季度已经结束。' },
    ],
    solutionTitle: '一个地方把事情做完',
    solutionBody: '输入产品信息、受众和资料 — 拿到一张本地化、围绕转化的落地页。随时编辑、发布、收集线索。',
    benefitsTitle: '为什么团队会切换过来',
    benefits: [
      { title: '更快的上线速度', body: '从 brief 到上线一下午，不是一个 sprint。' },
      { title: '本地化而非翻译', body: '日本 ≠ 北美，语气、结构都要换。' },
      { title: '以转化为导向的模块', body: '每个模块都有明确的转化角色。' },
    ],
    useCaseTitle: '适合这些人',
    useCases: [
      { role: '产品市场', scenario: '在新市场上线产品，不用排队等设计。' },
      { role: '获客团队', scenario: '按活动快速上多个页面，不占用研发。' },
      { role: '创业者', scenario: '一个设计师撑三条产品线，仍然能按节奏上线。' },
    ],
    testimonialTitle: '客户评价',
    testimonials: [
      { quote: '一周上线 4 个本地化页面，以前要一个季度。', author: '赵敏', company: '市场 VP' },
      { quote: '光是策略摘要那一步就拦住了一个烂页面。', author: 'Riko', company: '增长负责人' },
    ],
    faqTitle: '常见问题',
    faqs: [
      { q: '多久能上线？', a: '通常当天完成：输入 → 策略 → 生成模块 → 编辑 → 发布。' },
      { q: '真的是本地化而不是翻译？', a: '是。语气、CTA 力度、甚至模块顺序都会随市场变。' },
      { q: '线索存在哪里？', a: '项目后台，可导出。支持 HubSpot、Salesforce、Webhook。' },
      { q: '可以用自己的域名吗？', a: '可以。每个项目都能绑定自定义域名并自动配 SSL。' },
    ],
    ctaHeadline: '准备好上线了吗？',
    ctaSub: '从一个产品开始，之后随时加。',
    formTitle: '开始使用',
    formSub: '留下基本信息，一个工作日内我们会联系你。',
  },
  'zh-TW': {
    eyebrow: (cat: string) => (cat || '產品').toUpperCase(),
    headlineTmpl: (name: string, value: string) => value || `${name},為結果而生。`,
    subheadTmpl: (tagline: string, name: string) =>
      tagline || `${name} 讓團隊產出結果,而不是堆疊工作。`,
    bullets: (value: string) => [
      '幾分鐘內上線',
      '為快節奏團隊設計',
      value ? `結果:${value.split('。')[0].split('.')[0]}` : '第一週就能衡量 ROI',
    ],
    ctaLabels: {
      demo: '預約演示',
      trial: '免費試用',
      download: '下載資料',
      contact: '聯絡銷售',
      quote: '獲取報價',
    } as Record<CTAGoal, string>,
    trustTitle: '已被高績效團隊採用',
    painTitle: '舊的做法已經不管用',
    painItems: [
      { title: '手動作業吃掉整週', body: '試算表和頻繁切換在悄悄消耗團隊動能。' },
      { title: '工具之間不互通', body: '拼湊的工具鏈讓數據與信任一起流失。' },
      { title: '回饋鏈路太長', body: '當你看到指標,季度已經結束。' },
    ],
    solutionTitle: '一個地方把事情做完',
    solutionBody: '輸入產品資訊、受眾與資料 — 取得一張在地化、以轉化為核心的落地頁。隨時編輯、發布、收集名單。',
    benefitsTitle: '為什麼團隊會切換過來',
    benefits: [
      { title: '更快的上線速度', body: '從 brief 到上線一下午,不是一個 sprint。' },
      { title: '在地化而非翻譯', body: '日本 ≠ 北美,語氣、結構都要換。' },
      { title: '以轉化為導向的模組', body: '每個模組都有明確的轉化角色。' },
    ],
    useCaseTitle: '適合這些人',
    useCases: [
      { role: '產品行銷', scenario: '在新市場上線產品,不用排隊等設計。' },
      { role: '獲客團隊', scenario: '按活動快速上多個頁面,不佔用研發。' },
      { role: '創業者', scenario: '一位設計師撐三條產品線,仍然能按節奏上線。' },
    ],
    testimonialTitle: '客戶評價',
    testimonials: [
      { quote: '一週上線 4 個在地化頁面,以前要一個季度。', author: '趙敏', company: '行銷 VP' },
      { quote: '光是策略摘要那一步就擋住了一個差的頁面。', author: 'Riko', company: '增長負責人' },
    ],
    faqTitle: '常見問題',
    faqs: [
      { q: '多久能上線?', a: '通常當天完成:輸入 → 策略 → 產生模組 → 編輯 → 發布。' },
      { q: '真的是在地化而不是翻譯?', a: '是。語氣、CTA 力度、甚至模組順序都會隨市場變。' },
      { q: '名單存在哪裡?', a: '專案後台,可匯出。支援 HubSpot、Salesforce、Webhook。' },
      { q: '可以用自己的網域嗎?', a: '可以。每個專案都能綁定自訂網域並自動配 SSL。' },
    ],
    ctaHeadline: '準備好上線了嗎?',
    ctaSub: '從一個產品開始,之後隨時加。',
    formTitle: '開始使用',
    formSub: '留下基本資訊,一個工作日內我們會聯絡你。',
  },
  ja: {
    eyebrow: (cat: string) => (cat || 'PRODUCT').toUpperCase(),
    headlineTmpl: (name: string, value: string) =>
      value || `${name}、成果のために。`,
    subheadTmpl: (tagline: string, name: string) =>
      tagline || `${name} はチームに「作業」ではなく「成果」を届けます。`,
    bullets: (value: string) => [
      '数分で立ち上がる',
      'スピード重視のチームのために設計',
      value ? `成果:${value.split('。')[0].split('.')[0]}` : '初週から測定できる ROI',
    ],
    ctaLabels: {
      demo: 'デモを予約',
      trial: '無料で試す',
      download: '資料をダウンロード',
      contact: '営業に相談',
      quote: '見積もりを取得',
    } as Record<CTAGoal, string>,
    trustTitle: '成果志向のチームが採用しています',
    painTitle: '従来のやり方では限界です',
    painItems: [
      { title: '手作業が週を奪う', body: 'スプレッドシートと切り替えが静かに勢いを削ります。' },
      { title: 'ツール同士がつながらない', body: '寄せ集めのスタックはデータと信頼を失います。' },
      { title: 'フィードバックが遅い', body: '指標が見える頃には四半期が終わっています。' },
    ],
    solutionTitle: 'ひとつの場所で完結',
    solutionBody: '製品情報・ターゲット・資料を渡せば、ローカライズ済み・コンバージョン設計済みのページが手に入ります。編集・公開・リード獲得まで。',
    benefitsTitle: 'なぜ乗り換えるのか',
    benefits: [
      { title: 'ページが早く立ち上がる', body: 'ブリーフから公開まで半日。スプリントではなく。' },
      { title: '翻訳ではなくローカライズ', body: 'JP ≠ US、トーンも構成も市場ごとに変わります。' },
      { title: 'コンバージョン起点のモジュール', body: 'どのブロックにも明確な役割があります。' },
    ],
    useCaseTitle: 'こんな方におすすめ',
    useCases: [
      { role: 'プロダクトマーケティング', scenario: '新市場のローンチをデザインの順番待ちなく進めたい。' },
      { role: 'デマンドジェン', scenario: 'キャンペーン別ページを開発リソースなしで量産したい。' },
      { role: '創業者', scenario: 'デザイナー 1 名で 3 プロダクトを動かしている。' },
    ],
    testimonialTitle: 'お客様の声',
    testimonials: [
      { quote: '1 週間で 4 本のローカライズページを公開。以前は 1 四半期かかっていました。', author: '田中 リコ', company: 'グロース責任者' },
      { quote: '戦略サマリーの段階で、弱いページを出さずに済みました。', author: 'Alex M.', company: 'マーケティング VP' },
    ],
    faqTitle: 'よくあるご質問',
    faqs: [
      { q: '公開までどれくらい?', a: '通常は当日中です。入力 → 戦略 → モジュール生成 → 編集 → 公開。' },
      { q: '翻訳ではなく本当にローカライズ?', a: 'はい。トーン、CTA の強さ、モジュール順まで市場に合わせます。' },
      { q: 'リードはどこに保存される?', a: 'プロジェクトのダッシュボードで管理・エクスポート可能です。HubSpot/Salesforce/Webhook にも対応。' },
      { q: '独自ドメインは使えますか?', a: 'はい。各プロジェクトにドメインを接続し、SSL も自動設定されます。' },
    ],
    ctaHeadline: '公開の準備はできていますか?',
    ctaSub: 'まずは 1 製品から。いつでも追加できます。',
    formTitle: 'はじめる',
    formSub: 'チームの情報を少しだけ。1 営業日以内にご連絡します。',
  },
} as const;

// --- Market-specific tweaks ---------------------------------------------

const marketStrategyText = (market: MarketCode, locale: LocaleCode): string[] => {
  const M = {
    JP: {
      en: [
        'Trust signals first, CTA restraint, clean composition',
        'Emphasize onboarding support, reliability, and detailed specs',
        'Avoid aggressive urgency; prefer calm expertise',
      ],
      'zh-CN': ['信任优先、CTA 克制、版面整洁', '强调导入与支援、稳定性与规格', '避免强行紧迫感，用从容的专业感'],
      'zh-TW': ['信任優先、CTA 克制、版面整潔', '強調導入與支援、穩定性與規格', '避免過強的緊迫感,用從容的專業感'],
      ja: ['信頼が先、CTA は控えめ、構成は整然', '導入支援・信頼性・スペックを明示', '過度な煽りは避け、落ち着いた専門性'],
    },
    US: {
      en: ['ROI first, bold CTA, fast value delivery', 'Lead with outcomes, not features', 'Use concrete numbers and short sentences'],
      'zh-CN': ['ROI 优先、CTA 强烈、快速传递价值', '先讲结果不讲功能', '用具体数字和短句'],
      'zh-TW': ['ROI 優先、CTA 強烈、快速傳遞價值', '先講結果不講功能', '用具體數字和短句'],
      ja: ['ROI ファースト、CTA は強め、価値を素早く伝える', '機能より成果を先に', '具体的な数字と短い文章'],
    },
    CN: {
      en: ['Efficiency-driven, feature-clear, strong case studies', 'Information density is expected', 'Localize numbers and entity names'],
      'zh-CN': ['提效导向、功能清晰、案例背书强', '信息密度可以高一些', '数字和实体要本土化'],
      'zh-TW': ['效率導向、功能清晰、案例背書強', '資訊密度可以高一些', '數字和實體要在地化'],
      ja: ['効率重視、機能を明確に、事例を強く', '情報密度は高めで OK', '数字や固有名詞はローカライズ'],
    },
    TW: {
      en: ['Professional, steady, governance-minded', 'Emphasize reliability and compliance', 'Tone: confident but not pushy'],
      'zh-CN': ['专业、稳健、重视治理', '强调可靠性与合规', '语气：有底气但不压迫'],
      'zh-TW': ['專業、穩健、重視治理', '強調可靠性與合規', '語氣:有底氣但不壓迫'],
      ja: ['プロフェッショナル、安定、ガバナンス志向', '信頼性とコンプライアンスを強調', 'トーン:自信はあるが押し付けない'],
    },
    EU: {
      en: ['Privacy-first, regulation-aware, understated', 'Lead with data handling and compliance', 'Avoid hyperbole'],
      'zh-CN': ['隐私优先、合规感强、语气克制', '先讲数据处理与合规', '少用夸张表达'],
      'zh-TW': ['隱私優先、合規感強、語氣克制', '先講資料處理與合規', '少用誇張表達'],
      ja: ['プライバシーファースト、規制意識、控えめな表現', 'データ取扱と遵法を先に', '誇張表現を避ける'],
    },
    GLOBAL: {
      en: ['Balanced tone, universal examples, neutral references', 'Currency and time zones made explicit', 'Imagery reads across cultures'],
      'zh-CN': ['语气折中、例子通用、表述中立', '明示货币与时区', '图像跨文化可读'],
      'zh-TW': ['語氣折中、例子通用、表述中立', '明示貨幣與時區', '圖像跨文化可讀'],
      ja: ['バランスのとれたトーン、普遍的な例、中立的な表現', '通貨と時差を明示', '文化を越えて読めるビジュアル'],
    },
  } as const;
  return [...(M[market] ?? M.GLOBAL)[locale]];
};

// --- Strategy generator -------------------------------------------------

/**
 * Strategy generation — Claude only. No template fallback.
 *
 * History: this function used to auto-fall-back to generateStrategyTemplated
 * when no ANTHROPIC_API_KEY was set, which meant the product shipped generic
 * SaaS-playbook strategy under the "AI-generated strategy" label. The user
 * called that a 遮羞布 (fig leaf). Now the adapter throws LLMRequiredError /
 * LLMCallError and this function propagates — the route handler maps to
 * 503/502 with a structured body so the UI can surface WHY strategy
 * generation failed instead of pretending it succeeded.
 *
 * generateStrategyTemplated is still exported for tests and for callers
 * who explicitly OPT IN to template output (e.g. seed data). It is no
 * longer reached automatically.
 */
export async function generateStrategy(
  inputs: ProductInputs,
  context?: ExtractedContext,
  onTrace?: (t: { primary: string; used: string; hops: any[] }) => void,
): Promise<StrategySummary> {
  // Provider routing lives in llm-provider.ts. JP defaults to Claude for
  // quality, everything else defaults to DeepSeek for cost; see
  // CLAUDE.md §2.1 for the cost/quality tradeoff rationale.
  return generateStrategyViaProvider(inputs, context, onTrace as any);
}

/**
 * Deterministic template-based strategy. Exported for tests / seed data /
 * explicit template-mode callers. NOT invoked automatically on LLM failure
 * anymore — see generateStrategy doc comment.
 */
export function generateStrategyTemplated(
  inputs: ProductInputs,
  context?: ExtractedContext,
): StrategySummary {
  const locale = inputs.locale;
  const T = L[locale];
  const cta = T.ctaLabels[inputs.cta];

  const audienceByLocale: Record<LocaleCode, string[]> = {
    en: [
      `Ideal visitor: ${inputs.role || 'decision-maker'} at ${inputs.companySize || 'growth-stage'} ${inputs.industry || 'companies'}.`,
      `Buying stage: evaluating, comparing 2–3 options.`,
      `Top concerns: time-to-value, integration risk, team adoption.`,
      `Trust triggers: named customers, concrete ROI, security posture.`,
      `Likely objections: "will this fit our stack?", "who owns onboarding?", "what does it cost at our size?".`,
    ],
    'zh-CN': [
      `理想访客：${inputs.companySize || '成长期'}${inputs.industry || ''}的${inputs.role || '决策者'}。`,
      `所处阶段：正在评估，对比 2–3 个选项。`,
      `最关心：能多快见效、集成风险、团队能否用起来。`,
      `信任触发：有名客户、具体 ROI、安全合规。`,
      `常见异议：能不能接入我们现有系统？谁负责导入？在我们规模下多少钱？`,
    ],
    'zh-TW': [
      `理想訪客:${inputs.companySize || '成長期'}${inputs.industry || ''}的${inputs.role || '決策者'}。`,
      `所處階段:正在評估,比較 2–3 個選項。`,
      `最在意:多快見效、整合風險、團隊能否上手。`,
      `信任觸發:知名客戶、具體 ROI、安全合規。`,
      `常見異議:能否接入現有系統?誰負責導入?在我們規模下多少錢?`,
    ],
    ja: [
      `理想の訪問者:${inputs.companySize || '成長期'}${inputs.industry || ''}の${inputs.role || '意思決定者'}。`,
      `検討フェーズ:比較検討中、2〜3 候補を評価。`,
      `関心事:価値実現までの時間、導入リスク、社内定着。`,
      `信頼材料:既存顧客名、具体的 ROI、セキュリティ体制。`,
      `よくある懸念:既存スタックに合うか/導入担当は誰か/自社規模での費用。`,
    ],
  };

  const goalByLocale: Record<LocaleCode, string[]> = {
    en: [
      `Primary CTA: ${cta} (exactly one per page).`,
      `Secondary CTA: Download reference material, keep it low-friction.`,
      `Form length: 3–4 fields max to preserve conversion.`,
      `Urgency: moderate; emphasize clarity over pressure.`,
    ],
    'zh-CN': [
      `一级 CTA：${cta}（每页只允许一个）。`,
      `二级 CTA：下载资料或白皮书，降低启动门槛。`,
      `表单长度：3–4 个字段，保护转化率。`,
      `紧迫度：中等，重在讲清楚而非施压。`,
    ],
    'zh-TW': [
      `一級 CTA:${cta}(每頁只允許一個)。`,
      `二級 CTA:下載資料或白皮書,降低啟動門檻。`,
      `表單長度:3–4 個欄位,保護轉化率。`,
      `緊迫度:中等,重在講清楚而非施壓。`,
    ],
    ja: [
      `一次 CTA:${cta}(1 ページにつき 1 つだけ)。`,
      `二次 CTA:資料ダウンロード、導入のハードルを下げる。`,
      `フォーム項目:3〜4 項目まで、CVR を守る。`,
      `訴求強度:中。押しつけより明瞭さを優先。`,
    ],
  };

  const narrativeByLocale: Record<LocaleCode, string[]> = {
    en: [
      inputs.source === 'seo'
        ? `Lead with the problem — SEO visitors came for the question.`
        : `Lead with the outcome — paid/social visitors need a promise fast.`,
      `Emotional hook: loss of time and compound cost of stitched tools.`,
      `Rational hook: named outcomes + a before/after.`,
      `Best proof: a short quote + one concrete metric.`,
    ],
    'zh-CN': [
      inputs.source === 'seo'
        ? `先讲痛点——SEO 访客带着问题进来。`
        : `先讲结果——广告/社交访客需要快速承诺。`,
      `情绪钩子：时间损耗与拼凑工具的复利成本。`,
      `理性钩子：具体结果 + before/after。`,
      `最佳证明：短客户原话 + 一个具体指标。`,
    ],
    'zh-TW': [
      inputs.source === 'seo'
        ? `先講痛點—SEO 訪客帶著問題進來。`
        : `先講結果—廣告/社群訪客需要快速承諾。`,
      `情緒鉤子:時間損耗與拼湊工具的複利成本。`,
      `理性鉤子:具體結果 + before/after。`,
      `最佳證明:短客戶原話 + 一個具體指標。`,
    ],
    ja: [
      inputs.source === 'seo'
        ? `先に課題提起 — SEO 流入は問いを持って来ています。`
        : `先に成果提示 — 広告/SNS 流入には素早い約束を。`,
      `感情フック:失われる時間と、継ぎ接ぎのツールが積む複利コスト。`,
      `論理フック:具体的な成果 + before/after。`,
      `最適な証明:短い顧客の声 + 1 つの具体指標。`,
    ],
  };

  const strategy: StrategySummary = {
    audience: audienceByLocale[locale],
    goal: goalByLocale[locale],
    narrative: narrativeByLocale[locale],
    local: marketStrategyText(inputs.market, locale),
  };

  // Ground the strategy with extracted facts (customer names / metrics / pains).
  // This is what fixes the "AI 策略完全没吸收上传资料" complaint.
  if (context && context.textLength > 0) {
    if (context.namedCustomers.length) {
      strategy.audience.unshift(
        locale === 'en'
          ? `Named customers to reference: ${context.namedCustomers.slice(0, 5).join(', ')}`
          : locale === 'ja'
            ? `既知の顧客名:${context.namedCustomers.slice(0, 5).join('・')}`
            : `已知客户：${context.namedCustomers.slice(0, 5).join('、')}`,
      );
    }
    if (context.metrics.length) {
      strategy.narrative.unshift(
        locale === 'en'
          ? `Lead with real numbers from your content: ${context.metrics.slice(0, 3).join(' · ')}`
          : locale === 'ja'
            ? `素材から抽出した実数値を前面に:${context.metrics.slice(0, 3).join(' · ')}`
            : `用素材中的真实数字做主证据：${context.metrics.slice(0, 3).join(' · ')}`,
      );
    }
    if (context.pains.length) {
      strategy.narrative.push(
        locale === 'en'
          ? `Pain phrases surfaced in inputs — reuse them verbatim: "${context.pains[0].slice(0, 80)}"`
          : locale === 'ja'
            ? `入力から拾った痛点表現をそのまま使う:"${context.pains[0].slice(0, 60)}"`
            : `从素材里抓到的痛点原话，建议直接用："${context.pains[0].slice(0, 60)}"`,
      );
    }
    if (context.features.length) {
      strategy.goal.push(
        locale === 'en'
          ? `Anchor benefits to the top features you mentioned: ${context.features.slice(0, 3).join(' · ')}`
          : locale === 'ja'
            ? `ベネフィットの軸は素材の主要機能に揃える:${context.features.slice(0, 3).join(' · ')}`
            : `收益文案围绕素材里的重点功能：${context.features.slice(0, 3).join(' · ')}`,
      );
    }
    if (context.personas.length) {
      strategy.audience.push(
        locale === 'en'
          ? `Personas surfaced in content: ${context.personas.slice(0, 3).join(' · ')}`
          : locale === 'ja'
            ? `素材に登場したペルソナ:${context.personas.slice(0, 3).join('・')}`
            : `素材里出现的角色：${context.personas.slice(0, 3).join('、')}`,
      );
    }
  }

  return strategy;
}

// --- Tone-specific module whitelist (Helios-style enterprise-b2b) ------
//
// The default SaaS stack is 10 modules: hero → socialProof → pain → solution
// → benefits → useCase → testimonial → faq → cta → form. That's right for
// cold SMB traffic that needs pain-agitation and FAQ to remove objections.
//
// `enterprise-b2b` (Helios-style) is a different shape entirely: the buyer
// is arriving warm via sales/brand, so we cut pain/useCase/testimonial/
// faq and push logos+stats as two separate trust bands sandwiching the
// product showcase. Form becomes mode='external' — CTA to a飞书/Typeform
// URL, no inline fields.
//
// Unknown tones fall back to the full set (safe default).
export function moduleSetForTone(
  tone: ToneKey,
): { types: ModuleType[]; socialProofVariants: ReadonlyArray<'logos-and-stats' | 'logos-only' | 'stats-only'>; formMode: 'inline' | 'external' } {
  if (tone === 'enterprise-b2b') {
    return {
      // Two socialProof bands — first one for logos, second for stats.
      // productShowcase carries the product screenshots (the big bet).
      types: ['hero', 'socialProof', 'productShowcase', 'socialProof', 'cta', 'form'],
      socialProofVariants: ['logos-only', 'stats-only'],
      formMode: 'external',
    };
  }
  return {
    types: [
      'hero',
      'socialProof',
      'pain',
      'solution',
      'benefits',
      'useCase',
      'testimonial',
      'faq',
      'cta',
      'form',
    ],
    socialProofVariants: ['logos-and-stats'],
    formMode: 'inline',
  };
}

// --- Dual narrative module generator (PRD §4.3) -----------------------

export type NarrativeVariant = 'A' | 'B';

/**
 * Variant A — Pain-Agitate-Solve:
 *   Leads with painful status quo, amplifies the cost of inaction,
 *   then presents the solution as relief.
 *   Module order: Hero → Pain → Solution → Benefits → Testimonial → FAQ → CTA → Form
 *   Hero tone: loss-aversion, concrete cost numbers.
 *
 * Variant B — Benefit-Focused:
 *   Leads with aspirational outcome, shows ROI upfront,
 *   then explains how to get there.
 *   Module order: Hero → SocialProof → Benefits → UseCase → Testimonial → FAQ → CTA → Form
 *   Hero tone: outcome-first, numbers-forward.
 */
export function generateVariants(
  inputs: ProductInputs,
  tone: ToneKey,
  strategy?: StrategySummary,
  context?: ExtractedContext,
): { A: PageModule[]; B: PageModule[] } {
  const baseA = generateModules(inputs, tone, strategy, context);
  const baseB = generateModules(inputs, tone, strategy, context);

  // enterprise-b2b: Helios-style compact stack. Both variants share the
  // same order — we differentiate only by hero eyebrow (see tintHero).
  // The extra productShowcase is seeded here because generateModules()
  // doesn't produce it by default.
  if (tone === 'enterprise-b2b') {
    const a = buildEnterpriseB2BStack(baseA, inputs);
    const b = buildEnterpriseB2BStack(baseB, inputs);
    tintHeroForVariant(a, 'A', inputs);
    tintHeroForVariant(b, 'B', inputs);
    applyStrategyToModules(a, strategy);
    applyStrategyToModules(b, strategy);
    applyContextToModules(a, context);
    applyContextToModules(b, context);
    return { A: a, B: b };
  }

  // Variant A — pain-first
  const a = reorder(baseA, ['hero', 'socialProof', 'pain', 'solution', 'benefits', 'useCase', 'testimonial', 'faq', 'cta', 'form']);
  tintHeroForVariant(a, 'A', inputs);
  applyStrategyToModules(a, strategy);
  applyContextToModules(a, context);

  // Variant B — benefit-first (skip pain, lead with social proof + benefits)
  const b = reorder(baseB, ['hero', 'socialProof', 'benefits', 'useCase', 'solution', 'testimonial', 'faq', 'cta', 'form']);
  tintHeroForVariant(b, 'B', inputs);
  applyStrategyToModules(b, strategy);
  applyContextToModules(b, context);

  return { A: a, B: b };
}

/**
 * Build the Helios-style compact stack: hero → logo wall → product
 * showcase → stats band → cta → external form.
 *
 * Reuses the templated modules generateModules() already produced:
 *   - keeps the hero / cta / form / socialProof it built
 *   - splits the single socialProof into two (logos-only + stats-only)
 *   - inserts a productShowcase seeded for the product's locale
 *   - marks the form mode='external' (externalUrl stays empty for the
 *     user to fill in the editor — rendering logic handles empty URL)
 */
function buildEnterpriseB2BStack(base: PageModule[], inputs: ProductInputs): PageModule[] {
  const find = (t: ModuleType) => base.find((m) => m.type === t);
  const hero = find('hero');
  const socialProof = find('socialProof');
  const ctaMod = find('cta');
  const formMod = find('form');

  if (!hero || !socialProof || !ctaMod || !formMod) {
    // Should never happen — generateModules always emits these. If one
    // goes missing, fall back to the full stack so the user isn't left
    // with a blank page.
    return base;
  }

  // Clone socialProof into two: logo wall at top, stats band near bottom
  const logoBand: PageModule = {
    id: nanoid(8),
    type: 'socialProof',
    enabled: true,
    content: {
      ...(socialProof.content as any),
      variant: 'logos-only',
    },
  };
  const statsBand: PageModule = {
    id: nanoid(8),
    type: 'socialProof',
    enabled: true,
    content: {
      ...(socialProof.content as any),
      variant: 'stats-only',
    },
  };

  // Seed a productShowcase — this is the module carrying the screenshot
  // weight in a Helios-style page. User can swap in their real media later.
  const seeded = seedProductShowcase(inputs);
  const productShowcase: PageModule = {
    id: nanoid(8),
    type: 'productShowcase',
    enabled: true,
    content: {
      title: seeded.title,
      subtitle: seeded.subtitle,
      items: seeded.items.slice(0, 2), // Helios uses two side-by-side cards
    },
  };

  // Form → external mode. externalUrl stays blank; editor UI prompts user
  // to paste their 飞书 / Typeform / Calendly link. Renderer falls back to
  // inline form if externalUrl is empty so partial setups still work.
  const externalForm: PageModule = {
    ...formMod,
    content: {
      ...(formMod.content as any),
      mode: 'external',
      externalUrl: '',
    },
  };

  return [hero, logoBand, productShowcase, statsBand, ctaMod, externalForm];
}

/**
 * Inject extracted facts into module content: replace placeholder logos with
 * real named customers, replace placeholder metrics with real numbers, replace
 * hero bullets with feature phrases extracted from the user's materials.
 */
function applyContextToModules(modules: PageModule[], context?: ExtractedContext) {
  if (!context) return;

  // Social proof: a page may have multiple socialProof modules with
  // different variants (enterprise-b2b has a logos-only band AND a
  // stats-only band). Route logos into bands that render logos, and
  // stats into bands that render stats. Bands without an explicit
  // variant default to 'logos-and-stats', which renders both.
  const socialProofs = modules.filter((m) => m.type === 'socialProof');
  if (context.namedCustomers.length >= 3) {
    for (const sp of socialProofs) {
      const c = sp.content as any;
      const variant = c.variant ?? 'logos-and-stats';
      if (variant === 'stats-only') continue; // doesn't render logos
      c.logos = context.namedCustomers.slice(0, 6);
    }
  }
  if (context.metrics.length >= 2) {
    const stats = context.metrics.slice(0, 3).map((m) => ({
      label: inferLabelFromMetric(m),
      value: m,
    }));
    for (const sp of socialProofs) {
      const c = sp.content as any;
      const variant = c.variant ?? 'logos-and-stats';
      if (variant === 'logos-only') continue; // doesn't render stats
      c.stats = stats;
    }
  }

  // Hero bullets → feature phrases from source material
  if (context.features.length >= 2) {
    const hero = modules.find((m) => m.type === 'hero');
    if (hero) {
      const c = hero.content as any;
      c.bullets = context.features.slice(0, 3);
    }
  }

  // Pain module → real pain phrases from user content
  if (context.pains.length >= 2) {
    const pain = modules.find((m) => m.type === 'pain');
    if (pain) {
      const c = pain.content as any;
      c.items = context.pains.slice(0, 3).map((p) => ({
        title: (p.match(/^[^,。，.]+/) ?? [p])[0].slice(0, 30),
        body: p.slice(0, 160),
      }));
    }
  }
}

function inferLabelFromMetric(metric: string): string {
  if (/ROI|倍/i.test(metric)) return 'ROI';
  if (/hour|hr|时|小时|時間/i.test(metric)) return '每周节省';
  if (/%/i.test(metric)) return '提升';
  if (/team|customers|用户|团队/i.test(metric)) return '客户';
  if (/\$|¥/i.test(metric)) return '节省';
  return '';
}

/**
 * Strategy → Module pipeline.
 *
 * The strategy summary contains 4 sections: audience, goal, narrative, local.
 * Each feeds specific modules:
 *   - goal → form length (if strategy says "3-4 fields", trim the form)
 *            + CTA intensity (if "urgency=strong", bump CTA copy)
 *   - audience → FAQ ordering (surface objections strategy flagged)
 *   - narrative → Hero bullets (use narrative hooks)
 *   - local → tone adjustments (caps/no-caps, icon density)
 */
function applyStrategyToModules(modules: PageModule[], strategy?: StrategySummary) {
  if (!strategy) return;

  // Form length from goal text
  const goalText = strategy.goal.join(' ');
  const formMod = modules.find((m) => m.type === 'form');
  if (formMod) {
    const c = formMod.content as any;
    const shortForm = /3[–-]4|3 ?to ?4|短|3～4|3〜4/.test(goalText);
    if (shortForm && Array.isArray(c.fields) && c.fields.length > 4) {
      c.fields = c.fields.slice(0, 4);
    }
  }

  // Surface objection questions from audience into FAQ top
  const audienceText = strategy.audience.join(' ');
  const faqMod = modules.find((m) => m.type === 'faq');
  if (faqMod) {
    const c = faqMod.content as any;
    const objections = extractObjections(audienceText);
    if (objections.length && Array.isArray(c.items)) {
      // Prepend up to 2 audience-derived FAQ items if they aren't already covered.
      const existingQuestions = c.items.map((it: any) => (it.q ?? '').toLowerCase());
      const fresh = objections
        .filter((o) => !existingQuestions.some((q: string) => q.includes(o.slice(0, 6).toLowerCase())))
        .slice(0, 2)
        .map((q) => ({ q, a: '我们可以在 demo 中具体演示。' }));
      c.items = [...fresh, ...c.items];
    }
  }

  // Promote narrative emotional hook into hero bullets
  const narrativeText = strategy.narrative.join(' ');
  const heroMod = modules.find((m) => m.type === 'hero');
  if (heroMod) {
    const c = heroMod.content as any;
    const painFirst = /先讲痛点|先講痛點|先に課題|lead with the problem/i.test(narrativeText);
    if (painFirst && Array.isArray(c.bullets)) {
      // Keep bullets but mark as outcome-proof heavy
      // (already handled by variant tinting — this is a hook for future extension)
    }
  }
}

function extractObjections(text: string): string[] {
  // Pull out question-like fragments that look like objections.
  const matches =
    text.match(/[^。.！!？?]+[？?]/g) ??
    text.match(/[^,;]+(?:对接|集成|成本|费用|导入|预算|规模|价格)[^,;]*/g) ??
    [];
  return matches
    .map((s) => s.trim().replace(/^[：:,;\s]+/, ''))
    .filter((s) => s.length > 4 && s.length < 60)
    .slice(0, 4);
}

function reorder(modules: PageModule[], order: string[]): PageModule[] {
  const byType = new Map(modules.map((m) => [m.type, m]));
  return order
    .map((t) => byType.get(t as any))
    .filter((m): m is PageModule => !!m)
    .map((m) => ({ ...m, id: m.id })); // keep ids stable for now
}

function tintHeroForVariant(mods: PageModule[], v: NarrativeVariant, inputs: ProductInputs) {
  const hero = mods.find((m) => m.type === 'hero');
  if (!hero) return;
  const c = hero.content as any;
  const locale = inputs.locale;
  if (v === 'A') {
    // Pain-driven hero
    c.eyebrow = locale === 'ja' ? '現状のコスト' : locale === 'en' ? 'THE HIDDEN COST' : '隐性成本';
    c.headline = lossPhrase(inputs);
    c.subhead = painSubhead(inputs);
  } else {
    // Benefit-driven hero
    c.eyebrow = locale === 'ja' ? '成果の約束' : locale === 'en' ? 'OUTCOME FIRST' : '确定的结果';
    c.headline = outcomePhrase(inputs);
    c.subhead = benefitSubhead(inputs);
  }
}

function lossPhrase(inputs: ProductInputs): string {
  const { locale, name } = inputs;
  switch (locale) {
    case 'zh-CN':
      return `每周有 11 小时，被本可避免的手工活吃掉。`;
    case 'zh-TW':
      return `每週有 11 小時,被本可避免的手動作業吃掉。`;
    case 'ja':
      return `週 11 時間、避けられるはずの手作業に奪われています。`;
    case 'en':
    default:
      return `11 hours a week, lost to work that should never exist.`;
  }
}

function painSubhead(inputs: ProductInputs): string {
  switch (inputs.locale) {
    case 'zh-CN':
      return `${inputs.name} 把拼凑的流程收拢到一个地方，第一周就能看到时间回来。`;
    case 'zh-TW':
      return `${inputs.name} 把拼湊的流程收攏到一個地方,第一週就能看到時間回來。`;
    case 'ja':
      return `${inputs.name} は継ぎ接ぎのプロセスを一つにまとめ、初週から時間を取り戻します。`;
    case 'en':
    default:
      return `${inputs.name} brings the stitched-together process back into one place. Hours return by week one.`;
  }
}

function outcomePhrase(inputs: ProductInputs): string {
  switch (inputs.locale) {
    case 'zh-CN':
      return `3.8 倍 ROI，上线当周就开始。`;
    case 'zh-TW':
      return `3.8 倍 ROI,上線當週就開始。`;
    case 'ja':
      return `3.8 倍の ROI、公開週から。`;
    case 'en':
    default:
      return `3.8× ROI — starting the week you launch.`;
  }
}

function benefitSubhead(inputs: ProductInputs): string {
  switch (inputs.locale) {
    case 'zh-CN':
      return `${inputs.name} 让团队更快产出结果，1,200+ 团队已经在用。`;
    case 'zh-TW':
      return `${inputs.name} 讓團隊更快產出結果,1,200+ 團隊已在使用。`;
    case 'ja':
      return `${inputs.name} はチームの成果を加速。1,200+ のチームがすでに活用中。`;
    case 'en':
    default:
      return `${inputs.name} gets teams to outcomes faster. 1,200+ teams already onboard.`;
  }
}

// --- Module generator ---------------------------------------------------

/**
 * Per-locale stats labels for the seeded socialProof block (Audit Wave 1 #F).
 *
 * Was a nested ternary `inputs.locale === 'en' ? ... : 'ja' ? ... : '团队'`
 * — zh-TW hit the zh-CN default branch, leaking 简体 into 繁體 output.
 * Now an explicit Record<PageLocale, ...> table; missing-locale would be
 * a TS error at compile time.
 *
 * Kept inline here (not in the L object) because: (a) only this seeded
 * block uses it, (b) future LLM-grounded gen will replace these labels
 * outright via hydrate, so the lifetime of this lookup is bounded.
 */
const STATS_LABELS_BY_LOCALE: Record<PageLocale, { teams: string; avgRoi: string; timeSaved: string }> = {
  'zh-CN': { teams: '团队', avgRoi: '平均 ROI', timeSaved: '每周节省' },
  'zh-TW': { teams: '團隊', avgRoi: '平均 ROI', timeSaved: '每週節省' },
  ja:      { teams: 'チーム', avgRoi: '平均 ROI', timeSaved: '週あたり削減時間' },
  en:      { teams: 'Teams', avgRoi: 'Avg ROI', timeSaved: 'Time saved / wk' },
};

export function generateModules(
  inputs: ProductInputs,
  tone: ToneKey,
  _strategy?: StrategySummary, // reserved for future LLM-grounded gen; structure-only today
  _context?: ExtractedContext, // reserved: customer names / metrics pulled from uploads
): PageModule[] {
  const T = L[inputs.locale];
  const ctaLabel = T.ctaLabels[inputs.cta];
  const toneEmoji = tone === 'japanese' ? '' : '';

  // Hero copy is small-surface; longer value props belong in solution/body.
  // CJK caps slightly tighter (one display line ≈ 28-32 chars depending on
  // viewport). EN wider because average char width is smaller.
  const headlineCap = inputs.locale === 'en' ? 80 : 28;
  const bulletCap = inputs.locale === 'en' ? 60 : 24;
  const safeHeadlineValue = firstSentence(inputs.value, headlineCap);
  const safeBulletValue = firstSentence(inputs.value, bulletCap);

  // Stats labels — explicit per-locale lookup (was: nested ternary that hit
  // the zh-CN default for zh-TW too, leaking 简体 into 繁體 output).
  // Audit Wave 1 #F.
  const statsLabels = STATS_LABELS_BY_LOCALE[inputs.locale];

  const modules: PageModule[] = [
    {
      id: nanoid(8),
      type: 'hero',
      enabled: true,
      content: {
        eyebrow: T.eyebrow(inputs.category),
        headline: T.headlineTmpl(inputs.name, safeHeadlineValue),
        subhead: T.subheadTmpl(inputs.tagline, inputs.name),
        primaryCta: ctaLabel,
        secondaryCta: undefined,
        bullets: T.bullets(safeBulletValue),
      },
    },
    {
      id: nanoid(8),
      type: 'socialProof',
      enabled: true,
      content: {
        title: T.trustTitle,
        logos: ['Acme', 'Globex', 'Hooli', 'Initech', 'Soylent', 'Umbrella'],
        stats: [
          { label: statsLabels.teams, value: '1,200+' },
          { label: statsLabels.avgRoi, value: '3.8×' },
          { label: statsLabels.timeSaved, value: '11h' },
        ],
      },
    },
    {
      id: nanoid(8),
      type: 'pain',
      enabled: true,
      content: { title: T.painTitle, subtitle: '', items: [...T.painItems] },
    },
    {
      id: nanoid(8),
      type: 'solution',
      enabled: true,
      content: { title: T.solutionTitle, subtitle: '', body: T.solutionBody },
    },
    {
      id: nanoid(8),
      type: 'benefits',
      enabled: true,
      content: { title: T.benefitsTitle, items: [...T.benefits] },
    },
    {
      id: nanoid(8),
      type: 'useCase',
      enabled: true,
      content: { title: T.useCaseTitle, items: [...T.useCases] },
    },
    {
      id: nanoid(8),
      type: 'testimonial',
      enabled: true,
      content: { title: T.testimonialTitle, items: [...T.testimonials] },
    },
    {
      id: nanoid(8),
      type: 'faq',
      enabled: true,
      content: { title: T.faqTitle, items: [...T.faqs] },
    },
    {
      id: nanoid(8),
      type: 'cta',
      enabled: true,
      content: { headline: T.ctaHeadline, subhead: T.ctaSub, button: ctaLabel },
    },
    {
      id: nanoid(8),
      type: 'form',
      enabled: true,
      content: {
        title: T.formTitle,
        subtitle: T.formSub,
        fields:
          inputs.market === 'JP'
            ? ['name', 'email', 'company', 'phone', 'message']
            : ['name', 'email', 'company', 'message'],
        submitLabel: ctaLabel,
      },
    },
  ];
  void toneEmoji;
  return modules;
}

// --- Seed templates for visual modules (new in Phase F) ---------------

export function seedProductShowcase(inputs: ProductInputs) {
  const L = {
    en: {
      title: 'See it in action',
      subtitle: 'Three ways teams use it every day',
      items: [
        { title: 'Unified inbox', body: 'Every conversation lands in one place — assigned, tagged, and routed.', bullets: ['SLA timers', 'Auto-triage', 'Context from CRM'] },
        { title: 'Live collaboration', body: 'Your team works the same ticket without stepping on each other.', bullets: ['Realtime presence', 'Private notes', 'One-click handoff'] },
        { title: 'Report that actually ships', body: 'Weekly summaries posted to Slack without you lifting a finger.', bullets: ['Auto-digest', 'Custom cohorts', 'Exportable'] },
      ],
    },
    'zh-CN': {
      title: '看看它怎么用',
      subtitle: '团队每天在这里做的三件事',
      items: [
        { title: '统一收件箱', body: '所有对话汇到一处 — 已分配、已打标、已路由。', bullets: ['SLA 倒计时', '自动分流', '从 CRM 带上下文'] },
        { title: '多人协作不打架', body: '同一个工单，团队同步操作互不覆盖。', bullets: ['实时在线提示', '私密备注', '一键移交'] },
        { title: '报表会自己发', body: '周度摘要自动发到 Slack，你不用动手。', bullets: ['自动摘要', '自定义分组', '可导出'] },
      ],
    },
    'zh-TW': {
      title: '看看它怎麼用',
      subtitle: '團隊每天在這裡做的三件事',
      items: [
        { title: '統一收件匣', body: '所有對話匯到一處 — 已分配、已打標、已路由。', bullets: ['SLA 倒計時', '自動分流', '從 CRM 帶上下文'] },
        { title: '多人協作不打架', body: '同一個工單,團隊同步操作互不覆蓋。', bullets: ['即時在線提示', '私密備注', '一鍵移交'] },
        { title: '報表會自己發', body: '週度摘要自動發到 Slack,你不用動手。', bullets: ['自動摘要', '自訂分組', '可匯出'] },
      ],
    },
    ja: {
      title: '実際の動きを見る',
      subtitle: 'チームが毎日使う 3 つの場面',
      items: [
        { title: '統合受信箱', body: 'すべての会話を一箇所に。割り当て、タグ、ルーティングまで。', bullets: ['SLA タイマー', '自動振り分け', 'CRM からの文脈'] },
        { title: 'リアルタイム協調', body: '同じチケットをチームで衝突なく扱う。', bullets: ['在席表示', 'プライベートメモ', 'ワンクリック引き継ぎ'] },
        { title: '勝手に届くレポート', body: '週次サマリーは Slack に自動投稿。手を動かす必要なし。', bullets: ['自動ダイジェスト', 'カスタム集計', 'エクスポート可'] },
      ],
    },
  } as const;
  return (L as any)[inputs.locale] ?? L.en;
}

export function seedVideoEmbed(inputs: ProductInputs) {
  const L = {
    en: { title: 'Watch a 90-second demo', subtitle: 'Shorter than making coffee.' },
    'zh-CN': { title: '看 90 秒产品演示', subtitle: '比泡一杯咖啡还短。' },
    'zh-TW': { title: '看 90 秒產品演示', subtitle: '比泡一杯咖啡還短。' },
    ja: { title: '90 秒のデモを見る', subtitle: 'コーヒーを淹れるより早い。' },
  } as const;
  return (L as any)[inputs.locale] ?? L.en;
}

// --- Regenerate copy (per-module) --------------------------------------

/**
 * Regenerate a module. Claude handles the 5 text-heavy types
 * (hero/pain/benefits/solution/cta); for everything else (form, testimonial,
 * socialProof, faq, useCase) we return a refreshed TEMPLATE because those
 * modules are schema-shaped / user-authored from the asset library — there
 * is no "AI rewrite" to do.
 *
 * History: this function used to auto-fall-back to regenerateModuleTemplated
 * when Claude returned null for ANY reason (missing key / API error /
 * malformed JSON). That fig leaf produced the reported bug: user clicked
 * "regenerate copy" on the 日本語 tab with no ANTHROPIC_API_KEY set, fell
 * through to the Japanese template whose `headlineTmpl(name, value)` inlined
 * the Chinese product value verbatim, resulting in Chinese text in a
 * Japanese hero. Now regenerateModuleViaClaude throws on failures; this
 * function only falls through to template when Claude explicitly returns
 * null (i.e. the module type is not AI-handled — a routing decision).
 *
 * We MERGE the returned fields onto existing content instead of replacing —
 * that preserves layout, media, bullets we don't own, etc.
 */
export async function regenerateModule(
  module: PageModule,
  inputs: ProductInputs,
  tone: ToneKey,
  strategy?: StrategySummary,
  locale?: LocaleCode,
  variant?: NarrativeVariant,
  onTrace?: (t: { primary: string; used: string; hops: any[] }) => void,
): Promise<PageModule> {
  if (strategy && locale) {
    const live = await regenerateModuleViaProvider(
      module.type,
      inputs,
      strategy,
      tone,
      locale,
      variant,
      onTrace as any,
    );
    // live === null ONLY when the module type is outside Claude's handled
    // set (form / testimonial / etc.). Actual failures throw and propagate
    // to the route handler for structured 502/503 translation.
    if (live) {
      return {
        ...module,
        content: { ...(module.content as any), ...live },
      };
    }
  }
  return regenerateModuleTemplated(module, inputs, tone);
}

/** Template-only regen, kept for tests and as fallback. */
export function regenerateModuleTemplated(
  module: PageModule,
  inputs: ProductInputs,
  tone: ToneKey,
): PageModule {
  const fresh = generateModules(inputs, tone).find((m) => m.type === module.type);
  if (!fresh) return module;
  // Preserve structural fields the user (or the enterprise-b2b stack builder)
  // set on the module that govern layout/mode, not copy. Without this,
  // clicking "regenerate" on a logos-only socialProof band reverts it to
  // 'logos-and-stats', or regenerating an external form reverts it to
  // inline mode and the user's externalUrl is dropped.
  const old = module.content as any;
  const merged: any = { ...fresh.content };
  if ('variant' in old) merged.variant = old.variant;
  if ('mode' in old) merged.mode = old.mode;
  if ('externalUrl' in old) merged.externalUrl = old.externalUrl;
  return { ...module, content: merged };
}

// --- Claude-driven module hydration on initial creation ------------------
//
// Why this exists: before this helper, the flow was
//   wizard → strategy (Claude ✓) → generateVariants (TEMPLATE) → save.
// Users paying for the Claude key never saw Claude-written module content
// until they clicked "regenerate" on individual modules. This closes that
// gap: every new page is born with Claude-written hero/pain/benefits/
// solution/cta for its default locale.
//
// Constraints kept cheap:
//   - only the 5 text-heavy types route here; socialProof / testimonials /
//     faq / form / useCase stay templated (authored from assets or AI
//     later — not worth the round-trip today)
//   - one Claude call per module type, applied to BOTH variant A and B.
//     A/B storytelling differentiation is a known gap (see CLAUDE.md §2.3);
//     the variant order + eyebrow already differ, and narrative-level
//     split can layer on later with a per-variant strategy hint. Spending
//     10 Claude calls per page just to re-narrate hero twice isn't worth
//     it until we have A/B signal that justifies it.
//
// Performance: 5 parallel calls, warm-cache pricing after the first.
// At Opus 4.6 cached rates: ~$0.01 per page creation. Latency is bounded
// by the slowest of the 5 — typically ~3-6s end-to-end.
//
// Error policy (post-fig-leaf cleanup): Promise.all short-circuits on the
// first rejected promise. Any adapter-level error (missing API key,
// network failure, malformed JSON) propagates directly to the caller.
// The old per-module try/catch + "null patch falls back to template"
// pattern is gone — it let hydration "succeed" with a half-template page
// and no visible signal that something had gone wrong. Route handlers
// now catch at the boundary and mark page.hydrationFailed=true so the
// UI shows a warning banner pointing the user at the missing capability.

export async function hydrateModulesViaClaude(
  variants: { A: PageModule[]; B: PageModule[] },
  inputs: ProductInputs,
  strategy: StrategySummary,
  tone: ToneKey,
  locale: PageLocale,
): Promise<{ A: PageModule[]; B: PageModule[] }> {
  // Hero gets called TWICE — once per variant — so A/B eyebrow/headline
  // lean into pain (A) vs outcome (B). Prior to 2026-04, hero was called
  // once and the same patch overrode both variants' tinted fields (see
  // tintHeroForVariant) — the editor's "方案 A / 方案 B" toggle rendered
  // identical content. User report: "方案A 痛点 方案B 收益，两个页面一样."
  //
  // Non-hero types stay single-call: pain is A-only by design (B's module
  // order excludes pain); benefits/solution/cta carry A/B differentiation
  // via module ORDER not copy, so sharing the patch is fine. If we later
  // want variant-specific benefits framing, wire variantHintForModule
  // for 'benefits' in llm-claude.ts — all the plumbing is ready.
  const NEUTRAL_TYPES: ModuleType[] = ['pain', 'benefits', 'solution', 'cta'];

  // No per-module try/catch — Promise.all short-circuits on first rejection,
  // LLMRequiredError / LLMCallError propagate to the route handler.
  const [heroA, heroB, ...neutralRewrites] = await Promise.all([
    regenerateModuleViaProvider('hero', inputs, strategy, tone, locale, 'A'),
    regenerateModuleViaProvider('hero', inputs, strategy, tone, locale, 'B'),
    ...NEUTRAL_TYPES.map(async (t) => {
      const r = await regenerateModuleViaProvider(t, inputs, strategy, tone, locale);
      return [t, r] as const;
    }),
  ]);

  const neutralPatchByType = new Map<ModuleType, Record<string, unknown>>();
  for (const [t, r] of neutralRewrites as Array<readonly [ModuleType, unknown]>) {
    // r === null means the adapter doesn't handle this type. For NEUTRAL_TYPES
    // (pain/benefits/solution/cta) Claude handles all 4, so null here would
    // be a programming error (adapter + orchestrator out of sync). Log and
    // skip the patch rather than crashing — downstream render still works
    // with the templated content for that module.
    if (r && typeof r === 'object') {
      neutralPatchByType.set(t, r as Record<string, unknown>);
    } else {
      console.warn(`[hydrate] Claude returned null patch for type=${t}; keeping template for that module.`);
    }
  }

  let heroPatchA: Record<string, unknown> | null =
    heroA && typeof heroA === 'object' ? (heroA as Record<string, unknown>) : null;
  let heroPatchB: Record<string, unknown> | null =
    heroB && typeof heroB === 'object' ? (heroB as Record<string, unknown>) : null;
  if (!heroPatchA) console.warn(`[hydrate] Claude returned null patch for hero variant=A; keeping tinted template.`);
  if (!heroPatchB) console.warn(`[hydrate] Claude returned null patch for hero variant=B; keeping tinted template.`);

  if (!heroPatchA && !heroPatchB && neutralPatchByType.size === 0) return variants;

  const applyForVariant = (
    mods: PageModule[],
    heroPatch: Record<string, unknown> | null,
  ): PageModule[] =>
    mods.map((m) => {
      const patch = m.type === 'hero' ? heroPatch : neutralPatchByType.get(m.type);
      if (!patch) return m;
      // Merge: Claude fields win, but preserve any templated fields Claude
      // didn't produce (e.g. nested layout hints, future locale tweaks).
      // Cast through unknown because PageModule<ModuleContent> is a discriminated
      // union that doesn't narrow by key at this point — we know the patch
      // fields match the module's type at runtime because the hero patch
      // came from a hero-typed call, and neutralPatchByType is keyed by type.
      const merged = { ...(m.content as unknown as Record<string, unknown>), ...patch };
      return { ...m, content: merged as unknown as PageModule['content'] } as PageModule;
    });

  let hydratedA = applyForVariant(variants.A, heroPatchA);
  let hydratedB = applyForVariant(variants.B, heroPatchB);

  // --- Post-validation: template-fingerprint check ------------------------
  //
  // Last-line defence. Claude can technically return a 200 + well-formed
  // tool_use payload whose output matches one of the L[locale] template
  // strings verbatim — e.g. Claude copying the template's benefits
  // headline "Why teams switch" when product inputs are too generic. We
  // detect via findTemplateModules() (covers hero / pain / solution /
  // benefits / cta) and retry EACH flagged type individually.
  //
  // Per-variant check for hero since each side has its own patch. For
  // neutral types the check is union: if hero A fails but benefits passes
  // in both, we retry hero-A only. If benefits fails in either side, we
  // retry benefits once (still shared patch). After retry, if ANY side
  // still matches template, throw — the caller's two-save pattern flags
  // hydrationFailed=true and the editor banner lists the failing types.
  const templatesA = findTemplateModules(hydratedA, inputs.name);
  const templatesB = findTemplateModules(hydratedB, inputs.name);
  if (templatesA.length > 0 || templatesB.length > 0) {
    const aTypes = new Set(templatesA.map((r) => r.type));
    const bTypes = new Set(templatesB.map((r) => r.type));
    const retryHeroA = aTypes.has('hero');
    const retryHeroB = bTypes.has('hero');
    const neutralRetryTypes = new Set<ModuleType>();
    for (const t of aTypes) if (NEUTRAL_TYPES.includes(t)) neutralRetryTypes.add(t);
    for (const t of bTypes) if (NEUTRAL_TYPES.includes(t)) neutralRetryTypes.add(t);

    const retryLabels = [
      ...(retryHeroA ? ['hero(A)'] : []),
      ...(retryHeroB ? ['hero(B)'] : []),
      ...neutralRetryTypes,
    ];
    console.warn(
      `[hydrate] post-validation: ${retryLabels.join(', ')} matched template fingerprint on locale=${locale}; retrying.`,
    );

    type PatchResult = Awaited<ReturnType<typeof regenerateModuleViaProvider>>;
    type RetryResult =
      | { target: 'heroA' | 'heroB'; r: PatchResult }
      | { target: ModuleType; r: PatchResult };
    const retryPromises: Array<Promise<RetryResult>> = [];
    if (retryHeroA) {
      retryPromises.push(
        regenerateModuleViaProvider('hero', inputs, strategy, tone, locale, 'A').then(
          (r) => ({ target: 'heroA' as const, r }),
        ),
      );
    }
    if (retryHeroB) {
      retryPromises.push(
        regenerateModuleViaProvider('hero', inputs, strategy, tone, locale, 'B').then(
          (r) => ({ target: 'heroB' as const, r }),
        ),
      );
    }
    for (const t of neutralRetryTypes) {
      retryPromises.push(
        regenerateModuleViaProvider(t, inputs, strategy, tone, locale).then((r) => ({
          target: t,
          r,
        })),
      );
    }

    const retries = await Promise.all(retryPromises);
    for (const entry of retries) {
      if (entry.r && typeof entry.r === 'object') {
        if (entry.target === 'heroA') heroPatchA = entry.r as Record<string, unknown>;
        else if (entry.target === 'heroB') heroPatchB = entry.r as Record<string, unknown>;
        else neutralPatchByType.set(entry.target, entry.r as Record<string, unknown>);
      }
    }

    hydratedA = applyForVariant(variants.A, heroPatchA);
    hydratedB = applyForVariant(variants.B, heroPatchB);

    const stillA = findTemplateModules(hydratedA, inputs.name);
    const stillB = findTemplateModules(hydratedB, inputs.name);
    if (stillA.length > 0 || stillB.length > 0) {
      // Still template after per-type retry. Product inputs are too thin
      // to ground the LLM, OR the strategy summary lacks anchors. Throw
      // with the exact list so the banner can tell the user WHICH
      // modules need attention. `provider` reflects which backend is
      // actually in use for this locale — messaging shouldn't say
      // "Claude" when routing sent the calls to DeepSeek. v2: read from
      // the chain[0] of the 'copy' scenario.
      const { LLMCallError } = await import('./errors');
      const { readLLMConfig, policyFor } = await import('./llm-config');
      const cfg = await readLLMConfig();
      const policy = policyFor(cfg, 'copy', locale);
      const provider = (policy.chain[0]?.provider ?? 'claude') as 'claude' | 'deepseek' | 'gpt' | 'gemini';
      const badTypes = [
        ...new Set([...stillA.map((r) => r.type), ...stillB.map((r) => r.type)]),
      ].join(' / ');
      throw new LLMCallError(
        provider,
        'module-hydrate',
        undefined,
        `模块 ${badTypes} 两次调用后仍匹配模板指纹（${locale}）。通常说明产品输入（name / tagline / value）过于通用，模型抓不到产品特定锚点。建议在 wizard 里补充更具体的产品描述后重新生成。`,
      );
    }
  }

  return { A: hydratedA, B: hydratedB };
}

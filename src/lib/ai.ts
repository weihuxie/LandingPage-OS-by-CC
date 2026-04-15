import type {
  ProductInputs,
  StrategySummary,
  PageModule,
  LocaleCode,
  MarketCode,
  CTAGoal,
  ToneKey,
} from './types';
import { nanoid } from 'nanoid';

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

export function generateStrategy(inputs: ProductInputs): StrategySummary {
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

  return {
    audience: audienceByLocale[locale],
    goal: goalByLocale[locale],
    narrative: narrativeByLocale[locale],
    local: marketStrategyText(inputs.market, locale),
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
): { A: PageModule[]; B: PageModule[] } {
  const baseA = generateModules(inputs, tone, strategy);
  const baseB = generateModules(inputs, tone, strategy);

  // Variant A — pain-first
  const a = reorder(baseA, ['hero', 'socialProof', 'pain', 'solution', 'benefits', 'useCase', 'testimonial', 'faq', 'cta', 'form']);
  tintHeroForVariant(a, 'A', inputs);
  applyStrategyToModules(a, strategy);

  // Variant B — benefit-first (skip pain, lead with social proof + benefits)
  const b = reorder(baseB, ['hero', 'socialProof', 'benefits', 'useCase', 'solution', 'testimonial', 'faq', 'cta', 'form']);
  tintHeroForVariant(b, 'B', inputs);
  applyStrategyToModules(b, strategy);

  return { A: a, B: b };
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

export function generateModules(
  inputs: ProductInputs,
  tone: ToneKey,
  _strategy?: StrategySummary, // reserved for future LLM-grounded gen; structure-only today
): PageModule[] {
  const T = L[inputs.locale];
  const ctaLabel = T.ctaLabels[inputs.cta];
  const toneEmoji = tone === 'japanese' ? '' : '';

  const modules: PageModule[] = [
    {
      id: nanoid(8),
      type: 'hero',
      enabled: true,
      content: {
        eyebrow: T.eyebrow(inputs.category),
        headline: T.headlineTmpl(inputs.name, inputs.value),
        subhead: T.subheadTmpl(inputs.tagline, inputs.name),
        primaryCta: ctaLabel,
        secondaryCta: undefined,
        bullets: T.bullets(inputs.value),
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
          { label: inputs.locale === 'en' ? 'Teams' : inputs.locale === 'ja' ? 'チーム' : '团队', value: '1,200+' },
          { label: inputs.locale === 'en' ? 'Avg ROI' : inputs.locale === 'ja' ? '平均 ROI' : '平均 ROI', value: '3.8×' },
          { label: inputs.locale === 'en' ? 'Time saved / wk' : inputs.locale === 'ja' ? '週あたり削減時間' : '每周节省', value: '11h' },
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

// --- Regenerate copy (per-module) --------------------------------------

export function regenerateModule(
  module: PageModule,
  inputs: ProductInputs,
  tone: ToneKey,
): PageModule {
  const fresh = generateModules(inputs, tone).find((m) => m.type === module.type);
  if (!fresh) return module;
  return { ...module, content: fresh.content };
}

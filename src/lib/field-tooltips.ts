/**
 * Field tooltips registry — pattern ③ "Tooltip 帮助气泡" from the AI-introduction
 * design doc.
 *
 * One source of truth for "what does this field mean / what should I write?"
 * help text. Keyed by a stable path string the editor sticks next to each
 * field label via <HelpTip path="..."> .
 *
 * Why this isn't in a JSON message file:
 *  - These strings are dev-facing UX hints, not user-facing translations.
 *    The editor admin UI is Chinese-first; translating tooltips to en/ja
 *    is a copy-rewrite job (not a string swap), and we don't have an
 *    English admin UI yet anyway.
 *  - Co-locating with the field path keys lets a developer adding a new
 *    field also add a tooltip without touching 4 message files.
 *  - When/if the admin UI gets translated, swap this object for a
 *    locale-aware lookup — keys stay stable.
 *
 * Design rules:
 *  - `short`: one line, max ~60 chars. The tooltip surface is small.
 *  - `example`: optional concrete sample text. Shown on a second line in
 *    the tooltip, prefixed with "示例". Helps users go from "what" to
 *    "what would I actually type".
 *  - Don't repeat the field label. The user can already see "Eyebrow" —
 *    the tooltip is for the meaning, not the name.
 */

export interface Tooltip {
  short: string;
  example?: string;
}

export const FIELD_TOOLTIPS: Record<string, Tooltip> = {
  // ----- Page-level -----
  'page.strategy': {
    short: '影响整个落地页的语调、模块顺序、CTA 风格。改这里相当于换一种叙事立场。',
  },
  'page.tone': {
    short: '语气基调（专业 / 高管 / 销售 / 友好 / SaaS / 日式 / 大客户 B2B）。',
  },
  'page.activeVariant': {
    short: 'A：先讲痛点（Pain → Solution）；B：先讲收益（Outcome-first）。两套独立内容。',
  },
  'page.fontPresetId': {
    short: '该 locale 下默认排版字体。挑一个适合受众阅读习惯的（CN 圆润 / JP 明朝 / EN 衬线）。',
  },

  // ----- Hero -----
  'hero.layout': {
    short: '5 种 Hero 布局：左文右图 / 居中大图 / 品牌满屏 / 大数字 / 编辑分栏。按可用素材选。',
  },
  'hero.fontScale': {
    short: '标题字号档位。文字短选大，文字长选小，否则换行难看。',
  },
  'hero.eyebrow': {
    short: 'Hero 大标题上方的小标签，强调赛道或定位。一句话给访客"我属于哪个圈子"信号。',
    example: '"AI 行业 OS"  ·  "跨境合规底座"  ·  "Compliance Operating System"',
  },
  'hero.headline': {
    short: '一句话讲清你是谁、解决谁的什么问题。8–14 字最佳，长了访客会跳过。',
    example: '"给 AI 团队的合规 OS"  ·  "把跨境支付门槛打下来"',
  },
  'hero.subhead': {
    short: '一句话给具体证据：数字、百分比、客户量级。没数字的副标题没用。',
    example: '"上线第一周 3.8 倍 ROI"  ·  "节省 60% 合规人力"',
  },
  'hero.primaryCta': {
    short: '主按钮文案。要带动作感和具体收益，避免"了解更多 / Learn more"这类无承诺词。',
    example: '"免费试用 30 天"  ·  "30 秒生成第一页"',
  },
  'hero.primaryCtaHref': {
    short: '留空 = 滚动到页内 #contact 表单。填 https:// 开头则在新标签页打开外链。',
  },
  'hero.secondaryCta': {
    short: '次要按钮文案，可选。一般是低承诺动作（看视频 / 看 Demo / 联系销售）。',
    example: '"看 2 分钟 demo"  ·  "联系我们"',
  },
  'hero.bullets': {
    short: '3–4 条卖点速览，每行一句。Hero 是访客唯一会扫读的地方，bullets 决定他还看不看下面。',
  },
  'hero.media': {
    short: 'Hero 主视觉。产品截图 / 流程图 / 短视频。没素材时不放也行（centered/video-bg 布局自适应）。',
  },

  // ----- Social Proof -----
  'socialProof.title': {
    short: '一句中性引导（"已被以下团队使用" / "Trusted by"）。不要写成卖点。',
  },
  'socialProof.logos': {
    short: '客户 logo 行。先填可公开背书的、有人脸（公司名）认知度的。8–12 个最佳。',
  },
  'socialProof.stats': {
    short: '关键数字横排：用户量 / 处理量 / 节省时长。每个 label + value，3–4 个最佳。',
    example: '"500+ 团队"  /  "120 万次/天"  /  "节省 11 小时/周"',
  },
  'socialProof.variant': {
    short: '展示形态：logos+stats 一起 / 仅 logos / 仅 stats。Helios 风建议拆两行。',
  },
  'socialProof.logoMode': {
    short: 'grid = 静态网格；scroll = 横向滚动跑马灯（适合 logo 多于 12 个）。',
  },

  // ----- Pain -----
  'pain.title': {
    short: '让访客"对号入座"的痛点章节标题。最好是设问句。',
    example: '"还在为这些事浪费时间吗？"  ·  "为什么每周都加班？"',
  },
  'pain.subtitle': {
    short: '一行扩展，进一步收窄受众，或量化痛点的代价。',
  },
  'pain.items': {
    short: '3 条痛点卡片。每条 title 1 句话，body 2-3 句铺细节。痛要有代价（钱 / 时间 / 信任）。',
  },

  // ----- Solution -----
  'solution.title': {
    short: '解决方案章节标题。一句话告诉访客"我们怎么解的"。',
  },
  'solution.subtitle': {
    short: '一行扩展。讲机制（"通过 X 实现 Y"）比讲功能列表更容易记住。',
  },
  'solution.body': {
    short: '解决方案正文。3-5 句话讲清楚核心机制。不写功能清单（那是 benefits 的事）。',
  },
  'solution.media': {
    short: '架构图 / 流程图 / 对比图。让方案"看得见"比文字描述更打动决策者。',
  },

  // ----- Benefits -----
  'benefits.title': {
    short: '收益章节标题。建议带量化感（"4 个让你立刻见效的能力"）。',
  },
  'benefits.layout': {
    short: 'cards 三列 / alternating 左右交替（带配图）/ compact 紧凑列表（CN 市场偏好）。',
  },
  'benefits.items': {
    short: '3-6 条核心收益。每条 title 短促有力，body 解释机制和量化效果。',
  },

  // ----- Use Case -----
  'useCase.title': {
    short: '场景章节标题。让不同角色快速找到"这跟我有关"。',
  },
  'useCase.items': {
    short: '按 role + scenario 列：每行一个角色（PM / 销售 / 客服）+ 对应场景。',
  },

  // ----- Testimonial -----
  'testimonial.title': {
    short: '客户证言区标题。一句中性短语就够（"客户怎么说"）。',
  },
  'testimonial.items': {
    short: '客户原话引用。优先有具体数字 + 决策者抬头的证言。avatar 可选，头像比初始字母更可信。',
  },

  // ----- FAQ -----
  'faq.title': {
    short: 'FAQ 区标题。可以放成"常见问题" / "你可能想问"。',
  },
  'faq.items': {
    short: '6-10 条最常见的购买/使用顾虑。优先放价格 / 接入难度 / 数据安全 / 售后这四类。',
  },

  // ----- CTA -----
  'cta.headline': {
    short: '收尾 CTA 大标题。访客滚到这里大概率已经心动了——再推一把。',
    example: '"今天就开始"  ·  "把第一个 30% 转化拿回来"',
  },
  'cta.subhead': {
    short: 'CTA 副标题。降低决策门槛（"无需信用卡 / 30 秒上手 / 随时可退"）。',
  },
  'cta.button': {
    short: '收尾按钮文案。避免"了解更多"——访客已经下来了，要直白动作动词。',
    example: '"免费创建第一页"  ·  "30 秒开通"  ·  "看 demo"',
  },
  'cta.buttonHref': {
    short: '留空 = 滚到 #contact 表单；填 https:// 开新标签页打开。',
  },

  // ----- Form -----
  'form.title': {
    short: '表单区标题。"留下联系方式"比"立即购买"更通用。',
  },
  'form.fields': {
    short: '表单字段：CN 市场建议 3 字段（姓名+手机+留言）；US 市场可选 4-5（加 company）。',
  },
  'form.mode': {
    short: 'inline = 页内表单 POST 到 /api/leads；external = 跳到飞书/Typeform/Calendly。',
  },
  'form.externalUrl': {
    short: '外部表单 URL。仅在 mode=external 时生效。点 CTA 直接跳过去。',
  },
  'form.consentText': {
    short: '隐私同意框文案。EU/GDPR 受众必填；CN/JP 也建议放，提升提交意愿。',
  },
};

/**
 * Look up a tooltip by path. Returns `null` when no entry — caller (HelpTip)
 * uses this to render nothing rather than an empty bubble.
 */
export function tooltipFor(path: string): Tooltip | null {
  return FIELD_TOOLTIPS[path] ?? null;
}

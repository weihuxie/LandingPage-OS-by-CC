import type {
  LocalizationStrategy,
  LandingPage,
  Product,
  PageLocale,
  MarketCode,
  StyleId,
  ModuleType,
} from './types';
import { defaultStyleForMarket } from './styles';

/**
 * Natural market default for a locale. Adding "zh-CN" almost always means
 * "target China market", not "serve Chinese speakers at the same market as
 * the original page". Users can override via the modal's market dropdown.
 */
export function defaultMarketForLocale(locale: PageLocale): MarketCode {
  switch (locale) {
    case 'zh-CN':
      return 'CN';
    case 'zh-TW':
      return 'TW';
    case 'ja':
      return 'JP';
    case 'en':
      return 'US';
    default:
      return 'GLOBAL';
  }
}

/**
 * Build a recommended LocalizationStrategy for adding `targetLocale` to an
 * existing LandingPage. Uses market + locale heuristics derived from the
 * region preset logic in ai.ts / styles.ts.
 *
 * User sees this in a modal before generation; they can edit and approve.
 * The resulting approved strategy feeds POST /api/pages/:id/locales.
 *
 * Market defaulting: if caller doesn't pass `targetMarket`, we infer from
 * `targetLocale` — adding Chinese likely means targeting China, not the
 * original page's market.
 */
export function proposeLocalization(
  page: LandingPage,
  product: Product,
  targetLocale: PageLocale,
  targetMarket: MarketCode = defaultMarketForLocale(targetLocale),
): LocalizationStrategy {
  return {
    targetLocale,
    targetMarket,
    audienceNuances: audienceNuances(targetLocale, targetMarket),
    trustTriggers: trustTriggers(targetLocale, targetMarket),
    ctaIntensity: ctaIntensity(targetMarket),
    narrativeNotes: narrativeNotes(targetLocale, targetMarket),
    recommendedStyle: defaultStyleForMarket(targetMarket),
    recommendedModuleOrder: recommendedOrder(targetMarket),
    formChanges: formChanges(targetMarket, page),
    testimonialFilter: {
      preferPrimaryLocale: targetLocale,
      preferredMarkets: [targetMarket],
    },
    certificationFilter: {
      preferredMarkets: [targetMarket],
    },
    mediaGaps: computeMediaGaps(page, targetLocale),
    approvedByUser: false,
  };
}

function audienceNuances(locale: PageLocale, market: MarketCode): string[] {
  const byMarket: Partial<Record<MarketCode, string[]>> = {
    JP: [
      '决策者更关心合规、稳定、供应商信誉',
      '风险厌恶度高于 US/CN，强调追责与责任主体',
      '采购流程长、多人参与、邮件沟通为主',
    ],
    US: [
      '决策快速，高管看 ROI 和 time-to-value',
      '容忍直接的数据对比和竞品点名',
      '偏好 self-serve 试用，不愿先被锁定到销售',
    ],
    TW: [
      '重合规与治理，偏好成熟厂商',
      '采购审批严谨，需要中文报价与合约',
      '同时关心数据驻留（跨境/岛内）',
    ],
    CN: [
      '关注提效和 ROI，决策密集信息导向',
      '需要本地 IT 工单/合规对接说明',
      '信任大厂背书与行业案例的量级',
    ],
    EU: [
      '强调隐私、合规（GDPR）、数据处理地点',
      '决策更稳重，偏中长线评估',
      '避免激进语言，信誉 > 速度',
    ],
    GLOBAL: ['受众分散、使用场景多样，需通用化语言'],
  };
  return byMarket[market] ?? byMarket.GLOBAL!;
}

function trustTriggers(locale: PageLocale, market: MarketCode): string[] {
  const byMarket: Partial<Record<MarketCode, string[]>> = {
    JP: [
      '优先展示 ISMS / Pマーク / SOC 2',
      '日本客户社名（日立/NTT/丸紅 量级）比 ROI 数字更重要',
      '建议补充日本客户证言（原话是日文）',
    ],
    US: [
      'SOC 2 / HIPAA / FedRAMP（视行业）',
      '高信誉 logo 墙 + ROI 案例数据',
      'Gartner / G2 评级',
    ],
    TW: [
      'ISO 27001 / 金管會合規 / 本地機房',
      '在地客户 logo 墙',
      '重服務 SLA 與售后',
    ],
    CN: [
      '等保三级 / ISO 系列 / SOC 2',
      '国内头部客户 logo（字节/美团 级别）',
      '集成/解决方案能力数据',
    ],
    EU: ['GDPR / ISO 27001 / DPA 条款', '数据驻留在欧盟', '透明的数据处理声明'],
    GLOBAL: ['通用 SOC 2 + ISO 27001', 'Logo 墙跨地区覆盖'],
  };
  return byMarket[market] ?? byMarket.GLOBAL!;
}

function ctaIntensity(market: MarketCode): LocalizationStrategy['ctaIntensity'] {
  switch (market) {
    case 'JP':
      return 'restrained';
    case 'EU':
      return 'restrained';
    case 'TW':
      return 'moderate';
    case 'CN':
      return 'moderate';
    case 'US':
      return 'strong';
    default:
      return 'moderate';
  }
}

function narrativeNotes(locale: PageLocale, market: MarketCode): string[] {
  const byMarket: Partial<Record<MarketCode, string[]>> = {
    JP: [
      '先讲"リスク回避"（避免追责风险）而非"节省时间"',
      '用"段階的な導入"（循序部署）而非"上线就飞"',
      '证明方式：社名背书 + 详细 spec，而不是夸张收益',
    ],
    US: [
      '首屏直接放 ROI / 时间节省的数字',
      '用 before/after 对照',
      '"Ship faster" 比 "reliable" 更有号召力',
    ],
    TW: [
      '稳定与专业并列',
      '强调治理、审计、权限管理',
      '避免夸张用词，用事实说话',
    ],
    CN: [
      '提效为主，信息密度高',
      '功能点与案例数据交替',
      '强调行业落地经验',
    ],
    EU: [
      '隐私与合规优先',
      '用词克制，避免"revolutionary"等词',
      '强调可审计、可控制',
    ],
  };
  return byMarket[market] ?? ['中性叙事，兼顾各市场特征'];
}

function recommendedOrder(market: MarketCode): ModuleType[] {
  if (market === 'JP') {
    // JP: trust-first — testimonial/socialProof 前置
    return [
      'hero',
      'socialProof',
      'testimonial',
      'pain',
      'solution',
      'benefits',
      'useCase',
      'faq',
      'cta',
      'form',
    ];
  }
  if (market === 'US') {
    // US: outcome-first
    return [
      'hero',
      'socialProof',
      'benefits',
      'pain',
      'solution',
      'useCase',
      'testimonial',
      'faq',
      'cta',
      'form',
    ];
  }
  // default
  return [
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
  ];
}

function formChanges(
  market: MarketCode,
  page: LandingPage,
): LocalizationStrategy['formChanges'] {
  // JP B2B expects phone; others usually do better without it
  if (market === 'JP') {
    return { add: ['phone'], remove: [] };
  }
  if (market === 'US' || market === 'EU') {
    return { add: [], remove: ['phone'] };
  }
  return { add: [], remove: [] };
}

function computeMediaGaps(
  page: LandingPage,
  targetLocale: PageLocale,
): LocalizationStrategy['mediaGaps'] {
  const gaps: LocalizationStrategy['mediaGaps'] = [];
  const scan = (mods: any[], variant: 'A' | 'B') => {
    for (const mod of mods ?? []) {
      const c = mod.content as any;
      if (
        (mod.type === 'hero' || mod.type === 'videoEmbed') &&
        c.media?.url &&
        !c.media.localizedUrls?.[targetLocale]
      ) {
        gaps.push({
          moduleRef: `${variant}.${mod.type}.${mod.id}`,
          label: c.media.label ?? c.media.alt ?? `${mod.type} media`,
          suggestedAction:
            mod.type === 'videoEmbed' ? 'ai-translate-caption' : 'upload-localized',
        });
      }
      if (mod.type === 'productShowcase') {
        (c.items ?? []).forEach((it: any, i: number) => {
          if (it.media?.url && !it.media.localizedUrls?.[targetLocale]) {
            gaps.push({
              moduleRef: `${variant}.productShowcase.${mod.id}.item${i}`,
              label: it.media.label ?? it.title ?? `功能 ${i + 1} 截图`,
              suggestedAction: 'upload-localized',
            });
          }
        });
      }
    }
  };
  scan(page.variants.A[page.defaultLocale] ?? [], 'A');
  scan(page.variants.B[page.defaultLocale] ?? [], 'B');
  return gaps;
}

// --- Storage keys for user templates (saved strategies) ----------------

export const LOCALIZATION_TEMPLATE_KEY = 'lp:v2:localization-templates';

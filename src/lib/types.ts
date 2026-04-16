export type LocaleCode = 'en' | 'zh-CN' | 'zh-TW' | 'ja';
export type PageLocale = LocaleCode;
export const PAGE_LOCALES: PageLocale[] = ['zh-CN', 'zh-TW', 'ja', 'en'];

export type MarketCode = 'CN' | 'TW' | 'JP' | 'US' | 'EU' | 'GLOBAL';

export type CTAGoal = 'demo' | 'trial' | 'download' | 'contact' | 'quote';

export type TrafficSource = 'ads' | 'seo' | 'sales' | 'event' | 'referral' | 'social';

export type ToneKey =
  | 'professional'
  | 'executive'
  | 'sales'
  | 'friendly'
  | 'saas'
  | 'japanese';

export type ModuleType =
  | 'hero'
  | 'socialProof'
  | 'pain'
  | 'solution'
  | 'benefits'
  | 'useCase'
  | 'testimonial'
  | 'faq'
  | 'cta'
  | 'form'
  | 'productShowcase'   // 视觉 · 功能分块截图（alternating text + image）
  | 'videoEmbed';       // 视觉 · 视频嵌入（YouTube / Vimeo / Loom / 直链 MP4）

// --- Media references with localization ---------------------------------

export type MediaKind = 'image' | 'video' | 'logo' | 'gif';

/**
 * A reference to an image / video / logo. Supports:
 *   - default URL (used as fallback for any locale)
 *   - per-locale URL overrides (for UI screenshots that are language-specific)
 *   - per-market scope (e.g. ISMS cert only shown in market=JP)
 *
 * Resolution order at render time: scopedToMarkets filter → localizedUrls[locale] → url
 */
export interface MediaRef {
  id: string;
  kind: MediaKind;
  url: string;                    // default (fallback)
  alt?: string;
  poster?: string;                // video only
  localizedUrls?: Partial<Record<PageLocale, string>>;
  localizedAlts?: Partial<Record<PageLocale, string>>;
  scopedToMarkets?: MarketCode[];
  tags?: string[];                // for AI matching (pain-cost, feature-X, etc.)
  // free-form label for the user — "Dashboard 主截图"
  label?: string;
}

export interface ProductInputs {
  name: string;
  tagline: string;
  category: string;
  value: string;
  cta: CTAGoal;
  market: MarketCode;
  locale: LocaleCode;
  industry: string;
  companySize: string;
  role: string;
  source: TrafficSource;
  pastedContent: string;
  referenceUrls: string[];
  uploadedFileNames: string[];
}

export interface StrategySummary {
  audience: string[];
  goal: string[];
  narrative: string[];
  local: string[];
}

export interface HeroContent {
  eyebrow: string;
  headline: string;
  subhead: string;
  primaryCta: string;
  secondaryCta?: string;
  bullets: string[];
  media?: MediaRef; // optional visual — product screenshot or demo video
}

export interface ProductShowcaseContent {
  title: string;
  subtitle?: string;
  items: Array<{
    title: string;
    body: string;
    bullets?: string[];
    media?: MediaRef; // each item has its own screenshot/video
  }>;
}

export interface VideoEmbedContent {
  title: string;
  subtitle?: string;
  media: MediaRef; // kind='video'
}

export interface SocialProofContent {
  title: string;
  logos: string[];
  stats: { label: string; value: string }[];
}

export interface PainContent {
  title: string;
  subtitle: string;
  items: { title: string; body: string }[];
}

export interface SolutionContent {
  title: string;
  subtitle: string;
  body: string;
}

export interface BenefitsContent {
  title: string;
  items: { title: string; body: string }[];
}

export interface UseCaseContent {
  title: string;
  items: { role: string; scenario: string }[];
}

export interface TestimonialContent {
  title: string;
  items: { quote: string; author: string; company: string }[];
}

export interface FAQContent {
  title: string;
  items: { q: string; a: string }[];
}

export interface CTAContent {
  headline: string;
  subhead: string;
  button: string;
}

export interface FormContent {
  title: string;
  subtitle: string;
  fields: Array<'name' | 'email' | 'company' | 'phone' | 'message'>;
  submitLabel: string;
}

export type ModuleContent =
  | HeroContent
  | SocialProofContent
  | PainContent
  | SolutionContent
  | BenefitsContent
  | UseCaseContent
  | TestimonialContent
  | FAQContent
  | CTAContent
  | FormContent
  | ProductShowcaseContent
  | VideoEmbedContent;

export interface PageModule<T extends ModuleContent = ModuleContent> {
  id: string;
  type: ModuleType;
  enabled: boolean;
  content: T;
}

export interface Project {
  id: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
  inputs: ProductInputs;
  tone: ToneKey;
  strategy: StrategySummary;
  modules: PageModule[]; // active variant (kept for backward compat)
  variants: ProjectVariants; // PRD §4.3 — A and B narratives
  activeVariant: NarrativeVariant; // currently selected in editor
  publishMode: 'single' | 'ab-split'; // PRD §6
  theme: {
    primary: string;
    secondary?: string;
    styleId: StyleId;
  };
  referenceUrl?: string;
  published: boolean;
  publishedLocales: LocaleCode[];
  leadCount: number;
  views?: number;
  abStats?: {
    A: { views: number; leads: number };
    B: { views: number; leads: number };
  };
  deploy?: DeployRecord | null;
}

export interface DeployRecord {
  provider: 'vercel' | 'mock';
  url: string;
  deploymentId?: string;
  deployedAt: number;
  status: 'building' | 'ready' | 'error' | 'queued';
  errorMessage?: string;
}

export interface Lead {
  id: string;
  projectId: string;
  createdAt: number;
  name?: string;
  email?: string;
  company?: string;
  phone?: string;
  message?: string;
  locale: LocaleCode;
  variant?: 'A' | 'B'; // A/B split (PRD §4.3)
}

// --- Trust Asset Library (PRD §4.2) -----------------------------------

export interface BrandAsset {
  id: string;
  logos: string[]; // data URLs or remote URLs
  primaryColor: string;
  secondaryColor?: string;
  fontStack?: string;
  guidelineUrl?: string;
  notes?: string;
}

export interface TestimonialAsset {
  id: string;
  createdAt: number;
  author: string;
  role: string;
  company: string;
  quote: string;
  /**
   * The language the customer actually said this in. Preserved for
   * authenticity weighting — original language > translation.
   */
  primaryLocale?: PageLocale;
  /**
   * Optional translations. When shown to a locale that isn't primaryLocale,
   * fall back to localizedQuotes[locale] before showing the original quote.
   * If flagged as AI-generated, UI surfaces a "AI 翻译，请校对" badge.
   */
  localizedQuotes?: Partial<
    Record<PageLocale, { quote: string; role?: string; aiGenerated?: boolean }>
  >;
  preferredMarkets?: MarketCode[];
  industry?: string;
  tags: string[];
}

export interface CertificationAsset {
  id: string;
  createdAt: number;
  name: string; // SOC 2, ISO 27001, GDPR, ...
  logoUrl?: string;
  validUntil?: string;
  markets: MarketCode[]; // markets where this cert matters
}

export interface CaseStudyAsset {
  id: string;
  createdAt: number;
  customerLogoUrl?: string;
  customerName: string;
  industry: string;
  metric: string; // "3.8× ROI", "11h/week saved"
  summary: string;
}

export interface PressAsset {
  id: string;
  createdAt: number;
  outlet: string; // TechCrunch, 36Kr, Nikkei
  headline: string;
  quote?: string;
  url: string;
  publishedAt?: string;
}

export interface AssetLibrary {
  brand: BrandAsset | null;
  testimonials: TestimonialAsset[];
  certifications: CertificationAsset[];
  cases: CaseStudyAsset[];
  press: PressAsset[];
  /** Media refs (screenshots / videos / logos) — added in Phase F */
  media?: MediaRef[];
}

// --- Style presets (PRD §5 — reduce AI味) ------------------------------

export type StyleId =
  | 'saas-modern'
  | 'minimal-trust'
  | 'enterprise-clean'
  | 'bold-roi'
  | 'editorial-serious';

export interface StylePreset {
  id: StyleId;
  name: string;
  nameEn: string;
  mood: string;
  marketsFit: MarketCode[];
  fontStack: string;
  headingWeight: 500 | 600 | 700 | 800;
  density: 'loose' | 'medium' | 'tight';
  accent: 'soft' | 'neutral' | 'bold';
  radius: number; // px
  hero: 'gradient' | 'flat' | 'grid' | 'editorial';
}

// --- Localization strategy (Phase H · 白盒化本地化) --------------------

/**
 * When user clicks "+ 加日语" we first show THIS, let them edit, then generate.
 * Makes localization decisions transparent instead of a black box.
 */
export interface LocalizationStrategy {
  targetLocale: PageLocale;
  targetMarket?: MarketCode;

  audienceNuances: string[];             // decision-maker differences per market
  trustTriggers: string[];               // what signals credibility here
  ctaIntensity: 'restrained' | 'moderate' | 'strong';
  narrativeNotes: string[];              // how the story angle differs

  recommendedStyle: StyleId;
  recommendedModuleOrder?: ModuleType[];

  formChanges: {
    add: Array<'name' | 'email' | 'company' | 'phone' | 'message'>;
    remove: Array<'name' | 'email' | 'company' | 'phone' | 'message'>;
  };

  testimonialFilter?: {
    preferPrimaryLocale: PageLocale;
    preferredMarkets: MarketCode[];
  };
  certificationFilter?: {
    preferredMarkets: MarketCode[];
  };

  mediaGaps: Array<{
    moduleRef: string;
    label: string;
    suggestedAction: 'upload-localized' | 'ai-translate-caption' | 'reuse-default';
  }>;

  approvedByUser: boolean;
  savedAsTemplate?: boolean;
}

// --- A/B Dual Narrative (PRD §4.3) -------------------------------------

export type NarrativeVariant = 'A' | 'B';

export interface ProjectVariants {
  A: PageModule[]; // Pain-Agitate-Solve  (legacy shape, v1)
  B: PageModule[]; // Benefit-Focused
}

// --- v2: Product / Brand / LandingPage 三层模型 ------------------------

// Single Brand per user (per user's Q1 answer)
export interface Brand {
  ownerId: string;
  updatedAt: number;
  companyName: string;
  logos: string[];
  primaryColor: string;
  secondaryColor?: string;
  fontStack?: string;
  certifications: CertificationAsset[]; // 跨产品共享的认证
  press: PressAsset[];                  // 跨产品共享的媒体背书
  sharedCases: CaseStudyAsset[];        // 公司级标杆客户
}

// Product = 品牌下的一个具体产品，归属一个用户
export interface Product {
  id: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;

  name: string;
  tagline: string;
  category: string;
  value: string;                // 核心价值主张（跨语言语义不变）
  website?: string;             // 可选（Q2: 落地页可先于官网）

  theme: {
    primary: string;
    styleId: StyleId;
    fontStack?: string;
    logoUrl?: string;
  };

  // 产品级资产（不跨产品复用）
  assets: {
    testimonials: TestimonialAsset[];
    cases: CaseStudyAsset[];
    /**
     * Product-level media library. Each MediaRef can be localized & market-scoped.
     * Drives the module-editor's "select from library" picker.
     */
    media: MediaRef[];
  };

  landingPageIds: string[];
}

// LocalizedContent: 每个 variant 存 N 个语言各一套模块
export type LocalizedContent = Partial<Record<PageLocale, PageModule[]>>;

// LandingPage = 一个具体的页面（产品主站 / 某活动 / 某市场切片）
export interface LandingPage {
  id: string;
  productId: string;
  slug: string;
  createdAt: number;
  updatedAt: number;

  purpose: 'main' | 'campaign' | 'event' | 'ab-experiment';
  name: string;                 // "主站" / "Q4 Webinar"
  targetMarket: MarketCode;

  defaultLocale: PageLocale;
  availableLocales: PageLocale[];

  // Per-page marketing inputs（audience 分层，strategy 粒度到 page）
  cta: CTAGoal;
  audience: {
    industry: string;
    companySize: string;
    role: string;
    source: TrafficSource;
  };

  strategy: StrategySummary;
  tone: ToneKey;

  variants: {
    A: LocalizedContent;
    B: LocalizedContent;
  };
  activeVariant: NarrativeVariant;
  publishMode: 'single' | 'ab-split';

  theme: {
    primary?: string;          // 可覆盖 Product.theme.primary
    styleId?: StyleId;
  };

  published: boolean;
  publishedAt?: number;
  deploy?: DeployRecord | null;

  stats: {
    views: number;
    leads: number;
    byLocale: Partial<Record<PageLocale, { views: number; leads: number }>>;
    byVariantLocale: Partial<
      Record<NarrativeVariant, Partial<Record<PageLocale, { views: number; leads: number }>>>
    >;
    abStats: { A: { views: number; leads: number }; B: { views: number; leads: number } };
  };
}

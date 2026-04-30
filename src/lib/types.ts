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
  | 'japanese'
  // enterprise-b2b: Helios-style — short, product-screenshot-heavy, no
  // pain/testimonial/FAQ, logos+stats as separate sections, form as a
  // CTA-to-external-tool instead of an inline form. See CLAUDE.md §2.3
  // variant story for why this is a tone, not a separate narrative.
  | 'enterprise-b2b';

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

export type HeroLayout = 'split' | 'centered' | 'video-bg' | 'bold-stat' | 'editorial';

/**
 * Per-module font-size scale. Applied to the headline in Hero / CTA to
 * address the Feishu test feedback "字太小了，还不能设置" (#16). Scoped
 * to these two modules intentionally — opening it up to every module
 * would let users break the visual hierarchy they just paid the AI
 * generator to produce.
 */
export type FontScale = 'sm' | 'md' | 'lg' | 'xl';

export interface HeroContent {
  eyebrow: string;
  headline: string;
  subhead: string;
  /**
   * 反馈 #5：bold-stat layout 用大字号显示一个数字（"3×"）。原本是从
   * `bullets[0]` 里正则抽数字，编辑器无任何字段可改。新增显式字段 —
   * bold-stat 优先用 `statValue`，缺省时才回退到 bullets 抽取。其他
   * layout 不渲染这个字段（不影响 split / centered / video-bg / editorial）。
   */
  statValue?: string;
  /** 反馈 #5：和 statValue 配套的 label（默认渲染为小写 caption "OUTCOME"
   *  之类）。同样仅 bold-stat 用，缺省回退到 bullets[0] / eyebrow。 */
  statLabel?: string;
  primaryCta: string;
  /**
   * Optional click target for the primary CTA button. Defaults to
   * `#contact` (the in-page lead form anchor) when omitted — so the
   * button is never rendered as an inert element, which is the only
   * sane default for a landing page. Setting to a full URL
   * ("https://cal.com/acme/demo") renders an external link with
   * `target="_blank" rel="noopener"`. Added 2026-04 after QA found all
   * MVP Hero CTAs were `<button>` with no onClick/href and users
   * reported "点击没反应" in the Feishu test report (issue #8).
   */
  primaryCtaHref?: string;
  secondaryCta?: string;
  secondaryCtaHref?: string;
  bullets: string[];
  media?: MediaRef;
  layout?: HeroLayout; // default 'split'
  fontScale?: FontScale; // default 'md' — see FontScale comment
}

/**
 * ProductShowcase 布局选项（反馈 #17：用户报"只有这一个样式可用"）。
 * - 'alternating'：默认，左右交替，文字 + 截图 50/50（适合 3-5 条
 *   功能点，每条都有截图）
 * - 'gallery'：大图主导，文字简短压在卡片下方（适合"想展示产品大图"
 *   的场景，截图占主视觉权重）
 * 之后真有更多样式需求再加。
 */
export type ProductShowcaseLayout = 'alternating' | 'gallery';

export interface ProductShowcaseContent {
  title: string;
  subtitle?: string;
  items: Array<{
    title: string;
    body: string;
    bullets?: string[];
    media?: MediaRef; // each item has its own screenshot/video
  }>;
  layout?: ProductShowcaseLayout; // default 'alternating'
}

export interface VideoEmbedContent {
  title: string;
  subtitle?: string;
  media: MediaRef; // kind='video'
}

/**
 * SocialProof render modes. Helios-style pages use two separate socialProof
 * modules (one logos-only band near the top, one stats-only band near the
 * bottom) instead of stacking both in one section. 'logos-and-stats' stays
 * the default so old pages render unchanged.
 */
export type SocialProofVariant = 'logos-and-stats' | 'logos-only' | 'stats-only';

/**
 * A logo entry in a socialProof module.
 *
 * MVP schema stored logos as plain strings — the renderer drew each as a
 * text chip ("Acme", "Globex", …). That shipped before MediaRef existed.
 * Rather than migrate every old page, we kept string valid and added an
 * object shape alongside it:
 *
 *   "Acme"                              → text chip
 *   { src: "https://…", alt: "Acme" }   → <img>
 *   "https://acme.com/logo.png"         → <img>  (detected at render)
 *
 * Both render paths (PageRenderer + render-html) call
 * `resolveSocialProofLogo` so the detection stays in one place.
 */
export type SocialProofLogo = string | { src: string; alt?: string };

export type ResolvedSocialProofLogo =
  | { kind: 'image'; src: string; alt?: string }
  | { kind: 'text'; text: string };

/**
 * Decide whether a logo entry renders as an image or a text chip.
 * - object with a `src` → image
 * - string that looks like a URL (http(s):, data:) → image
 * - any other string → text chip
 */
export function resolveSocialProofLogo(l: SocialProofLogo): ResolvedSocialProofLogo {
  if (l && typeof l === 'object' && typeof l.src === 'string') {
    return { kind: 'image', src: l.src, alt: l.alt };
  }
  if (typeof l === 'string') {
    const s = l.trim();
    if (/^(https?:\/\/|data:)/i.test(s)) return { kind: 'image', src: s };
    return { kind: 'text', text: s };
  }
  return { kind: 'text', text: '' };
}

/**
 * Logo row display mode. 'scroll' renders a horizontally scrolling
 * marquee strip with pause-on-hover — Feishu #4 ("logo 展现样式无更多，
 * 如想让 logo 滚动起来"). Pure CSS, duplicates the logo list so the
 * animation loop has no visual seam. Mobile-safe (prefers-reduced-motion
 * disables the animation and reverts to the static grid).
 */
export type SocialProofLogoMode = 'grid' | 'scroll';

export interface SocialProofContent {
  title: string;
  logos: SocialProofLogo[];
  stats: { label: string; value: string }[];
  variant?: SocialProofVariant; // default 'logos-and-stats'
  logoMode?: SocialProofLogoMode; // default 'grid'
}

export interface PainContent {
  title: string;
  subtitle: string;
  /**
   * `media` on each item is optional and typically a small illustration or
   * icon-style graphic — GIFs/MP4 loops ("broken-dashboard" kind of vibes)
   * can reinforce the pain viscerally. Renderers treat it as a thumbnail;
   * cards without media fall back to the numeric badge they had before.
   */
  items: { title: string; body: string; media?: MediaRef }[];
}

export interface SolutionContent {
  title: string;
  subtitle: string;
  body: string;
  /**
   * Optional solution-level hero visual — architecture diagram, flow chart,
   * or "before vs after" comparison graphic. A single media slot (not per-
   * item) because the solution module itself is a single narrative beat.
   */
  media?: MediaRef;
}

export type BenefitsLayout = 'cards' | 'alternating' | 'compact';

export interface BenefitsContent {
  title: string;
  items: { title: string; body: string; media?: MediaRef }[];
  layout?: BenefitsLayout; // default 'cards'
}

export interface UseCaseContent {
  title: string;
  /**
   * Per-role media lets each use case carry its own screenshot (e.g. the
   * "PM 看板" vs "销售 pipeline" vs "客服 SLA" UI each get their actual
   * dashboard). Optional — items without media render as text-only rows.
   */
  items: { role: string; scenario: string; media?: MediaRef }[];
}

export interface TestimonialContent {
  title: string;
  /**
   * A testimonial item. `avatar` is optional — added Phase A together with
   * the shared upload pipeline so users can pair a quote with a headshot.
   * Old pages without `avatar` keep working; renderers show initials in a
   * circle as a fallback (see PageRenderer and render-html.ts).
   *
   * `avatar.kind` should be 'image' for headshots; the 'video'/'gif'/'logo'
   * kinds are accepted by the shared MediaField but make no visual sense
   * on a testimonial and are treated like 'image' by the renderer.
   */
  items: {
    quote: string;
    author: string;
    company: string;
    avatar?: MediaRef;
  }[];
}

export interface FAQContent {
  title: string;
  items: { q: string; a: string }[];
}

export interface CTAContent {
  headline: string;
  subhead: string;
  button: string;
  /**
   * Same reason as HeroContent.primaryCtaHref — MVP rendered the CTA
   * module's button as an inert `<button>` with no onClick. Defaults to
   * `#contact` when omitted. See CLAUDE.md §S1.5 Feishu issue #8.
   */
  buttonHref?: string;
  fontScale?: FontScale; // default 'md' — see FontScale comment on HeroContent
}

/**
 * Form modes:
 * - 'inline' (default): render the in-page form, POST to /api/leads.
 * - 'external': render the CTA button as an anchor pointing at `externalUrl`
 *   (飞书表单 / Typeform / Calendly / HubSpot Meetings). No inline fields,
 *   no consent checkbox — the external tool owns lead capture.
 * Old pages without `mode` render as 'inline' and keep working.
 */
export type FormMode = 'inline' | 'external';

/**
 * Lead form field identifiers. `smsCode` is a schema placeholder for
 * future SMS verification (Feishu #12) — the editor offers it, the
 * renderer shows a disabled "发送验证码" button with an "S2 上线" tooltip.
 * Actual SMS service integration is deferred to S2; the key exists now
 * so pages opting in don't need a data migration later.
 */
export type FormFieldKey = 'name' | 'email' | 'company' | 'phone' | 'message' | 'smsCode';

/**
 * Rich per-field spec (Feishu #11). When `FormContent.fieldSchemas` is
 * non-empty, it OVERRIDES the legacy string-array `fields` — order,
 * custom labels, required flag, placeholder all come from here.
 * Legacy pages without `fieldSchemas` render via `fields` exactly as
 * before. Editors always write the rich form going forward.
 */
export interface FormFieldSpec {
  key: FormFieldKey;
  label?: string;
  required?: boolean;
  placeholder?: string;
}

export interface FormContent {
  title: string;
  subtitle: string;
  /**
   * Legacy simple field list — still the primary source of truth for
   * pages created before #11 landed. Render path prefers `fieldSchemas`
   * when present, otherwise falls back to this list.
   */
  fields: FormFieldKey[];
  /** Rich schema override. Presence flips the renderer to the new path. */
  fieldSchemas?: FormFieldSpec[];
  submitLabel: string;
  mode?: FormMode;          // default 'inline'
  externalUrl?: string;     // required when mode='external'
}

/**
 * Resolve the effective ordered field list for rendering and validation.
 * Used by both PageRenderer (via LeadFormClient) and server-side lead
 * validation so the two never drift.
 */
export function resolveFormFields(c: FormContent): FormFieldSpec[] {
  if (c.fieldSchemas && c.fieldSchemas.length > 0) return c.fieldSchemas;
  return c.fields.map((k) => ({ key: k }));
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
  /** S2: tenant scope. Optional on the legacy compat view because old
   * KV blobs predate it; new writes always populate it. */
  tenantId?: string;
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
  /**
   * 反馈：静态导出（render-html.ts）也要带 nav。projectViewFromV2 从
   * page.nav 透传过来，render-html 在 body 顶部渲染一份纯静态 nav
   * （无 IntersectionObserver active 检测，但 anchor link 工作）。
   */
  nav?: {
    enabled: boolean;
    items?: Array<{ moduleId: string; label: string }>;
  };
  theme: {
    primary: string;
    secondary?: string;
    styleId: StyleId;
    /** Optional product-level font-family override (free-text custom).
     *  Carried through projectViewFromV2 so PageRenderer can layer it
     *  into resolveFontStack() between page-picker and market default. */
    fontStack?: string;
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
  // tenantId 在 S2 加上 — 来自 leads 所属 LandingPage 的 tenant，写入时
  // 直接 copy。读时缺 tenantId 的老数据视为 'default'（legacy tenant）。
  tenantId: string;
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

/**
 * A single logo / media entry in the brand library — one row in the
 * "企业品牌 → LOGO" list (or its press / cert siblings).
 *
 * Why this exists (vs the old `string[]` shape):
 *  - **Multi-format**: `media` is a MediaRef so the entry can be a
 *    static image, animated GIF, or a video — all from one type. UI
 *    re-uses the existing <MediaField /> component.
 *  - **Per-locale targeting**: `showIn` is a locale allowlist, empty/
 *    undefined = "all locales". Solves "阿里 logo 只用在 zh-CN 页面，
 *    LINE 只在 ja，Microsoft 哪都用" without forcing users to maintain
 *    parallel asset libraries per locale.
 *  - **Future-proof**: same shape can host press / cert entries — single
 *    UI component, single migration path.
 *
 * Locale variants vs locale targeting (don't confuse):
 *  - `showIn` = "this entry appears in pages of these locales" (audience)
 *  - `media.localizedUrls` = "the same entry has different image URLs
 *    per locale" (e.g. 腾讯 logo 中文版 vs Tencent 英文版)
 *  - Both can compose: a logo entry can be ja-only AND have a JP-specific
 *    URL, though typically one or the other is enough.
 */
export interface LogoEntry {
  id: string;
  media: MediaRef;
  /** Optional human-readable label — shown as row title in the editor and
   *  used as alt-text fallback in renderers when the asset is an image. */
  label?: string;
  /** Locale allowlist. Empty / undefined = applies to all locales. */
  showIn?: PageLocale[];
}

export interface BrandAsset {
  id: string;
  /**
   * 2026-04: migrated from `string[]` to `LogoEntry[]`. Storage layer
   * coerces legacy URL-only entries on read so old KV blobs keep working.
   */
  logos: LogoEntry[];
  primaryColor: string;
  /**
   * 2026-04: deprecated from the UI but kept in the schema for back-compat
   * reads. Most style presets compute their own secondary tone from
   * primary; explicit override was confusing 99% of users. Renderers still
   * honor it when present.
   */
  secondaryColor?: string;
  /**
   * 2026-04: deprecated from the UI for the same reason — users were
   * being asked to type CSS font-family strings, which is dev-tier UX.
   * Page-level fontPresetId via `<PageFontPicker />` is the preferred
   * mechanism. Field kept for back-compat reads (font-presets.ts fallback
   * chain still references it as layer 2 of 4).
   */
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
  /**
   * Optional media — supports image (outlet logo / article screenshot),
   * GIF, or video (CCTV / Bloomberg / 财经 video clip). When omitted,
   * renderers fall back to text-only (outlet + headline + quote).
   * Added 2026-04 alongside the LogoEntry brand-library refactor.
   */
  media?: MediaRef;
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

// Single Brand per tenant. tenantId replaces the legacy ownerId field
// (S2 multi-tenant work, 2026-04-25). Legacy rows in KV with
// ownerId:'default' are read-time coerced to tenantId:'default' (the
// LEGACY_TENANT_ID sentinel) — see storage.ts coerceTenant().
export interface Brand {
  tenantId: string;
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

// Product = 品牌下的一个具体产品，归属一个 tenant（S2 起 ownerId 字段
// 升级为 tenantId — 一个 tenant 可有多个 user 通过 tenant_members 协作）
export interface Product {
  id: string;
  tenantId: string;
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
// tenantId 在 S2 加上以做 tenant 范围隔离 — 同 productId 推断（落地页
// 永远跟所属产品同一个 tenant），但冗余存在 LP 上避免每次过滤都回查
// product。读时如缺 tenantId，从 product.tenantId 推断或 fallback 'default'。
export interface LandingPage {
  id: string;
  tenantId: string;
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

  /**
   * Optional font preset (see src/lib/font-presets.ts). If unset the
   * renderer falls back to product / brand / market-default in that
   * order. Stored as a string id (not the full font stack) so future
   * preset registry additions auto-apply to existing pages — and so
   * the picker UI can select the user's choice by id without a string-
   * compare against potentially drift-prone fontStack values.
   */
  fontPresetId?: string;

  /**
   * Top-of-page navigation (Feishu #10 "页面无导航"). When `enabled` is
   * true, PageRenderer prepends a sticky nav bar with anchor links to
   * each active non-hero module. Default false for old pages so nothing
   * changes silently. `items` is optional — if omitted the renderer
   * auto-derives labels from module types + locale.
   */
  nav?: {
    enabled: boolean;
    items?: Array<{ moduleId: string; label: string }>;
  };

  published: boolean;
  publishedAt?: number;
  deploy?: DeployRecord | null;

  /**
   * True when Claude module hydration did NOT succeed at least once for
   * the default locale (no API key, API error, or all 5 parallel module
   * rewrites returned null). Persisted on the page so the editor can
   * render a warning banner and the deploy pre-check can block publish.
   *
   * Cleared back to false the moment any subsequent hydration call
   * (add-locale / regenerate hero) succeeds and produces non-template
   * headline copy on at least one variant.
   */
  hydrationFailed?: boolean;

  /**
   * Parallel-locale instance fields (2026-04 refactor · CLAUDE.md §四 TODO #1).
   *
   * The v2 shape stored every locale inside a single LandingPage.variants.{A|B}.{locale}
   * map — "one page owns all locales". That conflates publish state, A/B variant,
   * lead counts, and deploy URLs across languages and makes Feishu #15 ("generated
   * locale can't sync previously edited source content") structurally unfixable:
   * there's no "source version" to inherit from and no "independent instance" to
   * diverge into. The parallel-instance model splits each (slug, locale) into its
   * own KV row so locales can be created, published, deleted, A/B'd, and analyzed
   * independently.
   *
   *   locale         — the single locale this row owns. When set, variants.{A|B}
   *                    typically only has this one key populated and the row is
   *                    treated as "the instance" for that language.
   *   localeGroupId  — shared id linking all sibling rows of the same product page
   *                    across locales. Rows in the same group share productId and
   *                    slug; they differ only in locale.
   *
   * Both fields are OPTIONAL for backward compat. Legacy rows leave them undefined
   * and continue to render via the multi-locale variants map. New rows created
   * with MULTI_LOCALE_AS_INSTANCES=1 populate both and the locale-group index set
   * in KV tracks siblings. P1 of the refactor adds the fields + storage helpers
   * but changes no behavior — existing save paths still produce legacy-shaped rows.
   */
  locale?: PageLocale;
  localeGroupId?: string;

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

// --- Multi-tenant auth (S1 of 2026-06 Summit 权限改造) -----------------
//
// User-facing auth for product-side customers (i.e. the people who come in
// to BUILD landing pages using this OS — distinct from the single-operator
// admin gate in admin-auth.ts). Four tables, KV-backed:
//
//   users           {id, email, ...}
//   tenants         {id, name, ownerId, ...}
//   tenant_members  join table (tenantId × userId + role)
//   invites         invite links (multi-use, not email-locked, 14-day TTL)
//
// Decisions locked 2026-04-21 with user:
//   · 邀请链接 NOT email-locked — anyone with link can join
//   · 一个 Gmail 可归属多 tenant — models it as pure many-to-many
//   · 邀请链接多次可用 — no usedBy/usedAt, owner flips `disabled` when done
//   · TTL 14d, 首次点 invite 显示确认页, owner 可停用邀请
//
// Login = magic link (S1) → Google/Microsoft OAuth (S3, non-blocking).
// All four tables' CRUD lives in storage.ts under the same KV pattern as
// Product/LandingPage so the existing retry + index-repair plumbing covers
// these too.

export type TenantRole = 'owner' | 'editor';

export interface User {
  id: string;
  email: string; // unique, lowercase canonical form
  displayName?: string;
  createdAt: number;
  lastLoginAt?: number;
  // OAuth bindings come in S3. Keep the shape open so we don't migrate
  // users when we add Google/Microsoft providers.
  oauth?: {
    google?: { sub: string; linkedAt: number };
    microsoft?: { sub: string; linkedAt: number };
  };
}

export interface Tenant {
  id: string;
  name: string;
  ownerId: string; // the user who created it (always also a member with role=owner)
  createdAt: number;
  // Soft-delete / suspension hooks — not used in S1 but reserving the
  // shape so we don't have to migrate when we add "billing paused" etc.
  disabled?: boolean;
}

export interface TenantMember {
  tenantId: string;
  userId: string;
  role: TenantRole;
  joinedAt: number;
  // Audit trail: which invite (if any) let them in. Null for the owner
  // who created the tenant, or for users added via future admin UI.
  invitedVia?: string; // invite token
}

export interface Invite {
  token: string; // URL-safe random, also the KV key
  tenantId: string;
  role: TenantRole;
  invitedBy: string; // userId
  createdAt: number;
  expiresAt: number; // 14 days from createdAt by default
  disabled?: boolean; // owner's kill switch — 2026-04-21 decision point 6
  // No `usedBy` / `usedAt` fields — this is a MULTI-USE link. To see who
  // came in via this token, query tenant_members where invitedVia=token.
}

export interface MagicLink {
  token: string;
  email: string; // lowercase canonical
  createdAt: number;
  expiresAt: number; // 15 min TTL
  usedAt?: number; // one-time: once set, verify rejects
  // Optional hint — if user clicked an invite link while logged out, we
  // remember which invite they were trying to accept so the verify
  // endpoint can redirect back to /invite/[token] after login.
  returnTo?: string;
}

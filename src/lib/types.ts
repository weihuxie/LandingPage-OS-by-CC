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

export type HeroLayout = 'split' | 'centered' | 'video-bg';

export interface HeroContent {
  eyebrow: string;
  headline: string;
  subhead: string;
  primaryCta: string;
  secondaryCta?: string;
  bullets: string[];
  media?: MediaRef;
  layout?: HeroLayout; // default 'split'
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

export interface SocialProofContent {
  title: string;
  logos: SocialProofLogo[];
  stats: { label: string; value: string }[];
  variant?: SocialProofVariant; // default 'logos-and-stats'
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

export interface FormContent {
  title: string;
  subtitle: string;
  fields: Array<'name' | 'email' | 'company' | 'phone' | 'message'>;
  submitLabel: string;
  mode?: FormMode;          // default 'inline'
  externalUrl?: string;     // required when mode='external'
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

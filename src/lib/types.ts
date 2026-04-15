export type LocaleCode = 'en' | 'zh-CN' | 'zh-TW' | 'ja';

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
  | 'form';

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
  | FormContent;

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
  industry?: string;
  tags: string[]; // e.g. ['pain-cost', 'benefit-roi']
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

// --- A/B Dual Narrative (PRD §4.3) -------------------------------------

export type NarrativeVariant = 'A' | 'B';

export interface ProjectVariants {
  A: PageModule[]; // Pain-Agitate-Solve
  B: PageModule[]; // Benefit-Focused
}

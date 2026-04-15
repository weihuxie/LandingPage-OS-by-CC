'use client';
import type {
  Project,
  PageModule,
  HeroContent,
  SocialProofContent,
  PainContent,
  SolutionContent,
  BenefitsContent,
  UseCaseContent,
  TestimonialContent,
  FAQContent,
  CTAContent,
  FormContent,
} from '@/lib/types';
import { STYLE_PRESETS, cssVarsForStyle } from '@/lib/styles';

type Props = {
  project: Project;
  device: 'desktop' | 'mobile';
  onSelectModule?: (id: string) => void;
  selectedId?: string | null;
  interactive?: boolean; // true only on public page
  locale?: string;
  variant?: 'A' | 'B';
};

export default function PageRenderer({
  project,
  device,
  onSelectModule,
  selectedId,
  interactive,
  locale,
  variant,
}: Props) {
  const primary = project.theme.primary || '#4861ff';
  const styleId = project.theme.styleId ?? 'saas-modern';
  const preset = STYLE_PRESETS[styleId] ?? STYLE_PRESETS['saas-modern'];
  const styleVars = cssVarsForStyle(preset, primary);

  return (
    <div
      className="bg-white"
      style={{ ...(styleVars as React.CSSProperties), fontFamily: preset.fontStack }}
      data-style={styleId}
    >
      {project.modules
        .filter((m) => m.enabled !== false)
        .map((m) => (
          <section
            key={m.id}
            onClick={() => onSelectModule?.(m.id)}
            className={`relative ${
              onSelectModule
                ? `cursor-pointer transition ${selectedId === m.id ? 'outline outline-2 outline-offset-[-2px] outline-brand-400' : 'hover:outline hover:outline-1 hover:outline-ink-300'}`
                : ''
            }`}
          >
            <ModuleBody module={m} device={device} interactive={interactive} project={project} locale={locale} variant={variant} />
          </section>
        ))}
      <footer className="border-t border-ink-100 px-6 py-6 text-center text-xs text-ink-300">
        © {new Date().getFullYear()} {project.inputs.name} · Built with LandingPage OS by CC
      </footer>
    </div>
  );
}

function ModuleBody({
  module,
  device,
  interactive,
  project,
  locale,
  variant,
}: {
  module: PageModule;
  device: 'desktop' | 'mobile';
  interactive?: boolean;
  project: Project;
  locale?: string;
  variant?: 'A' | 'B';
}) {
  switch (module.type) {
    case 'hero':
      return <Hero content={module.content as HeroContent} device={device} />;
    case 'socialProof':
      return <SocialProof content={module.content as SocialProofContent} />;
    case 'pain':
      return <Pain content={module.content as PainContent} />;
    case 'solution':
      return <Solution content={module.content as SolutionContent} />;
    case 'benefits':
      return <Benefits content={module.content as BenefitsContent} />;
    case 'useCase':
      return <UseCases content={module.content as UseCaseContent} />;
    case 'testimonial':
      return <Testimonials content={module.content as TestimonialContent} />;
    case 'faq':
      return <FAQ content={module.content as FAQContent} />;
    case 'cta':
      return <CTA content={module.content as CTAContent} />;
    case 'form':
      return (
        <LeadForm
          content={module.content as FormContent}
          interactive={!!interactive}
          slug={project.slug}
          locale={locale || project.inputs.locale}
          variant={variant}
        />
      );
    default:
      return null;
  }
}

// --- Blocks -------------------------------------------------------------

function Hero({ content, device }: { content: HeroContent; device: 'desktop' | 'mobile' }) {
  // Style-aware background
  const bg = `
    var(--hero-bg-layer-1, radial-gradient(80% 60% at 10% 10%, color-mix(in oklch, var(--brand) 22%, transparent), transparent 60%)),
    var(--hero-bg-layer-2, linear-gradient(180deg, #ffffff, #f6f8ff))
  `;
  return (
    <div className="relative overflow-hidden" style={{ background: bg }}>
      <div className={`mx-auto px-6 ${device === 'mobile' ? 'py-12' : 'max-w-6xl py-20'}`}>
        {content.eyebrow && (
          <div
            className="inline-block border px-3 py-1 text-[11px] font-medium uppercase tracking-wider"
            style={{
              color: 'var(--brand)',
              borderColor: 'color-mix(in oklch, var(--brand) 30%, white)',
              borderRadius: 'var(--radius, 16px)',
            }}
          >
            {content.eyebrow}
          </div>
        )}
        <h1
          className={`mt-4 tracking-tight text-ink-900 ${device === 'mobile' ? 'text-3xl' : 'text-5xl md:text-6xl'}`}
          style={{ fontWeight: 'var(--heading-weight, 600)' as any, lineHeight: 1.2 }}
        >
          {content.headline}
        </h1>
        <p className={`mt-4 max-w-2xl text-ink-500 ${device === 'mobile' ? 'text-base' : 'text-lg'}`}>
          {content.subhead}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            className="rounded-xl px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
            style={{ background: 'var(--brand)' }}
          >
            {content.primaryCta}
          </button>
          {content.secondaryCta && (
            <button className="rounded-xl border border-ink-100 bg-white px-5 py-3 text-sm font-medium hover:border-ink-300">
              {content.secondaryCta}
            </button>
          )}
        </div>
        {content.bullets?.length > 0 && (
          <ul className={`mt-6 grid gap-2 text-sm text-ink-700 ${device === 'mobile' ? 'grid-cols-1' : 'grid-cols-3 max-w-3xl'}`}>
            {content.bullets.map((b, i) => (
              <li key={i} className="flex items-center gap-2">
                <span
                  className="grid h-5 w-5 place-items-center rounded-full text-white text-[10px]"
                  style={{ background: 'var(--brand)' }}
                >
                  ✓
                </span>
                {b}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SocialProof({ content }: { content: SocialProofContent }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="text-center text-xs font-medium uppercase tracking-wider text-ink-500">
        {content.title}
      </div>
      <div className="mt-5 grid grid-cols-3 items-center gap-4 sm:grid-cols-6">
        {content.logos.map((l, i) => (
          <div
            key={i}
            className="rounded-lg border border-ink-100 bg-white py-4 text-center text-sm font-medium text-ink-500"
          >
            {l}
          </div>
        ))}
      </div>
      {content.stats?.length > 0 && (
        <div className="mt-8 grid grid-cols-3 gap-3">
          {content.stats.map((s, i) => (
            <div
              key={i}
              className="rounded-2xl border border-ink-100 bg-white p-5 text-center"
            >
              <div className="text-2xl font-semibold text-ink-900">{s.value}</div>
              <div className="mt-1 text-xs text-ink-500">{s.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pain({ content }: { content: PainContent }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <h2 className="text-3xl font-semibold tracking-tight text-ink-900">{content.title}</h2>
      {content.subtitle && <p className="mt-2 text-ink-500">{content.subtitle}</p>}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {content.items.map((it, i) => (
          <div key={i} className="rounded-2xl border border-ink-100 bg-white p-5">
            <div
              className="grid h-8 w-8 place-items-center rounded-lg text-sm"
              style={{ background: 'color-mix(in oklch, var(--brand) 12%, white)', color: 'var(--brand)' }}
            >
              {i + 1}
            </div>
            <h3 className="mt-3 font-semibold">{it.title}</h3>
            <p className="mt-1 text-sm text-ink-500">{it.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Solution({ content }: { content: SolutionContent }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <div className="rounded-3xl border border-ink-100 bg-gradient-to-br from-white to-ink-100/30 p-8 sm:p-12">
        <h2 className="text-3xl font-semibold tracking-tight text-ink-900">{content.title}</h2>
        {content.subtitle && <p className="mt-2 text-ink-500">{content.subtitle}</p>}
        <p className="mt-4 max-w-3xl text-ink-700">{content.body}</p>
      </div>
    </div>
  );
}

function Benefits({ content }: { content: BenefitsContent }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <h2 className="text-3xl font-semibold tracking-tight">{content.title}</h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {content.items.map((b, i) => (
          <div key={i} className="rounded-2xl border border-ink-100 bg-white p-5">
            <div className="h-1 w-8 rounded-full" style={{ background: 'var(--brand)' }} />
            <h3 className="mt-3 font-semibold">{b.title}</h3>
            <p className="mt-1 text-sm text-ink-500">{b.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function UseCases({ content }: { content: UseCaseContent }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <h2 className="text-3xl font-semibold tracking-tight">{content.title}</h2>
      <div className="mt-8 space-y-3">
        {content.items.map((it, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-2xl border border-ink-100 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="text-sm font-semibold text-ink-900">{it.role}</div>
            <div className="text-sm text-ink-500">{it.scenario}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Testimonials({ content }: { content: TestimonialContent }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <h2 className="text-3xl font-semibold tracking-tight">{content.title}</h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {content.items.map((it, i) => (
          <blockquote key={i} className="rounded-2xl border border-ink-100 bg-white p-6">
            <p className="text-ink-700">“{it.quote}”</p>
            <footer className="mt-3 text-sm text-ink-500">
              — {it.author}, {it.company}
            </footer>
          </blockquote>
        ))}
      </div>
    </div>
  );
}

function FAQ({ content }: { content: FAQContent }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <h2 className="text-3xl font-semibold tracking-tight">{content.title}</h2>
      <dl className="mt-6 divide-y divide-ink-100 rounded-2xl border border-ink-100 bg-white">
        {content.items.map((it, i) => (
          <div key={i} className="p-5">
            <dt className="font-medium text-ink-900">{it.q}</dt>
            <dd className="mt-2 text-sm text-ink-500">{it.a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CTA({ content }: { content: CTAContent }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <div
        className="flex flex-col items-start justify-between gap-4 rounded-3xl p-10 text-white sm:flex-row sm:items-center"
        style={{ background: 'linear-gradient(135deg, var(--brand), color-mix(in oklch, var(--brand) 60%, #0b1020))' }}
      >
        <div>
          <h3 className="text-2xl font-semibold">{content.headline}</h3>
          <p className="mt-1 text-white/80">{content.subhead}</p>
        </div>
        <button className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-ink-900 hover:bg-ink-100">
          {content.button}
        </button>
      </div>
    </div>
  );
}

function LeadForm({
  content,
  interactive,
  slug,
  locale,
  variant,
}: {
  content: FormContent;
  interactive: boolean;
  slug: string;
  locale: string;
  variant?: 'A' | 'B';
}) {
  return <LeadFormClient content={content} interactive={interactive} slug={slug} locale={locale} variant={variant} />;
}

import LeadFormClient from './LeadFormClient';

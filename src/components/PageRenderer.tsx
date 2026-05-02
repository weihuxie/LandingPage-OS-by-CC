'use client';
import { Fragment, type ReactNode } from 'react';
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
  ProductShowcaseContent,
  VideoEmbedContent,
  MediaRef,
  PageLocale,
  MarketCode,
  HeroLayout,
  BenefitsLayout,
  FontScale,
} from '@/lib/types';
import { resolveSocialProofLogo } from '@/lib/types';
import { STYLE_PRESETS, cssVarsForStyle } from '@/lib/styles';
import { resolveFontStack, type FontPresetId } from '@/lib/font-presets';
import {
  resolveMedia,
  detectVideoHost,
  youtubeEmbedUrl,
  vimeoEmbedUrl,
  loomEmbedUrl,
  isInlineLoopingVideo,
} from '@/lib/media';

type Props = {
  project: Project;
  device: 'desktop' | 'mobile';
  onSelectModule?: (id: string) => void;
  selectedId?: string | null;
  interactive?: boolean; // true only on public page
  locale?: string;
  variant?: 'A' | 'B';
  /** Font selection from the editor's settings modal. When set this
   *  takes precedence over Brand / Product / market-default font
   *  stacks. See src/lib/font-presets.ts for the precedence chain. */
  fontPresetId?: FontPresetId | null;
  /** Brand-level fontStack override (free-text custom). Falls between
   *  fontPresetId and Product/market in priority. Caller passes from
   *  the loaded Brand record. */
  brandFontStack?: string | null;
};

/**
 * Render a string preserving manual `\n` as `<br />`.
 *
 * 反馈 #9 / #11：用户在 hero headline / solution title 等大标题里手敲
 * 换行，HTML 默认把 `\n` 折成空格 → 渲染出来一行长串。这个 helper 把
 * `\n` 还原成 `<br />`。
 *
 * 只用于"用户预期能换行"的字段（hero.headline / 各 module.title）。
 * subhead / body / quote 这种长文本段落不走这里——多段文字应该用 CSS
 * 的 `white-space: pre-wrap` 或重构成 array，而不是塞 `<br>`。
 */
function nl2br(text: string | undefined | null): ReactNode {
  if (!text) return text ?? '';
  if (!text.includes('\n')) return text;
  const lines = text.split('\n');
  return lines.map((line, i) => (
    <Fragment key={i}>
      {line}
      {i < lines.length - 1 && <br />}
    </Fragment>
  ));
}

export default function PageRenderer({
  project,
  device,
  onSelectModule,
  selectedId,
  interactive,
  locale,
  variant,
  fontPresetId,
  brandFontStack,
}: Props) {
  const primary = project.theme.primary || '#4861ff';
  const styleId = project.theme.styleId ?? 'saas-modern';
  const preset = STYLE_PRESETS[styleId] ?? STYLE_PRESETS['saas-modern'];
  const styleVars = cssVarsForStyle(preset, primary);
  const pageLocale = (locale ?? project.inputs.locale) as PageLocale;
  // Font precedence: page picker → brand custom → product theme → style preset.
  // null result means "no override; let the style-preset stack apply via the
  // existing fontFamily on the wrapper div".
  const overrideFontStack = resolveFontStack({
    pageFontPresetId: fontPresetId,
    brandFontStack,
    productFontStack: project.theme.fontStack,
  });

  const activeModules = project.modules.filter((m) => m.enabled !== false);

  return (
    <div
      className="bg-white"
      style={{
        ...(styleVars as React.CSSProperties),
        fontFamily: overrideFontStack ?? preset.fontStack,
        // 长无空格字符串（用户编辑器里能粘进去的 URL / 长 ID / 任意纯数字串）
        // 默认 overflow-wrap:normal 不换行，会撑破 grid/flex 卡片边界。
        // anywhere 在需要时允许任意位置断行，同时让 min-content 收缩到 0 —
        // 这样 grid item (`min-width:auto`) 不会被某条长字符串顶宽。
        // 全树继承，新模块/新字段不必单独处理。
        overflowWrap: 'anywhere',
      }}
      data-style={styleId}
    >
      {activeModules.map((m) => (
        <section
          key={m.id}
          id={`mod-${m.id}`}
          onClick={() => onSelectModule?.(m.id)}
          className={`relative scroll-mt-20 ${
            onSelectModule
              ? `cursor-pointer transition ${selectedId === m.id ? 'outline outline-2 outline-offset-[-2px] outline-brand-400' : 'hover:outline hover:outline-1 hover:outline-ink-300'}`
              : ''
          }`}
        >
          {/* 反馈 #4: Hero / CTA 按钮默认 href="#contact"，form 模块需
              要一个无视觉影响的 #contact 锚点，否则 SPA 内点 CTA 看着像
              "按钮没反应"。render-html.ts 静态导出版的 form 也用同样的
              id 命名保持一致。 */}
          {m.type === 'form' && (
            <span id="contact" aria-hidden className="block scroll-mt-20" />
          )}
          <ModuleBody module={m} device={device} interactive={interactive} project={project} locale={locale} variant={variant} />
        </section>
      ))}
      <footer className="border-t border-ink-100 px-6 py-6 text-center text-xs text-ink-300">
        © {new Date().getFullYear()} {project.inputs.name} · Built with LandingPage OS by CC
      </footer>
    </div>
  );
}

// nav 渲染已撤销 (2026-05) — 落地页是单一转化漏斗，sticky nav 给访客
// "逃跑路径"且抢 hero 的 50px 视口。pure function `resolveNavItems` +
// 测试保留在 src/lib/nav-resolver.ts，下次想恢复直接接回来即可。

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
  const pageLocale = (locale ?? project.inputs.locale) as PageLocale;
  const market = project.inputs.market as MarketCode;

  switch (module.type) {
    case 'hero':
      return (
        <Hero
          content={module.content as HeroContent}
          device={device}
          locale={pageLocale}
          market={market}
        />
      );
    case 'productShowcase':
      return (
        <ProductShowcase
          content={module.content as ProductShowcaseContent}
          locale={pageLocale}
          market={market}
        />
      );
    case 'videoEmbed':
      return (
        <VideoEmbed
          content={module.content as VideoEmbedContent}
          locale={pageLocale}
          market={market}
        />
      );
    case 'socialProof':
      return <SocialProof content={module.content as SocialProofContent} />;
    case 'pain':
      return (
        <Pain
          content={module.content as PainContent}
          locale={pageLocale}
          market={market}
        />
      );
    case 'solution':
      return (
        <Solution
          content={module.content as SolutionContent}
          locale={pageLocale}
          market={market}
        />
      );
    case 'benefits':
      return (
        <Benefits
          content={module.content as BenefitsContent}
          locale={pageLocale}
          market={market}
        />
      );
    case 'useCase':
      return (
        <UseCases
          content={module.content as UseCaseContent}
          locale={pageLocale}
          market={market}
        />
      );
    case 'testimonial':
      return (
        <Testimonials
          content={module.content as TestimonialContent}
          locale={pageLocale}
          market={market}
        />
      );
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

/**
 * Multiplier for the headline class in Hero / CTA. See FontScale in
 * types.ts — scoped to these two modules so users can fix "字太小了"
 * (Feishu #16) without wrecking hierarchy elsewhere.
 */
function headlineSizeClass(
  scale: FontScale | undefined,
  mobile: boolean,
  base: string,
): string {
  const s = scale ?? 'md';
  if (s === 'md') return base;
  if (mobile) {
    return s === 'sm' ? 'text-2xl' : s === 'lg' ? 'text-4xl' : 'text-5xl';
  }
  return s === 'sm'
    ? 'text-3xl md:text-4xl'
    : s === 'lg'
      ? 'text-6xl md:text-7xl'
      : 'text-7xl md:text-8xl';
}

function Hero({
  content,
  device,
  locale,
  market,
}: {
  content: HeroContent;
  device: 'desktop' | 'mobile';
  locale: PageLocale;
  market: MarketCode;
}) {
  const layout: HeroLayout = content.layout ?? 'split';
  const media = resolveMedia(content.media, locale, market);
  const hasMedia = !!media;
  const mobile = device === 'mobile';

  const eyebrow = content.eyebrow && (
    <div
      className="inline-block border px-3 py-1 text-[11px] font-medium uppercase tracking-wider"
      style={{
        color: layout === 'video-bg' ? '#fff' : 'var(--brand)',
        borderColor: layout === 'video-bg' ? 'rgba(255,255,255,0.3)' : 'color-mix(in oklch, var(--brand) 30%, white)',
        borderRadius: 'var(--radius, 16px)',
      }}
    >
      {content.eyebrow}
    </div>
  );

  const baseHeadlineSize = mobile
    ? 'text-3xl'
    : layout === 'centered'
      ? 'text-5xl md:text-6xl'
      : hasMedia
        ? 'text-4xl md:text-5xl'
        : 'text-5xl md:text-6xl';
  const isDark = layout === 'video-bg' || layout === 'editorial';
  const headline = (
    <h1
      className={`mt-4 tracking-tight ${layout === 'video-bg' ? 'text-white' : 'text-ink-900'} ${
        layout === 'editorial' ? 'font-serif' : ''
      } ${headlineSizeClass(content.fontScale, mobile, baseHeadlineSize)}`}
      style={{ fontWeight: 'var(--heading-weight, 600)' as any, lineHeight: 1.15 }}
    >
      {nl2br(content.headline)}
    </h1>
  );

  const sub = (
    <p className={`mt-4 ${layout === 'video-bg' ? 'text-white/80' : 'text-ink-500'} ${mobile ? 'text-base' : 'text-lg'} ${layout === 'centered' ? 'mx-auto max-w-2xl' : 'max-w-2xl'}`}>
      {content.subhead}
    </p>
  );

  // Real links, not <button>. MVP rendered these as <button> with no
  // onClick/href — visually correct, functionally inert. Users clicked
  // "预约演示" in the preview, nothing happened, and (per Feishu issue
  // #8) assumed the page was broken. Default to `#contact` so the CTA
  // always scrolls to the inline lead form; users can override via
  // HeroContent.primaryCtaHref / secondaryCtaHref to point at Calendly,
  // an external booking tool, etc. External URLs open in a new tab.
  const primaryHref = content.primaryCtaHref?.trim() || '#contact';
  const secondaryHref = content.secondaryCtaHref?.trim() || '#contact';
  const isExt = (h: string) => /^https?:\/\//i.test(h);
  const ctas = (
    <div className={`mt-6 flex flex-wrap items-center gap-3 ${layout === 'centered' ? 'justify-center' : ''}`}>
      <a
        href={primaryHref}
        target={isExt(primaryHref) ? '_blank' : undefined}
        rel={isExt(primaryHref) ? 'noopener noreferrer' : undefined}
        className="rounded-xl px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
        style={{ background: layout === 'video-bg' ? 'rgba(255,255,255,0.2)' : 'var(--brand)' }}
      >
        {content.primaryCta}
      </a>
      {/* 反馈 #5: secondaryCta 是 whitespace-only ("  ") 时之前会渲染
          一个空白按钮（视觉是个空 rectangle）。trim 后判断真实有内容
          才渲染。 */}
      {content.secondaryCta?.trim() && (
        <a
          href={secondaryHref}
          target={isExt(secondaryHref) ? '_blank' : undefined}
          rel={isExt(secondaryHref) ? 'noopener noreferrer' : undefined}
          className={`rounded-xl border px-5 py-3 text-sm font-medium ${layout === 'video-bg' ? 'border-white/30 text-white hover:bg-white/10' : 'border-ink-100 bg-white hover:border-ink-300'}`}
        >
          {content.secondaryCta}
        </a>
      )}
    </div>
  );

  const bullets = content.bullets?.length > 0 && (
    <ul className={`mt-6 grid gap-2 text-sm ${layout === 'video-bg' ? 'text-white/90' : 'text-ink-700'} ${
      mobile || layout === 'split' ? 'grid-cols-1' : 'grid-cols-3 max-w-3xl'
    } ${layout === 'centered' ? 'mx-auto' : ''}`}>
      {content.bullets.map((b, i) => (
        <li key={i} className="flex items-center gap-2">
          <span className="grid h-5 w-5 place-items-center rounded-full text-white text-[10px]" style={{ background: 'var(--brand)' }}>✓</span>
          {b}
        </li>
      ))}
    </ul>
  );

  // ---- Layout: split (左文右图) ----
  if (layout === 'split') {
    const bg = 'radial-gradient(80% 60% at 10% 10%, color-mix(in oklch, var(--brand) 22%, transparent), transparent 60%), linear-gradient(180deg, #fff, #f6f8ff)';
    return (
      <div className="relative overflow-hidden" style={{ background: bg }}>
        <div className={`mx-auto px-6 ${mobile ? 'py-12' : 'max-w-6xl py-20'} ${hasMedia && !mobile ? 'grid grid-cols-2 items-center gap-10' : ''}`}>
          <div>{eyebrow}{headline}{sub}{ctas}{bullets}</div>
          {hasMedia && <div className="relative mt-8 md:mt-0"><HeroMedia media={content.media!} resolved={media!} device={device} /></div>}
        </div>
      </div>
    );
  }

  // ---- Layout: centered (居中文案 + 下方大图) ----
  if (layout === 'centered') {
    const bg = 'radial-gradient(60% 40% at 50% 20%, color-mix(in oklch, var(--brand) 18%, transparent), transparent 60%), linear-gradient(180deg, #fff, #f6f8ff)';
    return (
      <div className="relative overflow-hidden" style={{ background: bg }}>
        <div className={`mx-auto px-6 text-center ${mobile ? 'py-12' : 'max-w-5xl py-24'}`}>
          {eyebrow}{headline}{sub}{ctas}{bullets}
          {hasMedia && (
            <div className="mx-auto mt-10 max-w-4xl">
              <HeroMedia media={content.media!} resolved={media!} device={device} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- Layout: bold-stat (大数字主导) ----
  if (layout === 'bold-stat') {
    const firstBullet = content.bullets?.[0];
    // 反馈 #5: 优先显式 statValue / statLabel；缺省时回退到从 bullet[0]
    // 抽数字 + bullet[0] 全文（保留旧数据兼容性）。这样新页面在编辑器里
    // 改 statValue 字段就立刻生效，不必改 bullet。
    const statValue =
      content.statValue?.trim() ||
      firstBullet?.match(/[\d][\d.,×%+]*/)?.[0] ||
      '3×';
    const statLabel =
      content.statLabel?.trim() ||
      firstBullet ||
      content.eyebrow ||
      'OUTCOME';
    const bg = 'linear-gradient(135deg, #0b1020 0%, color-mix(in oklch, var(--brand) 70%, #0b1020) 100%)';
    return (
      <div className="relative overflow-hidden text-white" style={{ background: bg }}>
        <div className={`mx-auto px-6 ${mobile ? 'py-16' : 'max-w-6xl py-24'} ${mobile ? '' : 'grid grid-cols-5 items-center gap-10'}`}>
          <div className={mobile ? '' : 'col-span-2'}>
            <div
              className={`font-extrabold leading-none ${mobile ? 'text-6xl' : 'text-8xl md:text-9xl'}`}
              style={{ color: 'color-mix(in oklch, var(--brand) 60%, white)' }}
            >
              {statValue}
            </div>
            <div className="mt-2 text-sm uppercase tracking-widest text-white/60">
              {statLabel}
            </div>
          </div>
          <div className={mobile ? 'mt-6' : 'col-span-3'}>
            {content.eyebrow && (
              <div className="inline-block border border-white/30 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-white/80" style={{ borderRadius: 'var(--radius, 16px)' }}>
                {content.eyebrow}
              </div>
            )}
            <h1
              className={`mt-4 tracking-tight text-white ${headlineSizeClass(content.fontScale, mobile, mobile ? 'text-3xl' : 'text-4xl md:text-5xl')}`}
              style={{ fontWeight: 'var(--heading-weight, 600)' as any, lineHeight: 1.15 }}
            >
              {nl2br(content.headline)}
            </h1>
            <p className={`mt-4 text-white/70 ${mobile ? 'text-base' : 'text-lg'} max-w-2xl`}>
              {content.subhead}
            </p>
            {ctas}
          </div>
        </div>
      </div>
    );
  }

  // ---- Layout: editorial (衬线分栏) ----
  if (layout === 'editorial') {
    return (
      <div className="relative overflow-hidden border-b-2 border-ink-900 bg-white">
        <div className={`mx-auto px-6 ${mobile ? 'py-12' : 'max-w-5xl py-20'}`}>
          {content.eyebrow && (
            <div className="border-b border-ink-900 pb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-ink-900">
              {content.eyebrow}
            </div>
          )}
          {headline}
          <div className={`mt-6 ${mobile ? '' : 'grid grid-cols-2 gap-10'}`}>
            <p className={`text-ink-700 ${mobile ? 'text-base' : 'text-lg'}`} style={{ lineHeight: 1.7 }}>
              {content.subhead}
            </p>
            {bullets}
          </div>
          {ctas}
          {hasMedia && (
            <div className="mt-10 border-t border-ink-100 pt-10">
              <HeroMedia media={content.media!} resolved={media!} device={device} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- Layout: video-bg (满屏渐变 + 文案叠加) ----
  return (
    <div className="relative overflow-hidden" style={{ minHeight: mobile ? 400 : 560 }}>
      {/* Background gradient layer */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, var(--brand), color-mix(in oklch, var(--brand) 50%, #0b1020))`,
        }}
      />
      {/* Media as dim background (if provided) */}
      {hasMedia && media.url && (
        <div className="absolute inset-0 opacity-20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={media.url} alt="" className="h-full w-full object-cover" loading="lazy" />
        </div>
      )}
      {/* Content overlay */}
      <div className={`relative mx-auto flex h-full min-h-[inherit] flex-col items-center justify-center px-6 text-center ${mobile ? 'py-16' : 'py-28'}`}>
        {eyebrow}{headline}{sub}{ctas}{bullets}
      </div>
    </div>
  );
}

function HeroMedia({
  media,
  resolved,
  device,
}: {
  media: MediaRef;
  resolved: { url: string; alt?: string };
  device: 'desktop' | 'mobile';
}) {
  if (media.kind === 'video') {
    const host = detectVideoHost(resolved.url);
    if (host === 'mp4') {
      return (
        <video
          className="w-full rounded-2xl border border-ink-100 shadow-soft"
          src={resolved.url}
          poster={media.poster}
          muted
          autoPlay
          loop
          playsInline
        />
      );
    }
    const src =
      host === 'youtube'
        ? youtubeEmbedUrl(resolved.url)
        : host === 'vimeo'
          ? vimeoEmbedUrl(resolved.url)
          : host === 'loom'
            ? loomEmbedUrl(resolved.url)
            : resolved.url;
    return (
      <div className="aspect-video overflow-hidden rounded-2xl border border-ink-100 shadow-soft">
        <iframe
          className="h-full w-full"
          src={src}
          title={resolved.alt ?? 'Demo video'}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
    );
  }
  // Non-video kind (image / gif / logo). If the URL is actually an inline
  // video format (.mp4 / .webm / .mov) — which happens when a user pastes
  // a lightweight demo loop into a GIF slot — render as an autoplaying
  // looping <video>, so they get the "GIF experience" at ~10% of the
  // file size. Otherwise standard <img> (browsers auto-loop real GIFs).
  if (isInlineLoopingVideo(resolved.url)) {
    return (
      <video
        className="w-full rounded-2xl border border-ink-100 shadow-soft"
        src={resolved.url}
        muted
        autoPlay
        loop
        playsInline
        aria-label={resolved.alt}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolved.url}
      alt={resolved.alt ?? ''}
      className="w-full rounded-2xl border border-ink-100 shadow-soft"
      loading="lazy"
    />
  );
}

function SocialProof({ content }: { content: SocialProofContent }) {
  // variant controls which bands show:
  //   'logos-only'  → logo wall only  (Helios top trust band)
  //   'stats-only'  → stats grid only (Helios bottom metrics band)
  //   'logos-and-stats' (default)     → stack both (legacy)
  const variant = content.variant ?? 'logos-and-stats';
  const showLogos = variant !== 'stats-only' && content.logos?.length > 0;
  const showStats = variant !== 'logos-only' && content.stats?.length > 0;
  const scroll = content.logoMode === 'scroll';
  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="text-center text-xs font-medium uppercase tracking-wider text-ink-500">
        {nl2br(content.title)}
      </div>
      {showLogos && !scroll && (
        <div className="mt-5 grid grid-cols-3 items-center gap-4 sm:grid-cols-6">
          {content.logos.map((l, i) => {
            const r = resolveSocialProofLogo(l);
            return r.kind === 'image' ? (
              // 反馈 #18: 之前 max-h-8 (32px) 让方形 logo 在 1:1 比例下
              // 显得比长方形 logo 小很多。容器改固定 h-16 (64px)，图片
              // max-h-full 让方形吃满高度，长方形也保留 max-w-full
              // object-contain 比例不变。整体视觉单元更大、square/wide
              // 之间差距缩小。
              <div
                key={i}
                className="flex h-16 items-center justify-center rounded-lg border border-ink-100 bg-white p-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.src}
                  alt={r.alt ?? ''}
                  loading="lazy"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <div
                key={i}
                className="rounded-lg border border-ink-100 bg-white py-4 text-center text-sm font-medium text-ink-500"
              >
                {r.text}
              </div>
            );
          })}
        </div>
      )}
      {showLogos && scroll && <LogoScroll logos={content.logos} />}
      {showStats && (
        <div className={`grid grid-cols-3 gap-3 ${showLogos ? 'mt-8' : 'mt-5'}`}>
          {content.stats.map((s, i) => (
            <div
              key={i}
              className="min-w-0 rounded-2xl border border-ink-100 bg-white p-5 text-center"
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

/**
 * Marquee logo strip (Feishu #4). Pure CSS animation; duplicates the list
 * so the loop has no visual seam. `prefers-reduced-motion` stops the
 * animation (WCAG) and edges fade to mask the seam on hover-pause.
 */
function LogoScroll({ logos }: { logos: SocialProofContent['logos'] }) {
  // Duplicate so the second copy slides in as the first slides out.
  const doubled = [...logos, ...logos];
  return (
    <div
      className="logo-scroll-mask mt-5 overflow-hidden"
      style={{
        WebkitMaskImage:
          'linear-gradient(90deg, transparent, black 10%, black 90%, transparent)',
        maskImage:
          'linear-gradient(90deg, transparent, black 10%, black 90%, transparent)',
      }}
    >
      <div
        className="logo-scroll-track flex gap-6 py-2"
        style={{
          width: 'max-content',
          animation: `logoScroll ${Math.max(20, logos.length * 3)}s linear infinite`,
        }}
      >
        {doubled.map((l, i) => {
          const r = resolveSocialProofLogo(l);
          return r.kind === 'image' ? (
            <div
              key={i}
              className="flex h-14 w-36 flex-shrink-0 items-center justify-center rounded-lg border border-ink-100 bg-white p-3"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={r.src}
                alt={r.alt ?? ''}
                loading="lazy"
                className="max-h-8 max-w-full object-contain"
              />
            </div>
          ) : (
            <div
              key={i}
              className="flex h-14 w-36 flex-shrink-0 items-center justify-center rounded-lg border border-ink-100 bg-white text-sm font-medium text-ink-500"
            >
              {r.text}
            </div>
          );
        })}
      </div>
      <style jsx>{`
        @keyframes logoScroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .logo-scroll-track:hover { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) {
          .logo-scroll-track { animation: none !important; transform: none !important; }
        }
      `}</style>
    </div>
  );
}

function Pain({
  content,
  locale,
  market,
}: {
  content: PainContent;
  locale: PageLocale;
  market: MarketCode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <h2 className="text-3xl font-semibold tracking-tight text-ink-900">{nl2br(content.title)}</h2>
      {content.subtitle && <p className="mt-2 text-ink-500">{content.subtitle}</p>}
      <div className="mt-8 grid gap-4 sm:grid-cols-3 items-stretch">
        {content.items.map((it, i) => {
          const m = resolveMedia(it.media, locale, market);
          return (
            <div
              key={i}
              className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white"
            >
              {m && <BenefitThumb url={m.url} alt={m.alt ?? it.title} />}
              <div className="flex flex-1 flex-col p-5">
                <div
                  className="grid h-8 w-8 place-items-center rounded-lg text-sm"
                  style={{ background: 'color-mix(in oklch, var(--brand) 12%, white)', color: 'var(--brand)' }}
                >
                  {i + 1}
                </div>
                <h3 className="mt-3 font-semibold">{it.title}</h3>
                <p className="mt-1 text-sm text-ink-500">{it.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Solution({
  content,
  locale,
  market,
}: {
  content: SolutionContent;
  locale: PageLocale;
  market: MarketCode;
}) {
  const m = resolveMedia(content.media, locale, market);
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <div className="rounded-3xl border border-ink-100 bg-gradient-to-br from-white to-ink-100/30 p-8 sm:p-12">
        <h2 className="text-3xl font-semibold tracking-tight text-ink-900">{nl2br(content.title)}</h2>
        {content.subtitle && <p className="mt-2 text-ink-500">{content.subtitle}</p>}
        {/* 反馈 #3: body 用 max-w-3xl 在 max-w-6xl 卡片里看着右侧大块
            空白。删掉 prose 限宽，让 body 占满卡片宽度。可读性轻微
            下降（行长 > 720px），但视觉不再像 broken layout。 */}
        <p className="mt-4 text-ink-700">{content.body}</p>
        {m && (
          <div className="mt-8">
            {isInlineLoopingVideo(m.url) ? (
              <video
                className="w-full rounded-2xl border border-ink-100 shadow-soft"
                src={m.url}
                muted
                autoPlay
                loop
                playsInline
                aria-label={m.alt}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.url}
                alt={m.alt ?? ''}
                className="w-full rounded-2xl border border-ink-100 shadow-soft"
                loading="lazy"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Benefits({
  content,
  locale,
  market,
}: {
  content: BenefitsContent;
  locale: PageLocale;
  market: MarketCode;
}) {
  const layout: BenefitsLayout = content.layout ?? 'cards';

  // ---- cards (三列卡片，当前默认) ----
  if (layout === 'cards') {
    return (
      <div className="mx-auto max-w-6xl px-6 py-14">
        <h2 className="text-3xl font-semibold tracking-tight">{nl2br(content.title)}</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3 items-stretch">
          {content.items.map((b, i) => {
            const m = resolveMedia(b.media, locale, market);
            return (
              <div
                key={i}
                className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white"
              >
                {m && <BenefitThumb url={m.url} alt={m.alt ?? b.title} />}
                <div className="flex flex-1 flex-col p-5">
                  <div className="h-1 w-8 rounded-full" style={{ background: 'var(--brand)' }} />
                  <h3 className="mt-3 font-semibold">{b.title}</h3>
                  <p className="mt-1 text-sm text-ink-500">{b.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---- alternating (左文右图交替) ----
  if (layout === 'alternating') {
    return (
      <div className="mx-auto max-w-6xl px-6 py-14">
        <h2 className="text-3xl font-semibold tracking-tight">{nl2br(content.title)}</h2>
        <div className="mt-10 space-y-14">
          {content.items.map((b, i) => {
            const textFirst = i % 2 === 0;
            return (
              <div key={i} className="grid items-center gap-8 md:grid-cols-2">
                <div className={textFirst ? '' : 'md:order-2'}>
                  <div className="h-1 w-8 rounded-full" style={{ background: 'var(--brand)' }} />
                  <h3 className="mt-3 text-xl font-semibold">{b.title}</h3>
                  <p className="mt-2 text-ink-500">{b.body}</p>
                </div>
                <div className={textFirst ? '' : 'md:order-1'}>
                  {(() => {
                    const rm = resolveMedia(b.media, locale, market);
                    if (!rm) {
                      return (
                        <div className="grid aspect-video place-items-center rounded-2xl border border-dashed border-ink-100 bg-ink-100/30 text-xs text-ink-300">
                          配图可选
                        </div>
                      );
                    }
                    if (isInlineLoopingVideo(rm.url)) {
                      return (
                        <video
                          className="w-full rounded-2xl border border-ink-100 shadow-soft"
                          src={rm.url}
                          muted
                          autoPlay
                          loop
                          playsInline
                          aria-label={rm.alt}
                        />
                      );
                    }
                    return (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={rm.url}
                        alt={rm.alt ?? ''}
                        className="w-full rounded-2xl border border-ink-100 shadow-soft"
                        loading="lazy"
                      />
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---- compact (一行一条 · icon + 标题 + 描述，信息密度高) ----
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <h2 className="text-3xl font-semibold tracking-tight">{nl2br(content.title)}</h2>
      <div className="mt-6 divide-y divide-ink-100 rounded-2xl border border-ink-100 bg-white">
        {content.items.map((b, i) => (
          <div key={i} className="flex items-start gap-4 p-5">
            <div
              className="mt-1 grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-sm text-white"
              style={{ background: 'var(--brand)' }}
            >
              {i + 1}
            </div>
            <div>
              <h3 className="font-semibold">{b.title}</h3>
              <p className="mt-0.5 text-sm text-ink-500">{b.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Small thumbnail for a Benefits `cards` item (default layout). Picks
 * `<video loop muted autoplay>` for `.mp4` / `.webm` / `.mov` URLs and
 * `<img>` for everything else (static images + real GIF format). Fixed
 * 16:9 aspect so cards line up visually regardless of source aspect.
 */
function BenefitThumb({ url, alt }: { url: string; alt?: string }) {
  if (isInlineLoopingVideo(url)) {
    return (
      <div className="aspect-video w-full overflow-hidden bg-ink-100/40">
        <video
          className="h-full w-full object-cover"
          src={url}
          muted
          autoPlay
          loop
          playsInline
          aria-label={alt}
        />
      </div>
    );
  }
  return (
    <div className="aspect-video w-full overflow-hidden bg-ink-100/40">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt ?? ''}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    </div>
  );
}

function UseCases({
  content,
  locale,
  market,
}: {
  content: UseCaseContent;
  locale: PageLocale;
  market: MarketCode;
}) {
  // Per-item media is optional. If no item carries a screenshot, keep the
  // compact one-line rows (role on the left, scenario on the right) the
  // module has always had. As soon as *any* item has media the grid shifts
  // to a card layout so the screenshot has room — mixing skinny rows with
  // card rows in the same list looks visually broken.
  const anyMedia = content.items.some((it) =>
    resolveMedia(it.media, locale, market),
  );

  if (!anyMedia) {
    // 反馈 #12: 用户报"对齐问题，字数不一致就会不对齐"。原 flex-row +
    // justify-between 让 role 紧靠左缘 / scenario 紧靠右缘，行间因为
    // role 字数不同导致 scenario 起始 x 位置错乱。改成 grid 双列：
    // role 固定 9em 宽度（够 4 个中文字），scenario 占剩余。所有行的
    // scenario 起点都在同一 x 上 — 视觉对齐。
    return (
      <div className="mx-auto max-w-6xl px-6 py-14">
        <h2 className="text-3xl font-semibold tracking-tight">{nl2br(content.title)}</h2>
        <div className="mt-8 space-y-3">
          {content.items.map((it, i) => (
            <div
              key={i}
              className="rounded-2xl border border-ink-100 bg-white p-5 sm:grid sm:grid-cols-[9em_1fr] sm:items-baseline sm:gap-6 flex flex-col gap-2"
            >
              <div className="text-sm font-semibold text-ink-900">{it.role}</div>
              <div className="text-sm text-ink-500">{it.scenario}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <h2 className="text-3xl font-semibold tracking-tight">{nl2br(content.title)}</h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-stretch">
        {content.items.map((it, i) => {
          const m = resolveMedia(it.media, locale, market);
          return (
            <div
              key={i}
              className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white"
            >
              {m && <BenefitThumb url={m.url} alt={m.alt ?? it.role} />}
              <div className="flex flex-1 flex-col p-5">
                <div className="text-sm font-semibold text-ink-900">{it.role}</div>
                <div className="mt-1 text-sm text-ink-500">{it.scenario}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Testimonials({
  content,
  locale,
  market,
}: {
  content: TestimonialContent;
  locale: PageLocale;
  market: MarketCode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <h2 className="text-3xl font-semibold tracking-tight">{nl2br(content.title)}</h2>
      {/* 反馈 #13: 用户报"字数要差不多才能整齐"。默认 grid auto-rows
          让每行高度跟着该行最高 item，row 之间高度可能不一。改 auto-rows-fr
          强制所有行均高，整体视觉节奏更整齐。 */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 items-stretch auto-rows-fr">
        {content.items.map((it, i) => {
          const avatar = resolveMedia(it.avatar, locale, market);
          return (
            // min-w-0: grid item 默认 min-width:auto = min-content，长无空格
            // quote 会撑破 grid track。手动设 0 让 item 严格服从 grid track 宽度。
            <blockquote key={i} className="flex h-full min-w-0 flex-col rounded-2xl border border-ink-100 bg-white p-6">
              <p className="flex-1 text-ink-700">“{it.quote}”</p>
              <footer className="mt-3 flex items-center gap-3 text-sm text-ink-500">
                {avatar ? (
                  // 反馈 #14b: 头像 default object-position center 裁掉头顶。
                  // 头像照片普遍是上中部位置（眼睛 + 微笑）；改 25% Y 让
                  // 圆形 mask 偏上方裁切，头顶不被切。
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatar.url}
                    alt={avatar.alt ?? it.author}
                    className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-ink-100"
                    style={{ objectPosition: '50% 25%' }}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-medium text-ink-700"
                  >
                    {initialsOf(it.author)}
                  </span>
                )}
                {/* min-w-0: footer 是 flex row，author/company span 默认 min-width:
                    auto 会被长名挤出 footer 边界。配合上层 overflow-wrap:anywhere
                    继承，author 长串可在 footer 内任意位置断行。 */}
                <span className="min-w-0">
                  — {it.author}, {it.company}
                </span>
              </footer>
            </blockquote>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Pull 1–2 uppercase initials from a human name so testimonial cards have a
 * reasonable placeholder when no avatar is uploaded. Handles CJK names by
 * falling back to the first visible character (initials don't really exist
 * there, and cramming "田中太" into an avatar looks worse than just "田").
 */
function initialsOf(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '·';
  const hasLatin = /[A-Za-z]/.test(trimmed);
  if (!hasLatin) return [...trimmed][0] ?? '·';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase() || '·';
}

function FAQ({ content }: { content: FAQContent }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <h2 className="text-3xl font-semibold tracking-tight">{nl2br(content.title)}</h2>
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
  // Same fix as Hero — MVP rendered as <button> with no onClick.
  // Default to #contact; `buttonHref` overrides to external URL (opens
  // in new tab) or custom anchor.
  const href = content.buttonHref?.trim() || '#contact';
  const isExt = /^https?:\/\//i.test(href);
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <div
        className="flex flex-col items-start justify-between gap-4 rounded-3xl p-10 text-white sm:flex-row sm:items-center"
        style={{ background: 'linear-gradient(135deg, var(--brand), color-mix(in oklch, var(--brand) 60%, #0b1020))' }}
      >
        <div>
          <h3 className={`font-semibold ${headlineSizeClass(content.fontScale, false, 'text-2xl')}`}>
            {nl2br(content.headline)}
          </h3>
          <p className="mt-1 text-white/80">{content.subhead}</p>
        </div>
        <a
          href={href}
          target={isExt ? '_blank' : undefined}
          rel={isExt ? 'noopener noreferrer' : undefined}
          className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-ink-900 hover:bg-ink-100"
        >
          {content.button}
        </a>
      </div>
    </div>
  );
}

function ProductShowcase({
  content,
  locale,
  market,
}: {
  content: ProductShowcaseContent;
  locale: PageLocale;
  market: MarketCode;
}) {
  // 反馈 #17: 新增 gallery layout，大图主导文字简短压底，针对"想展示
  // 产品大图"场景。alternating 默认仍是左右交替。
  const layout = content.layout ?? 'alternating';
  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <div className="max-w-3xl">
        <h2 className="text-3xl font-semibold tracking-tight">{nl2br(content.title)}</h2>
        {content.subtitle && <p className="mt-2 text-ink-500">{content.subtitle}</p>}
      </div>
      {layout === 'gallery' ? (
        // Gallery layout: 大图横铺，标题 + 简介压在卡片下方。bullets 隐藏
        // （这种 layout 视觉权重在图，文字越精简越好）。
        <div className="mt-10 space-y-10">
          {content.items.map((it, i) => {
            const m = resolveMedia(it.media, locale, market);
            return (
              <div key={i} className="min-w-0 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-soft">
                {m ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.url}
                    alt={m.alt ?? it.title}
                    className="block w-full"
                    loading="lazy"
                  />
                ) : (
                  <div className="grid aspect-video place-items-center bg-ink-100/30 text-xs text-ink-300">
                    截图缺失
                  </div>
                )}
                <div className="p-6">
                  <h3 className="text-xl font-semibold">{it.title}</h3>
                  {it.body && <p className="mt-2 text-ink-500">{it.body}</p>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-10 space-y-14">
          {content.items.map((it, i) => {
            const m = resolveMedia(it.media, locale, market);
            const textFirst = i % 2 === 0;
            return (
              // 反馈 #15: items-center 让短文字对齐到大图的垂直中点，文字
              // 像悬浮在中间。改 items-start，文字与图顶部对齐，视觉锚定
              // 一致。
              <div key={i} className="grid items-start gap-8 md:grid-cols-2">
                <div className={textFirst ? '' : 'md:order-2'}>
                  <h3 className="text-xl font-semibold">{it.title}</h3>
                  <p className="mt-2 text-ink-500">{it.body}</p>
                  {it.bullets && it.bullets.length > 0 && (
                    <ul className="mt-4 space-y-1.5 text-sm text-ink-700">
                      {it.bullets.map((b, j) => (
                        <li key={j} className="flex gap-2">
                          <span
                            className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                            style={{ background: 'var(--brand)' }}
                          />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className={textFirst ? '' : 'md:order-1'}>
                  {m ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.url}
                      alt={m.alt ?? ''}
                      className="w-full rounded-2xl border border-ink-100 shadow-soft"
                      loading="lazy"
                    />
                  ) : (
                    <div className="grid aspect-video place-items-center rounded-2xl border border-dashed border-ink-100 bg-ink-100/30 text-xs text-ink-300">
                      截图缺失
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VideoEmbed({
  content,
  locale,
  market,
}: {
  content: VideoEmbedContent;
  locale: PageLocale;
  market: MarketCode;
}) {
  const m = resolveMedia(content.media, locale, market);
  const host = m ? detectVideoHost(m.url) : 'other';
  return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <div className="max-w-2xl">
        <h2 className="text-3xl font-semibold tracking-tight">{nl2br(content.title)}</h2>
        {content.subtitle && <p className="mt-2 text-ink-500">{content.subtitle}</p>}
      </div>
      <div className="mt-6 aspect-video overflow-hidden rounded-2xl border border-ink-100 shadow-soft">
        {m ? (
          host === 'mp4' ? (
            <video className="h-full w-full" src={m.url} poster={content.media.poster} controls playsInline />
          ) : (
            <iframe
              className="h-full w-full"
              src={
                host === 'youtube'
                  ? youtubeEmbedUrl(m.url)
                  : host === 'vimeo'
                    ? vimeoEmbedUrl(m.url)
                    : host === 'loom'
                      ? loomEmbedUrl(m.url)
                      : m.url
              }
              title={m.alt ?? content.title}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          )
        ) : (
          <div className="grid h-full place-items-center bg-ink-100/30 text-xs text-ink-300">
            视频 URL 未填
          </div>
        )}
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

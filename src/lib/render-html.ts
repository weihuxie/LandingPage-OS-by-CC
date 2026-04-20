import type {
  Project,
  SocialProofLogo,
  PageLocale,
  MarketCode,
  MediaRef,
} from './types';
import { resolveSocialProofLogo } from './types';
import { resolveMedia } from './media';
import { STYLE_PRESETS, cssVarsForStyle } from './styles';

/**
 * Serialize a Project to a self-contained static HTML document.
 * Used by: GET /api/projects/:id/export (download), and Vercel deploy.
 */
export function renderProjectHtml(project: Project): string {
  const primary = project.theme.primary || '#4861ff';
  const preset =
    STYLE_PRESETS[project.theme.styleId ?? 'saas-modern'] ??
    STYLE_PRESETS['saas-modern'];
  const vars = cssVarsForStyle(preset, primary);
  const cssVarBlock = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');

  const locale = project.inputs.locale as PageLocale;
  const market = project.inputs.market as MarketCode;
  const modulesHtml = project.modules
    .map((m) => serializeModule(m, locale, market))
    .join('\n');

  return `<!doctype html>
<html lang="${project.inputs.locale}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(project.inputs.name)} — ${escapeHtml(project.inputs.tagline)}</title>
<meta name="description" content="${escapeHtml(project.inputs.value || project.inputs.tagline)}" />
<meta property="og:title" content="${escapeHtml(project.inputs.name)}" />
<meta property="og:description" content="${escapeHtml(project.inputs.tagline)}" />
<style>
:root {
${cssVarBlock}
}
* { box-sizing: border-box; }
html, body { margin: 0; font-family: ${preset.fontStack}; color: #0b1020; background: #fff; line-height: 1.7; }
.wrap { max-width: 1152px; margin: 0 auto; padding: 0 24px; }
h1, h2, h3 { line-height: 1.25; margin: 0; font-weight: var(--heading-weight); }
.hero { padding: 96px 0; background: radial-gradient(80% 60% at 10% 10%, color-mix(in oklch, var(--brand) 22%, transparent), transparent 60%), linear-gradient(180deg, #fff, #f6f8ff); }
.eyebrow { display: inline-block; padding: 4px 12px; border: 1px solid color-mix(in oklch, var(--brand) 30%, white); border-radius: var(--radius); color: var(--brand); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
.h1 { font-size: 56px; margin-top: 16px; letter-spacing: -.01em; }
.sub { margin-top: 16px; color: #5b6478; max-width: 720px; font-size: 18px; }
.cta { display: inline-block; margin-top: 24px; padding: 14px 22px; border-radius: var(--radius); background: var(--brand); color: #fff; font-weight: 500; text-decoration: none; }
.section { padding: var(--density-y, 56px) 0; }
.grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.card { border: 1px solid #e6e9f0; border-radius: var(--radius); padding: 20px; background: #fff; }
.muted { color: #5b6478; font-size: 14px; margin-top: 4px; }
@media (max-width: 720px) {
  .hero { padding: 56px 0; }
  .h1 { font-size: 32px; }
  .grid3 { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
${modulesHtml}
<footer style="border-top:1px solid #e6e9f0;padding:24px 0;text-align:center;color:#aab1c0;font-size:12px;">© ${new Date().getFullYear()} ${escapeHtml(project.inputs.name)} · Built with LandingPage OS by CC</footer>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function serializeModule(
  m: any,
  locale: PageLocale,
  market: MarketCode,
): string {
  const c = m.content;
  switch (m.type) {
    case 'hero':
      return `<section class="hero"><div class="wrap">
        <span class="eyebrow">${escapeHtml(c.eyebrow)}</span>
        <h1 class="h1">${escapeHtml(c.headline)}</h1>
        <p class="sub">${escapeHtml(c.subhead)}</p>
        <a class="cta" href="#contact">${escapeHtml(c.primaryCta)}</a>
      </div></section>`;
    case 'socialProof': {
      // variant controls which bands render:
      //   'logos-only'     → logo wall, no stats
      //   'stats-only'     → stats grid, no logos
      //   'logos-and-stats' (default) → both stacked
      const variant = c.variant ?? 'logos-and-stats';
      const showLogos = variant !== 'stats-only';
      const showStats = variant !== 'logos-only';
      const logosHtml = showLogos && (c.logos ?? []).length
        ? `<div class="grid3" style="margin-top:24px">${(c.logos ?? [])
            .map((l: SocialProofLogo) => {
              const r = resolveSocialProofLogo(l);
              return r.kind === 'image'
                ? `<div class="card" style="text-align:center;padding:12px;display:flex;align-items:center;justify-content:center"><img src="${escapeHtml(r.src)}" alt="${escapeHtml(r.alt ?? '')}" loading="lazy" style="max-height:32px;max-width:100%;object-fit:contain" /></div>`
                : `<div class="card" style="text-align:center">${escapeHtml(r.text)}</div>`;
            })
            .join('')}</div>`
        : '';
      const statsHtml = showStats && (c.stats ?? []).length
        ? `<div class="grid3" style="margin-top:${showLogos ? '16px' : '24px'}">${(c.stats ?? [])
            .map(
              (s: { label: string; value: string }) =>
                `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:600;color:#0b1020">${escapeHtml(s.value)}</div><div class="muted">${escapeHtml(s.label)}</div></div>`,
            )
            .join('')}</div>`
        : '';
      return `<section class="section"><div class="wrap">
        <div style="text-align:center;color:#5b6478;font-size:12px;text-transform:uppercase;letter-spacing:.08em">${escapeHtml(c.title)}</div>
        ${logosHtml}
        ${statsHtml}
      </div></section>`;
    }
    case 'pain':
      return `<section class="section"><div class="wrap">
        <h2>${escapeHtml(c.title)}</h2>
        <div class="grid3" style="margin-top:24px">${(c.items ?? [])
          .map(
            (it: any) =>
              `<div class="card"><h3>${escapeHtml(it.title)}</h3><p class="muted">${escapeHtml(it.body)}</p></div>`,
          )
          .join('')}</div>
      </div></section>`;
    case 'solution':
      return `<section class="section"><div class="wrap card"><h2>${escapeHtml(c.title)}</h2><p class="muted" style="max-width:720px;margin-top:8px">${escapeHtml(c.body)}</p></div></section>`;
    case 'benefits':
      return `<section class="section"><div class="wrap">
        <h2>${escapeHtml(c.title)}</h2>
        <div class="grid3" style="margin-top:24px">${(c.items ?? [])
          .map(
            (it: any) =>
              `<div class="card"><h3>${escapeHtml(it.title)}</h3><p class="muted">${escapeHtml(it.body)}</p></div>`,
          )
          .join('')}</div>
      </div></section>`;
    case 'useCase':
      return `<section class="section"><div class="wrap"><h2>${escapeHtml(c.title)}</h2><div style="margin-top:24px">${(c.items ?? [])
        .map(
          (it: any) =>
            `<div class="card" style="margin-top:8px"><strong>${escapeHtml(it.role)}</strong><div class="muted">${escapeHtml(it.scenario)}</div></div>`,
        )
        .join('')}</div></div></section>`;
    case 'testimonial':
      return `<section class="section"><div class="wrap"><h2>${escapeHtml(c.title)}</h2><div class="grid3" style="margin-top:24px">${(c.items ?? [])
        .map((it: { quote: string; author: string; company: string; avatar?: MediaRef }) => {
          const avatar = resolveMedia(it.avatar, locale, market);
          const avatarHtml = avatar
            ? `<img src="${escapeHtml(avatar.url)}" alt="${escapeHtml(avatar.alt ?? it.author)}" loading="lazy" style="width:36px;height:36px;border-radius:999px;object-fit:cover;flex-shrink:0;box-shadow:0 0 0 1px #e6e9f0" />`
            : `<span aria-hidden="true" style="width:36px;height:36px;border-radius:999px;background:#eef1f8;color:#3b4554;font-size:12px;font-weight:500;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${escapeHtml(initialsOfHtml(it.author))}</span>`;
          return `<div class="card"><p>"${escapeHtml(it.quote)}"</p><div class="muted" style="display:flex;align-items:center;gap:10px;margin-top:12px">${avatarHtml}<span>— ${escapeHtml(it.author)}, ${escapeHtml(it.company)}</span></div></div>`;
        })
        .join('')}</div></div></section>`;
    case 'faq':
      return `<section class="section"><div class="wrap" style="max-width:720px"><h2>${escapeHtml(c.title)}</h2>${(c.items ?? [])
        .map(
          (it: any) =>
            `<div class="card" style="margin-top:8px"><strong>${escapeHtml(it.q)}</strong><p class="muted">${escapeHtml(it.a)}</p></div>`,
        )
        .join('')}</div></section>`;
    case 'cta':
      return `<section class="section"><div class="wrap"><div style="background:linear-gradient(135deg,var(--brand),color-mix(in oklch,var(--brand) 60%,#0b1020));color:#fff;padding:56px;border-radius:calc(var(--radius,16px) * 1.5);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px"><div><h3 style="font-size:28px">${escapeHtml(c.headline)}</h3><p style="opacity:.8;margin-top:8px">${escapeHtml(c.subhead)}</p></div><a href="#contact" style="background:#fff;color:#0b1020;padding:14px 22px;border-radius:var(--radius);text-decoration:none;font-weight:500">${escapeHtml(c.button)}</a></div></div></section>`;
    case 'form': {
      const mode = c.mode ?? 'inline';
      // External mode: render as a CTA-style card linking to the external
      // tool (飞书表单 / Typeform / Calendly). No inline inputs, no static
      // fallback note — the anchor works in the exported HTML as-is. If
      // externalUrl is empty we still render the card so the layout isn't
      // jarring, just with href="#contact" as a no-op placeholder.
      if (mode === 'external') {
        const href = c.externalUrl && typeof c.externalUrl === 'string' ? c.externalUrl : '#contact';
        const isExternal = /^https?:\/\//i.test(href);
        return `<section class="section" id="contact"><div class="wrap" style="max-width:720px"><div class="card" style="padding:40px;text-align:center"><h3>${escapeHtml(c.title)}</h3><p class="muted">${escapeHtml(c.subtitle)}</p><a class="cta" href="${escapeHtml(href)}"${isExternal ? ' target="_blank" rel="noopener"' : ''} style="margin-top:20px">${escapeHtml(c.submitLabel)}</a></div></div></section>`;
      }
      return `<section class="section" id="contact"><div class="wrap" style="max-width:720px"><div class="card" style="padding:40px"><h3>${escapeHtml(c.title)}</h3><p class="muted">${escapeHtml(c.subtitle)}</p><p class="muted" style="margin-top:16px">(此导出版为静态 HTML。实际提交请接入你的表单服务或改用托管发布。)</p></div></div></section>`;
    }
    default:
      return '';
  }
}

/**
 * HTML-side mirror of `initialsOf()` in PageRenderer — kept separate because
 * render-html.ts is consumed by deploy / export and can't import from the
 * React component. Returns 1–2 characters suitable for a round placeholder
 * when a testimonial has no avatar upload. CJK names fall back to the
 * first visible character (initials don't really make sense there).
 */
function initialsOfHtml(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '·';
  const hasLatin = /[A-Za-z]/.test(trimmed);
  if (!hasLatin) return [...trimmed][0] ?? '·';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase() || '·';
}

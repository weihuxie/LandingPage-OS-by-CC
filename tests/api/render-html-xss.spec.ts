/**
 * API-RENDER-* · renderProjectHtml XSS + branch matrix.
 *
 * Covers from audit-2026-05.md §2.10 (the full XSS matrix):
 *   401  hero.headline with `<script>` → escaped (P0 XSS)
 *   402  hero.headline with \n → preserved as <br> (multiline field)
 *   403  hero.subhead with \n → collapsed (subhead is single-line)
 *   404  hero no primaryCtaHref → href='#contact' default
 *   405  hero https:// CTA href → target=_blank + rel=noopener
 *   406  hero `javascript:` CTA href → escaped, NOT marked target=_blank (DOCUMENTING current behavior)
 *   407  form external mode + valid URL → renders <a href> with target=_blank
 *   408  form external mode + empty URL → href fallback to '#contact'
 *   409  form inline mode → renders the disclaimer text
 *   410  hero media kind=video + YouTube URL → <iframe> with embed-style URL
 *   411  hero media kind=video + .mp4 URL → <video src=> autoplay loop muted
 *   412  hero media .gif URL (no kind) → <img>, NOT <video>
 *   413  testimonial author='张三', no avatar → initials placeholder '张'
 *   414  testimonial author='John Doe', no avatar → initials 'JD'
 *   415  testimonial author='', no avatar → initials '·'
 *   416  socialProof variant='logos-only' → no stats block rendered
 *   417  socialProof variant='stats-only' → no logos block rendered
 *   418  useCase all-text items → compact list branch
 *   419  useCase any item with media → grid + thumbnail branch
 *   420  product name with `"` → meta og:title escaped to &quot; (P0)
 *   421  unknown module type → serializeModule returns '' (no throw)
 *   422  testimonial avatar URL with `<` → escaped before src attribute (P0)
 *
 * All tests construct a minimal Project, render once, then grep the
 * resulting HTML string. Pure function under test — no I/O, no fixtures.
 */
import { test, expect } from '@playwright/test';
import { renderProjectHtml } from '../../src/lib/render-html';
import type { Project, PageModule } from '../../src/lib/types';

function buildProject(modules: PageModule[], overrides: Partial<Project['inputs']> = {}): Project {
  return {
    id: 'lp_x',
    tenantId: 't_x',
    slug: 'x',
    createdAt: 1,
    updatedAt: 1,
    inputs: {
      name: 'TestProduct',
      tagline: 'Test tagline',
      category: 'SaaS',
      value: 'Test value',
      cta: 'demo',
      market: 'CN',
      locale: 'zh-CN',
      industry: 'SaaS',
      companySize: '10-50',
      role: 'PM',
      source: 'ads',
      pastedContent: '',
      referenceUrls: [],
      uploadedFileNames: [],
      ...overrides,
    },
    tone: 'saas',
    strategy: { audience: ['a'], goal: ['g'], narrative: ['n'], local: ['l'] },
    modules,
    variants: { A: modules, B: modules },
    activeVariant: 'A',
    publishMode: 'single',
    theme: { primary: '#000', styleId: 'saas-modern' },
    published: false,
  };
}

function hero(content: any): PageModule {
  return { id: 'hero1', type: 'hero', enabled: true, content } as any;
}
function form(content: any): PageModule {
  return { id: 'form1', type: 'form', enabled: true, content } as any;
}
function socialProof(content: any): PageModule {
  return { id: 'sp1', type: 'socialProof', enabled: true, content } as any;
}
function useCase(content: any): PageModule {
  return { id: 'uc1', type: 'useCase', enabled: true, content } as any;
}
function testimonial(content: any): PageModule {
  return { id: 'ts1', type: 'testimonial', enabled: true, content } as any;
}

const HERO_BASE = {
  eyebrow: 'eb',
  headline: 'h',
  subhead: 's',
  primaryCta: 'Go',
};

test.describe('API-RENDER · hero text + escape', () => {

  test('API-RENDER-401 · hero.headline `<script>alert(1)</script>` → escaped, raw tag absent', () => {
    const html = renderProjectHtml(
      buildProject([hero({ ...HERO_BASE, headline: '<script>alert(1)</script>' })]),
    );
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  test('API-RENDER-402 · hero.headline `line1\\nline2` → `line1<br>line2` (multiline)', () => {
    const html = renderProjectHtml(
      buildProject([hero({ ...HERO_BASE, headline: 'line1\nline2' })]),
    );
    expect(html).toContain('line1<br>line2');
  });

  test('API-RENDER-403 · hero.subhead with \\n → NOT converted to <br>', () => {
    const html = renderProjectHtml(
      buildProject([hero({ ...HERO_BASE, subhead: 'line1\nline2' })]),
    );
    // subhead goes through escapeHtml (not multiline). Default browser
    // collapses literal \n to a space when rendered, but the HTML still
    // contains the raw `\n`. The contract: NO <br> tag inserted.
    const subheadIdx = html.indexOf('class="sub"');
    const slice = html.slice(subheadIdx, subheadIdx + 200);
    expect(slice).not.toContain('<br>');
  });
});

test.describe('API-RENDER · hero CTA href handling', () => {

  test('API-RENDER-404 · no primaryCtaHref → defaults to #contact', () => {
    const html = renderProjectHtml(buildProject([hero(HERO_BASE)]));
    expect(html).toContain('href="#contact"');
  });

  test('API-RENDER-405 · https:// CTA → target=_blank + rel=noopener', () => {
    const html = renderProjectHtml(
      buildProject([hero({ ...HERO_BASE, primaryCtaHref: 'https://example.com/demo' })]),
    );
    expect(html).toContain('href="https://example.com/demo"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test('API-RENDER-406 · `javascript:` CTA → escaped, NOT marked target=_blank (CLARIFY: should reject?)', () => {
    // Documents the CURRENT behavior: render-html.ts only checks for
    // `https?://` to add target=_blank. A `javascript:` URL is escaped
    // through escapeHtml (so the inner text doesn't break out of the
    // attribute) but is otherwise emitted verbatim into href=. Modern
    // browsers no longer execute javascript: from in-page navigation by
    // default (Chrome 88+, Firefox 89+), but treat this as a CLARIFY:
    // the secure default would be to reject the URL outright. Until
    // user decides, lock behavior so any future change is caught here.
    const html = renderProjectHtml(
      buildProject([hero({ ...HERO_BASE, primaryCtaHref: 'javascript:alert(1)' })]),
    );
    // Escaped version IS in the output (currently no rejection).
    expect(html).toContain('href="javascript:alert(1)"');
    // No target=_blank since it doesn't match /^https?:\/\//.
    const heroSection = html.slice(html.indexOf('<section class="hero">'));
    const ctaIdx = heroSection.indexOf('javascript:alert(1)');
    const ctaTag = heroSection.slice(Math.max(0, ctaIdx - 100), ctaIdx + 100);
    expect(ctaTag).not.toContain('target="_blank"');
  });
});

test.describe('API-RENDER · form mode handling', () => {

  test('API-RENDER-407 · external mode + valid URL → <a href> with target=_blank', () => {
    const html = renderProjectHtml(
      buildProject([
        form({
          mode: 'external',
          externalUrl: 'https://forms.feishu.cn/x123',
          title: 'Contact',
          subtitle: 's',
          submitLabel: 'Submit',
        }),
      ]),
    );
    expect(html).toContain('href="https://forms.feishu.cn/x123"');
    expect(html).toContain('target="_blank"');
  });

  test('API-RENDER-408 · external mode + empty externalUrl → href falls back to #contact', () => {
    const html = renderProjectHtml(
      buildProject([
        form({
          mode: 'external',
          externalUrl: '',
          title: 'Contact',
          subtitle: 's',
          submitLabel: 'Submit',
        }),
      ]),
    );
    expect(html).toContain('href="#contact"');
  });

  test('API-RENDER-409 · inline mode → renders static-export disclaimer text', () => {
    const html = renderProjectHtml(
      buildProject([
        form({
          mode: 'inline',
          title: 'Contact',
          subtitle: 's',
          submitLabel: 'Submit',
        }),
      ]),
    );
    expect(html).toContain('(此导出版为静态 HTML');
  });
});

test.describe('API-RENDER · hero media branch decision', () => {

  test('API-RENDER-410 · kind=video + YouTube URL → <iframe> embed', () => {
    const html = renderProjectHtml(
      buildProject([
        hero({
          ...HERO_BASE,
          media: { id: 'm', kind: 'video', url: 'https://youtu.be/dQw4w9WgXcQ' },
        }),
      ]),
    );
    expect(html).toContain('<iframe');
    expect(html).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
  });

  test('API-RENDER-411 · kind=video + .mp4 URL → <video> autoplay loop muted', () => {
    const html = renderProjectHtml(
      buildProject([
        hero({
          ...HERO_BASE,
          media: { id: 'm', kind: 'video', url: 'https://cdn.example.com/demo.mp4' },
        }),
      ]),
    );
    expect(html).toContain('<video src="https://cdn.example.com/demo.mp4"');
    expect(html).toContain('autoplay');
    expect(html).toContain('loop');
    expect(html).toContain('muted');
  });

  test('API-RENDER-412 · .gif URL (no kind) → <img>, not <video>', () => {
    const html = renderProjectHtml(
      buildProject([
        hero({
          ...HERO_BASE,
          media: { id: 'm', url: 'https://cdn.example.com/anim.gif' },
        }),
      ]),
    );
    expect(html).toContain('<img src="https://cdn.example.com/anim.gif"');
    // The hero-media block should NOT pick the inline-looping-video path
    // for a real .gif file.
    const heroBlock = html.slice(html.indexOf('<section class="hero">'));
    expect(heroBlock).not.toContain('<video src="https://cdn.example.com/anim.gif"');
  });
});

test.describe('API-RENDER · testimonial avatar/initials placeholder', () => {

  test('API-RENDER-413 · CJK author no avatar → initials shows first character', () => {
    const html = renderProjectHtml(
      buildProject([
        testimonial({
          title: 'T',
          items: [{ quote: 'q', author: '张三', company: 'C' }],
        }),
      ]),
    );
    expect(html).toContain('>张</span>');
  });

  test('API-RENDER-414 · Latin author "John Doe" no avatar → initials JD', () => {
    const html = renderProjectHtml(
      buildProject([
        testimonial({
          title: 'T',
          items: [{ quote: 'q', author: 'John Doe', company: 'C' }],
        }),
      ]),
    );
    expect(html).toContain('>JD</span>');
  });

  test('API-RENDER-415 · empty author no avatar → initials placeholder "·"', () => {
    const html = renderProjectHtml(
      buildProject([
        testimonial({
          title: 'T',
          items: [{ quote: 'q', author: '', company: 'C' }],
        }),
      ]),
    );
    expect(html).toContain('>·</span>');
  });

  test('API-RENDER-422 · testimonial avatar URL with `<` → escaped before src attribute (P0 XSS)', () => {
    const html = renderProjectHtml(
      buildProject([
        testimonial({
          title: 'T',
          items: [
            {
              quote: 'q',
              author: 'A',
              company: 'C',
              avatar: { id: 'a', kind: 'image', url: 'https://x/<script>' },
            },
          ],
        }),
      ]),
    );
    // The escape pass must replace `<` with `&lt;` in the URL before
    // it lands in the src attribute. Otherwise an attacker-controlled
    // URL like `"><script>...` could break out of the attribute.
    expect(html).toContain('src="https://x/&lt;script&gt;"');
    expect(html).not.toContain('src="https://x/<script>"');
  });
});

test.describe('API-RENDER · socialProof variant decision', () => {

  test('API-RENDER-416 · variant=logos-only → no stats grid', () => {
    // Logo shape: resolveSocialProofLogo accepts strings (text logos) or
    // objects with `src` (image logos). The `{kind,text}` shape resolves
    // to empty — would silently pass the absence assertion below for the
    // wrong reason. Using strings makes both halves of the test mean
    // what they say.
    const html = renderProjectHtml(
      buildProject([
        socialProof({
          title: 'Trusted by',
          variant: 'logos-only',
          logos: ['AcmeLogoMarker'],
          stats: [{ label: 'STAT_LABEL_MARKER', value: 'STAT_VALUE_MARKER' }],
        }),
      ]),
    );
    // Logos branch present.
    expect(html).toContain('AcmeLogoMarker');
    // Stats branch suppressed.
    expect(html).not.toContain('STAT_VALUE_MARKER');
    expect(html).not.toContain('STAT_LABEL_MARKER');
  });

  test('API-RENDER-417 · variant=stats-only → no logos grid', () => {
    const html = renderProjectHtml(
      buildProject([
        socialProof({
          title: 'Numbers',
          variant: 'stats-only',
          logos: ['SHOULD_NOT_RENDER_LOGO'],
          stats: [{ label: 'customers', value: '500+' }],
        }),
      ]),
    );
    expect(html).toContain('500+'); // stats present
    expect(html).not.toContain('SHOULD_NOT_RENDER_LOGO'); // logos suppressed
  });
});

test.describe('API-RENDER · useCase compact vs grid branch', () => {

  test('API-RENDER-418 · all-text items → compact list', () => {
    const html = renderProjectHtml(
      buildProject([
        useCase({
          title: 'Use cases',
          items: [
            { role: 'PM', scenario: 'planning' },
            { role: 'Engineer', scenario: 'coding' },
          ],
        }),
      ]),
    );
    const block = html.slice(html.indexOf('Use cases'));
    // Compact branch uses margin-top:8px on cards (no aspect-ratio
    // thumbnail wrapper).
    expect(block).toContain('margin-top:8px');
    // No thumbnail aspect-ratio block when no media.
    const ucSection = block.slice(0, block.indexOf('</section>'));
    expect(ucSection).not.toContain('aspect-ratio:16/9');
  });

  test('API-RENDER-419 · any item with media → grid + thumbnail branch', () => {
    const html = renderProjectHtml(
      buildProject([
        useCase({
          title: 'Use cases',
          items: [
            { role: 'PM', scenario: 'planning' },
            {
              role: 'Engineer',
              scenario: 'coding',
              media: { id: 'm', kind: 'image', url: 'https://x/u.png' },
            },
          ],
        }),
      ]),
    );
    const block = html.slice(html.indexOf('Use cases'));
    expect(block).toContain('aspect-ratio:16/9');
    expect(block).toContain('class="grid3"');
  });
});

test.describe('API-RENDER · doc-level escape + unknown type', () => {

  test('API-RENDER-420 · product name with `"` → og:title attr escaped to &quot; (P0 XSS)', () => {
    const html = renderProjectHtml(
      buildProject([hero(HERO_BASE)], { name: 'Acme "Pro" Edition' }),
    );
    // og:title meta — content attribute must escape the quote. Without
    // this an attacker-controlled product name with `"` could break
    // out of the meta content attribute.
    expect(html).toContain(
      '<meta property="og:title" content="Acme &quot;Pro&quot; Edition"',
    );
    expect(html).not.toContain('content="Acme "Pro" Edition"');
    // Same defense in the <title> tag.
    expect(html).toContain('Acme &quot;Pro&quot; Edition');
  });

  test('API-RENDER-421 · unknown module type → serializeModule returns "" (graceful skip)', () => {
    // Use distinctive marker so the absence assertion isn't false-
    // positived by `font` or `footer` substrings in the boilerplate CSS.
    const html = renderProjectHtml(
      buildProject([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({
          id: 'x',
          type: 'unknownType' as any,
          enabled: true,
          content: { headline: 'XYZQ-CONTENT-MARKER-9F9F' },
        }) as any,
      ]),
    );
    // Should not throw, should not render the unknown-type content.
    // Document + footer still present.
    expect(html).toContain('<!doctype html>');
    expect(html).not.toContain('XYZQ-CONTENT-MARKER-9F9F');
  });
});

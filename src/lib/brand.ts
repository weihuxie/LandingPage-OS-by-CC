/**
 * Brand color extractor — per PRD v5.1 §5.
 *
 * Strategy (cheapest first):
 *   1. <meta name="theme-color" content="#xxx">
 *   2. <link rel="mask-icon" color="#xxx">
 *   3. CSS variables on :root scan: --primary | --brand | --color-primary
 *   4. Inline style attributes / css rules containing hex colors weighted by frequency
 *
 * All runs server-side, no browser canvas required.
 * Reasonable timeout so a slow/unreachable URL doesn't block the wizard.
 */

const HEX = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;

export interface BrandExtract {
  primary?: string;
  candidates: string[];
  source: 'theme-color' | 'mask-icon' | 'css-var' | 'frequency' | 'none';
  siteTitle?: string;
  logoUrl?: string;
}

function normHex(h: string): string {
  let x = h.startsWith('#') ? h : `#${h}`;
  if (x.length === 4) {
    x = '#' + [...x.slice(1)].map((c) => c + c).join('');
  }
  return x.toLowerCase();
}

// Ignore near-neutrals (greys/whites/blacks) when picking from frequency.
function isBland(hex: string): boolean {
  const h = hex.replace('#', '');
  if (h.length !== 6) return true;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const lightness = (max + min) / 2;
  // Reject near-black, near-white, and greys
  if (lightness < 20 || lightness > 235) return true;
  if (chroma < 18) return true;
  return false;
}

export async function extractBrand(url: string): Promise<BrandExtract> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; LandingPageOS/1.0; +https://example.com)',
        accept: 'text/html,*/*',
      },
    });
    clearTimeout(timer);
    const html = await res.text();

    // 1) theme-color
    const themeColor = html.match(
      /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i,
    );
    if (themeColor?.[1]) {
      const hex = themeColor[1].startsWith('#') ? normHex(themeColor[1]) : undefined;
      if (hex) {
        return {
          primary: hex,
          candidates: [hex],
          source: 'theme-color',
          siteTitle: pickTitle(html),
          logoUrl: pickLogo(html, url),
        };
      }
    }

    // 2) mask-icon color
    const maskIcon = html.match(
      /<link[^>]+rel=["']mask-icon["'][^>]+color=["'](#[0-9a-fA-F]{3,6})["']/i,
    );
    if (maskIcon?.[1]) {
      return {
        primary: normHex(maskIcon[1]),
        candidates: [normHex(maskIcon[1])],
        source: 'mask-icon',
        siteTitle: pickTitle(html),
        logoUrl: pickLogo(html, url),
      };
    }

    // 3) CSS variables on :root
    const cssVarRe =
      /--(?:primary|brand|color-primary|accent)\s*:\s*(#[0-9a-fA-F]{3,6})/gi;
    const cssVarMatches = [...html.matchAll(cssVarRe)];
    if (cssVarMatches.length) {
      const hex = normHex(cssVarMatches[0][1]);
      return {
        primary: hex,
        candidates: cssVarMatches.map((m) => normHex(m[1])),
        source: 'css-var',
        siteTitle: pickTitle(html),
        logoUrl: pickLogo(html, url),
      };
    }

    // 4) Frequency of hex colors in inline styles / css
    const freq = new Map<string, number>();
    for (const m of html.matchAll(HEX)) {
      const hex = normHex(m[0]);
      if (hex.length === 7 && !isBland(hex)) {
        freq.set(hex, (freq.get(hex) ?? 0) + 1);
      }
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    if (top.length) {
      return {
        primary: top[0],
        candidates: top.slice(0, 6),
        source: 'frequency',
        siteTitle: pickTitle(html),
        logoUrl: pickLogo(html, url),
      };
    }

    return { candidates: [], source: 'none', siteTitle: pickTitle(html) };
  } catch (e) {
    clearTimeout(timer);
    return { candidates: [], source: 'none' };
  }
}

function pickTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1]?.trim();
}

function pickLogo(html: string, baseUrl: string): string | undefined {
  // Try og:image, apple-touch-icon, or first <img> containing "logo"
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return absolutize(og[1], baseUrl);
  const apple = html.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i);
  if (apple?.[1]) return absolutize(apple[1], baseUrl);
  const logoImg = html.match(/<img[^>]+src=["']([^"']+logo[^"']*)["']/i);
  if (logoImg?.[1]) return absolutize(logoImg[1], baseUrl);
  return undefined;
}

function absolutize(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

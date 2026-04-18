import { NextRequest, NextResponse } from 'next/server';
import { getLandingPage, getProduct, saveLandingPage, getProjectCompat } from '@/lib/storage';
import { renderProjectHtml } from '@/lib/render-html';
import { deployToVercel } from '@/lib/deploy';
import { reportHeroTemplate } from '@/lib/template-detection';

export const dynamic = 'force-dynamic';

/**
 * Deploy a project to Vercel as a static page (PRD v5.1 §6).
 * Platform-hosted VERCEL_TOKEN — user never configures.
 * Falls back to mock URL for local/dev when token is absent.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const page = await getLandingPage(params.id);
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const product = await getProduct(page.productId);
  if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 });

  const projectView = await getProjectCompat(params.id);
  if (!projectView) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Quality gate — refuse to publish a page whose Hero is still the
  // default template fingerprint (see `/lib/template-detection.ts`).
  // Silent-fallback template copy is a product-quality red line: it looks
  // polished but bears no relation to the user's actual product, which is
  // how "3.8 倍 ROI" ends up live for an unrelated SaaS.
  //
  // Recompute at request time from the active variant's default-locale
  // cell rather than trusting page.hydrationFailed — the stored flag may
  // be stale if the last edit bypassed the recompute branches. The client
  // can override by posting `{ force: true }` after confirming in a
  // dialog; we still return the warning so the client can log it.
  let body: { force?: boolean } = {};
  try {
    body = (await req.json()) as { force?: boolean };
  } catch {
    // No JSON body is fine — deploy with defaults (force=false).
  }

  const activeVariant = page.activeVariant ?? 'A';
  const activeMods = page.variants[activeVariant]?.[page.defaultLocale] ?? [];
  const heroReport = reportHeroTemplate(activeMods, product.name);
  if (heroReport.anyTemplate && !body.force) {
    const parts: string[] = [];
    if (heroReport.headline) parts.push('主标题');
    if (heroReport.bullets) parts.push('要点');
    return NextResponse.json(
      {
        error: 'hero-is-template',
        reason: `Hero 的${parts.join(' / ')}仍是未被替换的模板占位文案。建议先点击「重新生成」或手动改写 Hero。`,
        headline: heroReport.headline,
        bullets: heroReport.bullets,
      },
      { status: 409 },
    );
  }

  const html = renderProjectHtml(projectView);
  const result = await deployToVercel({ slug: page.slug, html });

  page.deploy = result;
  if (result.status === 'ready' || result.status === 'building') page.published = true;
  await saveLandingPage(page);

  return NextResponse.json({
    deploy: result,
    project: { ...projectView, deploy: result, published: page.published },
    // If we got here via { force: true } with hero still templated,
    // surface the warning so the client can show "published with warning".
    warning: heroReport.anyTemplate
      ? { rule: 'hero-is-template', forced: true }
      : undefined,
  });
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const page = await getLandingPage(params.id);
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ deploy: page.deploy ?? null });
}

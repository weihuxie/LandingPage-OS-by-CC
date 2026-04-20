import { NextRequest, NextResponse } from 'next/server';
import { getLandingPage, getProduct, saveLandingPage, getProjectCompat } from '@/lib/storage';
import { renderProjectHtml } from '@/lib/render-html';
import { deployToVercel } from '@/lib/deploy';
import { reportHeroTemplate } from '@/lib/template-detection';
import {
  errorResponse,
  DeployRequiredError,
  StorageRequiredError,
  LLMRequiredError,
  LLMCallError,
} from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * Deploy a project to Vercel as a static page (PRD v5.1 §6).
 *
 * Quality gate: refuse to publish when the Hero is still the default
 * template fingerprint. Previously the client could bypass with
 * `{ force: true }`; that override was the "ship bad pages with one
 * extra click" escape hatch and has been REMOVED. If the hero is
 * template, the user must regenerate or hand-edit before Deploy will
 * accept. Template copy going live as ROI claims is the user-reported
 * "3.8 倍 ROI" failure mode — worth blocking permanently.
 */
export async function POST(_req: NextRequest, ctx: { params: { id: string } }) {
  try {
    return await postImpl(_req, ctx);
  } catch (e) {
    if (
      e instanceof StorageRequiredError ||
      e instanceof DeployRequiredError ||
      e instanceof LLMRequiredError ||
      e instanceof LLMCallError
    ) {
      const { status, body } = errorResponse(e);
      return NextResponse.json(body, { status });
    }
    throw e;
  }
}

async function postImpl(_req: NextRequest, { params }: { params: { id: string } }) {
  const page = await getLandingPage(params.id);
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const product = await getProduct(page.productId);
  if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 });

  const projectView = await getProjectCompat(params.id);
  if (!projectView) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Recompute at request time from the active variant's default-locale
  // cell rather than trusting page.hydrationFailed — the stored flag may
  // be stale if the last edit bypassed the recompute branches.
  const activeVariant = page.activeVariant ?? 'A';
  const activeMods = page.variants[activeVariant]?.[page.defaultLocale] ?? [];
  const heroReport = reportHeroTemplate(activeMods, product.name);
  if (heroReport.anyTemplate) {
    const parts: string[] = [];
    if (heroReport.headline) parts.push('主标题');
    if (heroReport.bullets) parts.push('要点');
    return NextResponse.json(
      {
        error: 'hero-is-template',
        code: 'HERO_IS_TEMPLATE',
        reason: `Hero 的${parts.join(' / ')}仍是未被替换的模板占位文案。点击「重新生成」让 Claude 重写，或手动改写 Hero 后再发布。`,
        headline: heroReport.headline,
        bullets: heroReport.bullets,
      },
      { status: 409 },
    );
  }

  const html = renderProjectHtml(projectView);

  let result;
  try {
    result = await deployToVercel({ slug: page.slug, html });
  } catch (e) {
    // DeployRequiredError → 503 ({ code: 'DEPLOY_REQUIRED', missing:
    // 'VC_API_TOKEN' }). Before Phase E, this path returned a mock URL
    // like `https://slug.mock-vercel.app` that looked real in the UI —
    // the user clicked it, got a 404, and couldn't tell whether deploy
    // was configured or broken. Now we fail loud.
    if (e instanceof DeployRequiredError) {
      console.error('[deploy] platform credentials missing:', e);
      const { status, body: errBody } = errorResponse(e);
      return NextResponse.json(errBody, { status });
    }
    throw e;
  }

  // A structured-error DeployRecord (status='error') still comes back
  // here — the adapter returned it instead of throwing so the UI can
  // persist the error message. Save it, mark published=false, return
  // a proper HTTP error code so the frontend can distinguish "deploy
  // call succeeded but the platform rejected the upload".
  page.deploy = result;
  if (result.status === 'ready' || result.status === 'building') page.published = true;
  await saveLandingPage(page);

  if (result.status === 'error') {
    return NextResponse.json(
      {
        error: 'deploy-failed',
        code: 'DEPLOY_FAILED',
        message: result.errorMessage ?? 'Vercel deploy returned an error status',
        deploy: result,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    deploy: result,
    project: { ...projectView, deploy: result, published: page.published },
  });
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const page = await getLandingPage(params.id);
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ deploy: page.deploy ?? null });
}

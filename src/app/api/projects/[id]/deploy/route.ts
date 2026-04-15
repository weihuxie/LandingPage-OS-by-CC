import { NextRequest, NextResponse } from 'next/server';
import { getLandingPage, getProduct, saveLandingPage, getProjectCompat } from '@/lib/storage';
import { renderProjectHtml } from '@/lib/render-html';
import { deployToVercel } from '@/lib/deploy';

export const dynamic = 'force-dynamic';

/**
 * Deploy a project to Vercel as a static page (PRD v5.1 §6).
 * Platform-hosted VERCEL_TOKEN — user never configures.
 * Falls back to mock URL for local/dev when token is absent.
 */
export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const page = await getLandingPage(params.id);
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const product = await getProduct(page.productId);
  if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 });

  const projectView = await getProjectCompat(params.id);
  if (!projectView) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const html = renderProjectHtml(projectView);
  const result = await deployToVercel({ slug: page.slug, html });

  page.deploy = result;
  if (result.status === 'ready' || result.status === 'building') page.published = true;
  await saveLandingPage(page);

  return NextResponse.json({ deploy: result, project: { ...projectView, deploy: result, published: page.published } });
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const page = await getLandingPage(params.id);
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ deploy: page.deploy ?? null });
}

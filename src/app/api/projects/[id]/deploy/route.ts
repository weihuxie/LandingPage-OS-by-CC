import { NextRequest, NextResponse } from 'next/server';
import { getProject, saveProject } from '@/lib/storage';
import { renderProjectHtml } from '@/lib/render-html';
import { deployToVercel } from '@/lib/deploy';

/**
 * Deploy a project to Vercel as a static page (PRD v5.1 §6).
 * Platform-hosted VERCEL_TOKEN — user never configures.
 * Falls back to mock URL for local/dev when token is absent.
 */
export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const project = await getProject(params.id);
  if (!project) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const html = renderProjectHtml(project);
  const result = await deployToVercel({
    slug: project.slug,
    html,
  });

  project.deploy = result;
  if (result.status === 'ready' || result.status === 'building') {
    // deployment kicked off successfully → ensure the project is marked published
    project.published = true;
  }
  await saveProject(project);

  return NextResponse.json({ deploy: result, project });
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const project = await getProject(params.id);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ deploy: project.deploy ?? null });
}

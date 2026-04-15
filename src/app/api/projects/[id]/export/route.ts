import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/lib/storage';
import { renderProjectHtml } from '@/lib/render-html';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const project = await getProject(params.id);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const html = renderProjectHtml(project);
  return new NextResponse(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': `attachment; filename="${project.slug}.html"`,
    },
  });
}

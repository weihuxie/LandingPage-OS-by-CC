import { NextRequest, NextResponse } from 'next/server';
import { getProjectCompat } from '@/lib/storage';
import { renderProjectHtml } from '@/lib/render-html';
import { requireUserApi } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const project = await getProjectCompat(params.id);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const projectTenant = (project as any).tenantId ?? (project as any).ownerId ?? 'default';
  if (projectTenant !== auth.tenant.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const html = renderProjectHtml(project);
  return new NextResponse(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': `attachment; filename="${project.slug}.html"`,
    },
  });
}

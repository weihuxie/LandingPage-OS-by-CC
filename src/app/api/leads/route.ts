import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { appendLead, getProjectBySlug, readLeads } from '@/lib/storage';
import type { Lead } from '@/lib/types';

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId') ?? undefined;
  const leads = await readLeads(projectId);
  return NextResponse.json({ leads });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { slug, name, email, company, phone, message, locale, variant } = body;
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
  const project = await getProjectBySlug(slug);
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  const lead: Lead = {
    id: nanoid(10),
    projectId: project.id,
    createdAt: Date.now(),
    name,
    email,
    company,
    phone,
    message,
    locale: locale ?? project.inputs.locale,
    variant: variant === 'A' || variant === 'B' ? variant : undefined,
  };
  await appendLead(lead);
  return NextResponse.json({ ok: true });
}

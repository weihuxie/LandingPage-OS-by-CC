import { NextRequest, NextResponse } from 'next/server';
import { deleteProject, getProject, saveProject } from '@/lib/storage';
import { regenerateModule } from '@/lib/ai';
import type { Project, PageModule, ToneKey, NarrativeVariant, StyleId } from '@/lib/types';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const project = await getProject(params.id);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ project });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const project = await getProject(params.id);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = (await req.json()) as Partial<Project> & {
    regenerateModuleId?: string;
    newTone?: ToneKey;
    switchVariant?: NarrativeVariant;
    newStyleId?: StyleId;
  };

  // Variant switch: promote A or B into project.modules
  if (body.switchVariant && project.variants) {
    const v = body.switchVariant;
    project.activeVariant = v;
    project.modules = project.variants[v];
  }

  if (body.newStyleId) {
    project.theme = { ...project.theme, styleId: body.newStyleId };
  }

  if (body.regenerateModuleId) {
    const idx = project.modules.findIndex((m) => m.id === body.regenerateModuleId);
    if (idx !== -1) {
      const tone = body.newTone ?? project.tone;
      project.modules[idx] = regenerateModule(project.modules[idx], project.inputs, tone);
      if (project.variants) {
        const v = project.activeVariant ?? 'A';
        const vIdx = project.variants[v].findIndex((m) => m.id === body.regenerateModuleId);
        if (vIdx !== -1) project.variants[v][vIdx] = project.modules[idx];
      }
      if (body.newTone) project.tone = tone;
    }
  }

  if (body.modules) {
    project.modules = body.modules as PageModule[];
    if (project.variants && project.activeVariant) {
      project.variants[project.activeVariant] = body.modules as PageModule[];
    }
  }
  if (body.tone) project.tone = body.tone;
  if (typeof body.published === 'boolean') project.published = body.published;
  if (body.publishMode) project.publishMode = body.publishMode;
  if (body.theme) project.theme = { ...project.theme, ...body.theme };

  await saveProject(project);
  return NextResponse.json({ project });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await deleteProject(params.id);
  return NextResponse.json({ ok: true });
}

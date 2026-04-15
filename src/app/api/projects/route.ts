import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { readProjects, saveProject } from '@/lib/storage';
import { generateModules, generateStrategy, generateVariants } from '@/lib/ai';
import { defaultStyleForMarket } from '@/lib/styles';
import { makeSlug } from '@/lib/slug';
import type { Project, ProductInputs, StrategySummary, ToneKey } from '@/lib/types';

export async function GET() {
  const list = await readProjects();
  return NextResponse.json({ projects: list });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    inputs: ProductInputs;
    strategy?: StrategySummary;
    tone?: ToneKey;
    referenceUrl?: string;
    primary?: string;
  };
  if (!body?.inputs?.name) {
    return NextResponse.json({ error: 'inputs.name required' }, { status: 400 });
  }
  const tone: ToneKey =
    body.tone ?? (body.inputs.market === 'JP' ? 'japanese' : 'saas');
  const strategy = body.strategy ?? generateStrategy(body.inputs);
  const variants = generateVariants(body.inputs, tone);
  const activeModules = variants.A;

  const project: Project = {
    id: nanoid(10),
    slug: makeSlug(body.inputs.name),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    inputs: body.inputs,
    tone,
    strategy,
    modules: activeModules,
    variants,
    activeVariant: 'A',
    publishMode: 'single',
    theme: {
      primary: body.primary ?? '#4861ff',
      styleId: defaultStyleForMarket(body.inputs.market),
    },
    referenceUrl: body.referenceUrl,
    published: false,
    publishedLocales: [],
    leadCount: 0,
    views: 0,
    abStats: { A: { views: 0, leads: 0 }, B: { views: 0, leads: 0 } },
  };
  await saveProject(project);
  return NextResponse.json({ id: project.id, slug: project.slug });
}

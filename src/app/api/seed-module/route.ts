import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import {
  generateModules,
  seedProductShowcase,
  seedVideoEmbed,
} from '@/lib/ai';
import type {
  ProductInputs,
  ToneKey,
  ModuleType,
  PageModule,
  ProductShowcaseContent,
  VideoEmbedContent,
} from '@/lib/types';

export async function POST(req: NextRequest) {
  const { inputs, tone, type } = (await req.json()) as {
    inputs: ProductInputs;
    tone: ToneKey;
    type: ModuleType;
  };
  if (!inputs || !type)
    return NextResponse.json({ error: 'inputs and type required' }, { status: 400 });

  // Visual modules have their own seed path
  if (type === 'productShowcase') {
    const seed = seedProductShowcase(inputs);
    const mod: PageModule<ProductShowcaseContent> = {
      id: nanoid(8),
      type: 'productShowcase',
      enabled: true,
      content: seed,
    };
    return NextResponse.json({ module: mod });
  }
  if (type === 'videoEmbed') {
    const seed = seedVideoEmbed(inputs);
    const mod: PageModule<VideoEmbedContent> = {
      id: nanoid(8),
      type: 'videoEmbed',
      enabled: true,
      content: {
        ...seed,
        media: {
          id: nanoid(8),
          kind: 'video',
          url: '',
          label: 'Demo 视频',
        },
      },
    };
    return NextResponse.json({ module: mod });
  }

  const all = generateModules(inputs, tone);
  const seed = all.find((m) => m.type === type);
  if (!seed) return NextResponse.json({ error: 'unknown type' }, { status: 400 });
  return NextResponse.json({ module: seed });
}

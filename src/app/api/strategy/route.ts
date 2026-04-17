import { NextRequest, NextResponse } from 'next/server';
import { generateStrategy } from '@/lib/ai';
import { extractFromTextSmart, mergeContexts } from '@/lib/extract';
import { extractSiteContent } from '@/lib/brand';

export const dynamic = 'force-dynamic';

/**
 * Generate an initial strategy for a product/market/audience combination.
 * If inputs include pastedContent or referenceUrls, we synchronously extract
 * facts (customer names, metrics, pains, features) and use them to ground
 * the strategy so it feels like it actually read your materials.
 */
export async function POST(req: NextRequest) {
  const { inputs, fileContexts } = await req.json();
  if (!inputs) return NextResponse.json({ error: 'inputs required' }, { status: 400 });

  const contexts: any[] = [];
  if (inputs.pastedContent?.trim()) {
    contexts.push(await extractFromTextSmart(inputs.pastedContent, 'paste'));
  }
  if (Array.isArray(inputs.referenceUrls)) {
    for (const url of inputs.referenceUrls.slice(0, 3)) {
      try {
        const siteText = await extractSiteContent(url);
        if (siteText) contexts.push(await extractFromTextSmart(siteText, 'url'));
      } catch {}
    }
  }
  if (Array.isArray(fileContexts)) {
    for (const c of fileContexts) {
      if (c && typeof c === 'object' && Array.isArray(c.sourceKinds)) contexts.push(c);
    }
  }
  const merged = contexts.length ? mergeContexts(contexts) : undefined;

  const strategy = await generateStrategy(inputs, merged);
  return NextResponse.json({ strategy, context: merged });
}

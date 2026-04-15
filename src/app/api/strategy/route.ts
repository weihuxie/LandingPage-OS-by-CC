import { NextRequest, NextResponse } from 'next/server';
import { generateStrategy } from '@/lib/ai';
import { extractFromText, mergeContexts } from '@/lib/extract';
import { extractSiteContent } from '@/lib/brand';

export const dynamic = 'force-dynamic';

/**
 * Generate an initial strategy for a product/market/audience combination.
 * If inputs include pastedContent or referenceUrls, we synchronously extract
 * facts (customer names, metrics, pains, features) and use them to ground
 * the strategy so it feels like it actually read your materials.
 */
export async function POST(req: NextRequest) {
  const { inputs } = await req.json();
  if (!inputs) return NextResponse.json({ error: 'inputs required' }, { status: 400 });

  const contexts = [];
  if (inputs.pastedContent?.trim()) {
    contexts.push(extractFromText(inputs.pastedContent, 'paste'));
  }
  if (Array.isArray(inputs.referenceUrls)) {
    for (const url of inputs.referenceUrls.slice(0, 3)) {
      // cap at 3 URLs to keep request bounded
      try {
        const siteText = await extractSiteContent(url);
        if (siteText) contexts.push(extractFromText(siteText, 'url'));
      } catch {
        // best-effort — don't fail strategy generation if a site is unreachable
      }
    }
  }
  const merged = contexts.length ? mergeContexts(contexts) : undefined;

  const strategy = generateStrategy(inputs, merged);
  return NextResponse.json({ strategy, context: merged });
}

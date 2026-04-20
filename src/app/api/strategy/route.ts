import { NextRequest, NextResponse } from 'next/server';
import { generateStrategy, generateStrategyTemplated } from '@/lib/ai';
import { extractFromTextSmart, mergeContexts } from '@/lib/extract';
import { extractSiteContent } from '@/lib/brand';
import { errorResponse } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * Generate an initial strategy for a product/market/audience combination.
 * If inputs include pastedContent or referenceUrls, we synchronously extract
 * facts (customer names, metrics, pains, features) and use them to ground
 * the strategy so it feels like it actually read your materials.
 *
 * mode:
 *   - 'claude' (default) — real LLM generation, throws if no key.
 *   - 'template'        — EXPLICIT opt-in to the deterministic template
 *     strategy (generateStrategyTemplated). Used by the wizard AFTER the
 *     claude path returned 503 and the user confirmed "continue with
 *     template strategy" in a dialog. Response includes
 *     `{ mode: 'template' }` so the wizard can show a visible "模板策略
 *     (未经 Claude)" banner during review. This is NOT a silent fallback:
 *     the user actively chose it and the UI is labelled accordingly.
 */
export async function POST(req: NextRequest) {
  const { inputs, fileContexts, mode } = (await req.json()) as {
    inputs?: any;
    fileContexts?: any[];
    mode?: 'claude' | 'template';
  };
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

  if (mode === 'template') {
    // Explicit template-mode — no LLM call, always succeeds. The response
    // carries `mode: 'template'` so the wizard review UI can surface a
    // visible badge and the editor can flag the resulting page.
    const strategy = generateStrategyTemplated(inputs, merged);
    return NextResponse.json({ strategy, context: merged, mode: 'template' });
  }

  try {
    const strategy = await generateStrategy(inputs, merged);
    return NextResponse.json({ strategy, context: merged, mode: 'claude' });
  } catch (e) {
    // LLMRequiredError → 503 ({ code: 'LLM_REQUIRED', missing: 'ANTHROPIC_API_KEY' }).
    // LLMCallError → 502 ({ code: 'LLM_CALL_FAILED', provider: 'claude' }).
    // Previously we fell back to a template strategy here, which shipped
    // generic SaaS-playbook bullets under the "AI-generated strategy"
    // label. The UI now reads the code/missing fields and surfaces a
    // specific error state instead — OR the wizard retries with
    // mode='template' after user confirmation.
    console.error('[strategy] generation failed:', e);
    const { status, body } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

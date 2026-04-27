/**
 * POST /api/fields/suggest — Pattern ① "Per-field AI 改写".
 *
 * Returns 3 alternative rewrites for ONE field. Reuses the `copy` scenario
 * fallback chain so admin's /admin/llm config (Claude → DeepSeek order,
 * triggers, etc.) governs which provider answers.
 *
 * Request body:
 *   { pageId, locale, fieldPath, fieldLabel, currentValue, hint? }
 *
 * Response:
 *   { alternatives: [{ text, reason }], llm: LLMTrace }
 *
 * Auth: requireUserApi gate (same as the editor's other PATCH endpoints).
 * Tenant scoping: page must belong to the caller's tenant; cross-tenant
 * access returns 404 (no info leak — same convention as /api/projects/[id]).
 *
 * Cost: ~1 LLM call per click (~0.5–1¢). Caller is expected to debounce /
 * not auto-fire — the click is the explicit trigger.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserApi } from '@/lib/server-auth';
import { getLandingPage, getProduct } from '@/lib/storage';
import { projectViewFromV2 } from '@/lib/migrate-v2';
import { executeScenario } from '@/lib/llm-fallback';
import {
  suggestFieldViaClaude,
  suggestFieldViaDeepseek,
  type FieldSuggestion,
} from '@/lib/llm-field-suggest';
import { errorResponse, LLMRequiredError, LLMCallError } from '@/lib/errors';
import { makeTrace } from '@/lib/llm-trace';
import type { PageLocale } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Body {
  pageId?: string;
  locale?: PageLocale;
  fieldPath?: string;
  fieldLabel?: string;
  currentValue?: string;
  hint?: string;
}

const PATH_RE = /^[a-z][a-zA-Z0-9._-]{0,63}$/;

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { pageId, locale, fieldPath, fieldLabel, currentValue = '', hint } = body;
  if (!pageId || !locale || !fieldPath) {
    return NextResponse.json(
      { error: 'pageId, locale, fieldPath required' },
      { status: 400 },
    );
  }
  // Tight allowlist on fieldPath so we don't reflect arbitrary user input
  // back into the LLM prompt unfettered. Real paths look like
  // "hero.headline", "cta.button", "pain.subtitle" — alphanumeric + dot.
  if (!PATH_RE.test(fieldPath)) {
    return NextResponse.json({ error: 'fieldPath shape invalid' }, { status: 400 });
  }
  if (currentValue.length > 4000) {
    return NextResponse.json({ error: 'currentValue too long' }, { status: 400 });
  }
  if (hint && hint.length > 200) {
    return NextResponse.json({ error: 'hint too long' }, { status: 400 });
  }

  const page = await getLandingPage(pageId);
  if (!page) return NextResponse.json({ error: 'page not found' }, { status: 404 });
  // Cross-tenant → 404 (same convention as /api/projects/[id])
  if (page.tenantId !== auth.tenant.id) {
    return NextResponse.json({ error: 'page not found' }, { status: 404 });
  }
  const product = await getProduct(page.productId);
  if (!product) return NextResponse.json({ error: 'product missing' }, { status: 404 });

  // Reuse projectViewFromV2 to assemble ProductInputs. Cheap, single-call,
  // no extra storage roundtrip.
  const view = projectViewFromV2(page, product);

  try {
    const outcome = await executeScenario('copy', locale, async (step) => {
      if (step.provider === 'claude') {
        return suggestFieldViaClaude(
          {
            fieldPath,
            fieldLabel: fieldLabel ?? fieldPath,
            currentValue,
            hint,
            inputs: view.inputs,
            strategy: view.strategy,
            locale,
          },
          step.model,
        );
      }
      if (step.provider === 'deepseek') {
        return suggestFieldViaDeepseek(
          {
            fieldPath,
            fieldLabel: fieldLabel ?? fieldPath,
            currentValue,
            hint,
            inputs: view.inputs,
            strategy: view.strategy,
            locale,
          },
          step.model,
        );
      }
      // Other providers (openai/gemini) don't have an adapter for this
      // scenario — let executeScenario walk past them. errors.ts uses
      // 'gpt' instead of 'openai' as its provider name; same translation
      // pattern as llm-provider.ts.
      throw new LLMCallError(
        step.provider === 'gemini' ? 'gemini' : 'gpt',
        'module-regen',
        new Error(`provider ${step.provider} has no field-suggest adapter`),
      );
    });

    const alternatives: FieldSuggestion[] = outcome.result;
    return NextResponse.json({
      alternatives,
      llm: makeTrace(
        'copy',
        outcome.hops[0]?.provider ?? outcome.usedStep.provider,
        outcome.usedStep.provider,
        outcome.hops,
      ),
    });
  } catch (e) {
    if (e instanceof LLMRequiredError || e instanceof LLMCallError) {
      console.error('[fields/suggest] LLM call failed:', e);
      const { status, body: errBody } = errorResponse(e);
      return NextResponse.json(errBody, { status });
    }
    throw e;
  }
}

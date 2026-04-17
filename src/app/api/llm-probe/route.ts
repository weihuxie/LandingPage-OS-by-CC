import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { STRATEGY_SYSTEM, generateStrategyViaClaude } from '@/lib/llm-claude';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * End-to-end Claude probe. Makes ONE real API call and returns the usage
 * stats so you can:
 *
 *   1. Verify the key is wired correctly on Vercel (no 401).
 *   2. Verify prompt caching hits on the 2nd+ call within 5 min — look for
 *      `cache_read_input_tokens > 0`.
 *
 * Protected by the simplest possible guard: caller must pass
 * `?token=<PROBE_TOKEN>` matching the env var. That keeps random internet
 * traffic from burning your quota.
 *
 * Cost per call: ~300 input tokens (~200 cached after call #1) + ~50
 * output tokens. At Opus 4.6 pricing, ~$0.005/call cold, ~$0.001 warm.
 */

/* eslint-disable dot-notation */
// Reuse the PRODUCTION strategy system prompt. That way a passing probe
// proves the real app path caches — a toy probe prompt could pass while
// the production block silently failed the 1024-token threshold.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const required = process.env['PROBE_TOKEN'];

  // Require a token to be set AND to match. No token configured ⇒ refuse
  // (so a forgotten env var doesn't leave this endpoint wide open).
  if (!required) {
    return NextResponse.json(
      { error: 'probe disabled: set PROBE_TOKEN env var to enable' },
      { status: 503 },
    );
  }
  if (token !== required) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!process.env['ANTHROPIC_API_KEY']) {
    return NextResponse.json(
      { ok: false, reason: 'ANTHROPIC_API_KEY not set' },
      { status: 500 },
    );
  }

  const locale = url.searchParams.get('locale') ?? 'zh-CN';
  const debug = url.searchParams.get('debug') === '1';
  // Optional model override — handy when diagnosing caching on a new alias.
  const modelOverride = debug ? url.searchParams.get('model') : null;
  // Strategy-mode probe: runs the REAL generateStrategyViaClaude path end-
  // to-end against a synthetic ProductInputs and reports whether JSON
  // parsing succeeded. Added after a bug where users saw templated
  // strategy despite the key being live because the original call used
  // `output_config` + `thinking:adaptive` which the pinned Opus 4 model
  // didn't accept; fallback to templates hid the failure from the UI.
  const mode = url.searchParams.get('mode');

  const client = new Anthropic();
  const t0 = Date.now();

  // --- mode=strategy: end-to-end test of generateStrategyViaClaude ---
  if (mode === 'strategy') {
    const fakeInputs = {
      name: 'Helios',
      tagline: 'Outcome-first workspace',
      category: 'SaaS',
      value: 'Gives Ops teams back 11 hours a week.',
      market: 'US' as const,
      locale: locale as any,
      cta: 'demo' as const,
      industry: 'Software',
      companySize: 'Mid-market',
      role: 'Head of RevOps',
      source: 'ads' as const,
      pastedContent: '',
      referenceUrls: [],
      uploadedFileNames: [],
    };
    try {
      const strategy = await generateStrategyViaClaude(fakeInputs);
      return NextResponse.json({
        ok: strategy !== null,
        mode: 'strategy',
        latencyMs: Date.now() - t0,
        strategy,
        // If null, user should check Vercel function logs — we added
        // verbose console.error calls in llm-claude.ts that report
        // HTTP status, partial raw text, or shape-mismatch keys.
        note:
          strategy === null
            ? 'strategy path returned null — check Vercel logs for [claude] strategy lines'
            : 'strategy generated and JSON parsed successfully',
      });
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          mode: 'strategy',
          latencyMs: Date.now() - t0,
          error: e?.message ?? String(e),
          status: e?.status ?? null,
        },
        { status: 500 },
      );
    }
  }

  try {
    const response = await client.messages.create({
      model: modelOverride ?? 'claude-opus-4-20250514',
      max_tokens: 200,
      system: [
        {
          type: 'text',
          text: STRATEGY_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Probe call. Target locale: ${locale}. Reply with a single short string: "probe ok" and nothing else. Do not produce a strategy.`,
        },
      ],
    });

    const latencyMs = Date.now() - t0;
    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : null;

    const usage = response.usage as any;
    const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0;
    const cacheStatus =
      cacheReadTokens > 0
        ? 'HIT — prompt cache working'
        : cacheWriteTokens > 0
          ? 'MISS (first call wrote cache; hit again within 5 min to see read)'
          : 'NOT ENGAGED — system block below cache threshold or model unsupported';

    return NextResponse.json({
      ok: true,
      model: response.model,
      latencyMs,
      text,
      usage: {
        inputTokens: usage?.input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
        cacheReadTokens,
        cacheWriteTokens,
      },
      cacheStatus,
      // Append raw dump only when ?debug=1 — kept for future diagnostics.
      ...(debug ? { usageRaw: usage } : {}),
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        latencyMs: Date.now() - t0,
        error: e?.message ?? String(e),
        status: e?.status ?? null,
      },
      { status: 500 },
    );
  }
}
/* eslint-enable dot-notation */

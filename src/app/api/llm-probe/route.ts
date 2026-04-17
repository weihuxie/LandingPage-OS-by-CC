import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { STRATEGY_SYSTEM } from '@/lib/llm-claude';

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
  // Diagnostic switches
  const modelOverride = url.searchParams.get('model'); // try a different model id
  const useBeta = url.searchParams.get('beta') === '1'; // force prompt-caching beta header
  const mode = url.searchParams.get('mode') ?? 'default';

  const client = new Anthropic(
    useBeta
      ? {
          defaultHeaders: {
            'anthropic-beta': 'prompt-caching-2024-07-31',
          },
        }
      : undefined,
  );
  const t0 = Date.now();

  try {
    // Two shapes for cache_control — if the SDK is silently dropping our
    // field, the second form (cache_control inline on a string system)
    // sometimes survives when the typed array form doesn't.
    const params: any = {
      model: modelOverride ?? 'claude-opus-4-6',
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
    };

    // Log what we're actually sending so we can confirm the field is there
    const sentRequestPreview = {
      model: params.model,
      systemType: Array.isArray(params.system) ? 'array' : typeof params.system,
      systemBlockCount: Array.isArray(params.system) ? params.system.length : undefined,
      systemFirstBlockKeys: Array.isArray(params.system)
        ? Object.keys(params.system[0])
        : undefined,
      systemFirstBlockCacheControl: Array.isArray(params.system)
        ? (params.system[0] as any).cache_control
        : undefined,
      systemTextLength: Array.isArray(params.system)
        ? (params.system[0] as any).text?.length
        : undefined,
      usingBetaHeader: useBeta,
    };

    const response = await client.messages.create(params);

    const latencyMs = Date.now() - t0;
    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : null;

    const usage = response.usage as any;
    // Return the ENTIRE raw usage object — field names may differ between
    // SDK versions or model families.
    const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0;
    const cacheStatus =
      cacheReadTokens > 0
        ? 'HIT — prompt cache working'
        : cacheWriteTokens > 0
          ? 'MISS (first call wrote cache; hit again within 5 min to see read)'
          : 'NOT ENGAGED — check sentRequestPreview + usageRaw';

    return NextResponse.json({
      ok: true,
      mode,
      model: response.model,
      latencyMs,
      text,
      usage: {
        inputTokens: usage?.input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
        cacheReadTokens,
        cacheWriteTokens,
      },
      // Raw usage dump — exposes any fields we haven't accounted for
      usageRaw: usage,
      // What we actually sent the API
      sentRequestPreview,
      cacheStatus,
      hint:
        cacheReadTokens === 0 && cacheWriteTokens === 0
          ? 'Cache did not engage. Try ?beta=1 to force the caching beta header, or ?model=claude-opus-4-20250514 to test a model known to support caching.'
          : undefined,
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

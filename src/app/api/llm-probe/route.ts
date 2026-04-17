import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { STRATEGY_SYSTEM, extractJsonObject } from '@/lib/llm-claude';

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

  // --- mode=strategy: inline Claude call with full introspection -------
  // Duplicates the shape of generateStrategyViaClaude() on purpose: we
  // want to see the raw failure (HTTP status, content block types, raw
  // text) directly in the HTTP response instead of requiring the user
  // to grep Vercel function logs.
  if (mode === 'strategy') {
    const userPrompt = [
      'Product: Helios',
      'Tagline: Outcome-first workspace',
      'Category: SaaS',
      'Core value: Gives Ops teams back 11 hours a week.',
      'Target market: US',
      `Target locale: ${locale}`,
      'Conversion goal: demo',
      'Primary traffic source: ads',
      'Audience: Software · Mid-market · Head of RevOps',
      '',
      `Produce the strategy summary per your framework. Write audience/goal/narrative in ${locale}; write local in ${locale}.`,
    ].join('\n');

    const strategyTool = {
      name: 'emit_strategy',
      description: 'Emit the four-part strategy summary.',
      input_schema: {
        type: 'object' as const,
        properties: {
          audience: { type: 'array', items: { type: 'string' } },
          goal: { type: 'array', items: { type: 'string' } },
          narrative: { type: 'array', items: { type: 'string' } },
          local: { type: 'array', items: { type: 'string' } },
        },
        required: ['audience', 'goal', 'narrative', 'local'],
      },
    };

    try {
      const response = await client.messages.create({
        model: modelOverride ?? 'claude-opus-4-20250514',
        max_tokens: 4096,
        system: [
          {
            type: 'text',
            text: STRATEGY_SYSTEM,
            cache_control: { type: 'ephemeral' },
          },
        ],
        tools: [strategyTool],
        tool_choice: { type: 'tool', name: 'emit_strategy' },
        messages: [{ role: 'user', content: userPrompt }],
      });

      const latencyMs = Date.now() - t0;
      const contentTypes = response.content.map((b) => b.type);

      // Primary: tool_use block with validated input
      const toolUse = response.content.find((b) => b.type === 'tool_use');
      let parsed: any = null;
      let parseError: string | null = null;
      let rawText: string | null = null;

      if (toolUse && toolUse.type === 'tool_use') {
        parsed = toolUse.input;
      } else {
        // Fallback path: model returned text despite forced tool_choice
        const textBlock = response.content.find((b) => b.type === 'text');
        rawText =
          textBlock && textBlock.type === 'text' ? textBlock.text : null;
        if (rawText) {
          try {
            parsed = extractJsonObject(rawText);
            if (!parsed) parseError = 'extractJsonObject returned null';
          } catch (pe: any) {
            parseError = pe?.message ?? String(pe);
          }
        } else {
          parseError = 'no tool_use and no text block';
        }
      }

      const shapeOk =
        parsed &&
        Array.isArray(parsed.audience) &&
        Array.isArray(parsed.goal) &&
        Array.isArray(parsed.narrative) &&
        Array.isArray(parsed.local);

      const usage = response.usage as any;

      return NextResponse.json({
        ok: !!shapeOk,
        mode: 'strategy',
        latencyMs,
        model: response.model,
        stopReason: response.stop_reason,
        contentBlockTypes: contentTypes,
        usedToolUse: !!(toolUse && toolUse.type === 'tool_use'),
        rawTextPreview: rawText ? rawText.slice(0, 1500) : null,
        rawTextLength: rawText?.length ?? 0,
        parseError,
        shapeOk,
        strategy: shapeOk ? parsed : null,
        usage: {
          inputTokens: usage?.input_tokens ?? null,
          outputTokens: usage?.output_tokens ?? null,
          cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
        },
      });
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          mode: 'strategy',
          latencyMs: Date.now() - t0,
          // These two fields tell you whether the API rejected the
          // request (400 = bad param, 401 = key, 429 = rate, 529 =
          // overload) vs. the SDK threw locally.
          apiStatus: e?.status ?? null,
          apiErrorType: e?.error?.type ?? e?.name ?? null,
          error: e?.message ?? String(e),
          // Some SDK errors carry the full response body on .error
          errorBody: e?.error ?? null,
        },
        { status: 200 }, // keep 200 so the browser shows the JSON
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

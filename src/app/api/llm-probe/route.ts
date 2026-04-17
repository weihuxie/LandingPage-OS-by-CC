import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

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
const SYSTEM_PROMPT = `You are a health-check endpoint. When asked, respond with ONLY a single JSON object of the form {"status":"ok","echo":"<short acknowledgement in the requested language>"}. No surrounding commentary, no markdown fences.

This message is intentionally padded with stable instructions so it can be
prompt-cached. The production application uses cache_control on system blocks
roughly 1-2K tokens long; this probe deliberately emulates that shape so a
cache hit on the 2nd call proves that the mechanism works for the real app
code path too.

Stable instruction block:
- Always return valid JSON.
- Always use the requested locale code for the echo field.
- Never include any fields beyond status and echo.
- Never explain. Never apologize. Never add markdown.
- If the prompt is unclear, still return the same shape with echo="unclear".`;

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
  const client = new Anthropic();
  const t0 = Date.now();

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 200,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Health ping. Respond in locale=${locale}. Return the JSON.`,
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
          : 'unknown';

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
      tip:
        cacheReadTokens === 0 && cacheWriteTokens > 0
          ? 'Call this endpoint again within 5 minutes — cacheReadTokens should jump to ~200.'
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

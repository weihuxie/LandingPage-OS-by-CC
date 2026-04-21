import { NextRequest, NextResponse } from 'next/server';
import {
  readLLMConfig,
  writeLLMConfig,
  validateLLMConfig,
  DEFAULT_LLM_CONFIG,
  MODEL_OPTIONS,
  type LLMConfig,
} from '@/lib/llm-config';
import { hasClaudeKey } from '@/lib/llm-claude';
import { hasDeepseekKey } from '@/lib/llm-deepseek';
import { hasOpenAIKey } from '@/lib/llm-openai';
import { hasGeminiKey } from '@/lib/llm-gemini';

// Admin APIs are always dynamic — the config can change from one request
// to the next and callers need fresh data. Also hard-opts out of the
// Next.js Data Cache (see CLAUDE.md §一.4.1) for the KV read inside.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/llm-config
 *
 * Returns the current config + metadata the UI needs to render:
 *   - `config`: the live LLMConfig (from KV or defaults)
 *   - `defaults`: the code-level defaults so the UI can show "reset"
 *   - `modelOptions`: dropdown catalogs per provider
 *   - `providerStatus`: which providers have their API key configured
 *     (so the UI can dim rows for providers that would throw 503)
 *
 * No auth check here — the middleware already enforces it. If this file
 * is ever lifted out of /api/admin/* the check has to come with it.
 */
export async function GET() {
  const config = await readLLMConfig();
  return NextResponse.json({
    config,
    defaults: DEFAULT_LLM_CONFIG,
    modelOptions: MODEL_OPTIONS,
    providerStatus: {
      claude: hasClaudeKey(),
      deepseek: hasDeepseekKey(),
      openai: hasOpenAIKey(),
      gemini: hasGeminiKey(),
    },
  });
}

/**
 * PUT /api/admin/llm-config  { config: LLMConfig }
 *
 * Replace the stored config. Validates the full shape in one pass and
 * rejects the whole write on any invalid field — partial writes would
 * leave the config in an inconsistent half-state where (say) the model
 * was updated but the scenario map wasn't.
 */
export async function PUT(req: NextRequest) {
  let body: { config?: unknown };
  try {
    body = (await req.json()) as { config?: unknown };
  } catch {
    return NextResponse.json(
      { error: 'bad-body', code: 'BAD_BODY', message: 'expected JSON' },
      { status: 400 },
    );
  }

  const cfg = body?.config;
  const err = validateLLMConfig(cfg);
  if (err) {
    return NextResponse.json(
      { error: 'invalid-config', code: 'INVALID_CONFIG', message: err },
      { status: 400 },
    );
  }

  try {
    await writeLLMConfig(cfg as LLMConfig);
  } catch (e: any) {
    return NextResponse.json(
      {
        error: 'write-failed',
        code: 'WRITE_FAILED',
        message: e?.message ?? 'KV write failed',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, config: cfg });
}

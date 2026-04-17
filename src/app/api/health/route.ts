import { NextResponse } from 'next/server';
import { providerStatus } from '@/lib/llm';
import { storageBackend } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Cheap health probe. Does NOT make any LLM API call — key presence only.
 * For a real end-to-end check (with usage stats / cache-hit bytes), hit
 * /api/llm-probe instead.
 */
export async function GET() {
  /* eslint-disable dot-notation */
  const envPresence = {
    anthropic: !!process.env['ANTHROPIC_API_KEY'],
    gemini: !!process.env['GOOGLE_API_KEY'],
    openai: !!process.env['OPENAI_API_KEY'],
    kv: !!process.env['KV_REST_API_URL'] && !!process.env['KV_REST_API_TOKEN'],
  };
  /* eslint-enable dot-notation */

  return NextResponse.json({
    ok: true,
    llm: providerStatus(),
    storage: storageBackend(),
    env: envPresence,
    deployedAt: process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? 'local',
    timestamp: Date.now(),
  });
}

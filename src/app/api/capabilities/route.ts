import { NextResponse } from 'next/server';
import { storageBackend } from '@/lib/storage';
import { describeRouting } from '@/lib/llm-provider';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Capabilities probe — what CAN this deployment actually do right now?
 *
 * Used by the UI to DISABLE buttons whose underlying feature isn't
 * configured (greyed-out + tooltip "需要 ANTHROPIC_API_KEY") instead of
 * letting the user click, wait for 503, and see the banner. The banner
 * is the error fallback; this endpoint is the preventative.
 *
 * Returns booleans only — we never leak the actual keys back to the
 * browser. Use bracket notation on process.env so Next.js webpack doesn't
 * inline the check at build time (see CLAUDE.md §1 and storage.ts useKV).
 */
export async function GET() {
  /* eslint-disable dot-notation */
  const hasClaude = !!process.env['ANTHROPIC_API_KEY'];
  const hasOpenAI = !!process.env['OPENAI_API_KEY'];
  const hasGemini = !!process.env['GOOGLE_API_KEY'];
  const hasDeepseek = !!process.env['DEEPSEEK_API_KEY'];
  const hasDeploy = !!process.env['VC_API_TOKEN'];
  const isVercel = process.env['VERCEL'] === '1';
  /* eslint-enable dot-notation */

  // Any LLM that can handle strategy + module hydrate counts. Claude and
  // DeepSeek are first-class; OpenAI is localization-only so it doesn't
  // gate createProject.
  const hasAnyLLM = hasClaude || hasDeepseek;
  // describeRouting is async since the 2026-04 admin-config refactor — it
  // reads /admin/llm's KV config to determine the effective primary.
  const routing = await describeRouting();

  return NextResponse.json({
    hasClaude,
    hasOpenAI,
    hasGemini,
    hasDeepseek,
    hasDeploy,
    // Tells the UI which backend will handle strategy + module hydrate
    // calls at the current configuration. The `reason` string is
    // human-readable and can be surfaced directly in a tooltip.
    llm: routing,
    storage: storageBackend(),
    // Vercel + FS = the bad combination where writes go to /tmp and get
    // lost on next cold start. Surface explicitly so the UI can slap a
    // permanent banner on the whole app, not just individual actions.
    storageEphemeral: isVercel && storageBackend() === 'fs',
    // Rolled-up: can the user do the happy-path flow (create project →
    // strategy → module hydrate → deploy)? Useful for a single top-level
    // readiness check without the UI doing its own boolean arithmetic.
    ready: {
      // Strategy + hydrate run through the provider layer (Claude or
      // DeepSeek). Either one is enough — routing picks whichever is
      // configured.
      createProject: hasAnyLLM,
      // Localize pass uses GPT-4o regardless of primary strategy model.
      addLocale: hasAnyLLM && hasOpenAI,
      deploy: hasDeploy,
    },
  });
}

/**
 * LLM Orchestrator — Hybrid routing per PRD v5.1 §4.1
 *
 *   Gemini 1.5 Pro   → long document ingestion (manuals, whitepapers) → extract facts
 *   Claude Opus 4.6  → structured JSON copywriting, module + strategy generation
 *   GPT-4o            → multilingual localization + cultural self-check
 *
 * Keys are platform-hosted (ENV). Users never configure.
 *
 * HISTORY: this dispatcher used to fall back to a `mockAdapter` when a key
 * was missing, and the whole app was designed around "run on deterministic
 * templates in dev". That policy produced the "generate regens but returns
 * wrong-locale template" bug reported by the user — CLAUDE.md §4 now says
 * fail loud. This file is kept for `providerStatus()` (read by the
 * dashboard to colour its health strip) but no hot path calls `dispatch()`
 * anymore: strategy / module-regen / hydrate / localize all go through
 * `lib/llm-claude.ts` and `lib/llm-openai.ts` directly, which THROW
 * LLMRequiredError instead of silently returning a mock response.
 */

export type LLMTask =
  | 'ingest.long-document'
  | 'generate.strategy'
  | 'generate.modules'
  | 'regenerate.module'
  | 'localize.module'
  | 'audit.visual';

export interface LLMRequest<Payload = any> {
  task: LLMTask;
  payload: Payload;
}

export interface LLMResponse<Data = any> {
  ok: boolean;
  provider: 'gemini' | 'claude' | 'openai' | 'deepseek' | 'mock';
  data: Data;
  warnings?: string[];
}

// --- Provider routing table --------------------------------------------

const route: Record<LLMTask, 'gemini' | 'claude' | 'openai'> = {
  'ingest.long-document': 'gemini',
  'generate.strategy': 'claude',
  'generate.modules': 'claude',
  'regenerate.module': 'claude',
  'localize.module': 'openai',
  'audit.visual': 'claude',
};

// --- Key availability (platform-hosted) ---------------------------------
// IMPORTANT: bracket notation — webpack DefinePlugin inlines dot-access at
// build time on Vercel, which would permanently ship "no key" regardless of
// the runtime env. See CLAUDE.md §一.4 for the matching KV-env footgun.
//
// We defer to each adapter's own hasXKey() so the source of truth stays
// with the adapter that actually uses it.

import { hasClaudeKey } from './llm-claude';
import { hasGeminiKey } from './llm-gemini';
import { hasOpenAIKey } from './llm-openai';
import { hasDeepseekKey } from './llm-deepseek';

function hasKey() {
  return {
    claude: hasClaudeKey(),
    gemini: hasGeminiKey(),
    openai: hasOpenAIKey(),
    deepseek: hasDeepseekKey(),
  };
}

// --- Adapters -----------------------------------------------------------

async function claudeAdapter<T>(req: LLMRequest): Promise<LLMResponse<T>> {
  if (!hasKey().claude) return mockAdapter<T>(req);
  // generate.strategy is handled directly in ai.ts via llm-claude.ts.
  // Modules / regenerate / audit still templated until wired.
  return mockAdapter<T>(req);
}

async function geminiAdapter<T>(req: LLMRequest): Promise<LLMResponse<T>> {
  if (!hasKey().gemini) return mockAdapter<T>(req);
  // TODO: @google/generative-ai for long-doc ingestion (1M token context).
  return mockAdapter<T>(req);
}

async function openaiAdapter<T>(req: LLMRequest): Promise<LLMResponse<T>> {
  if (!hasKey().openai) return mockAdapter<T>(req);
  // TODO: openai SDK, gpt-4o, for cultural localization + voice matching.
  return mockAdapter<T>(req);
}

// --- Mock adapter (deterministic fallback) ------------------------------

async function mockAdapter<T>(_req: LLMRequest): Promise<LLMResponse<T>> {
  return {
    ok: true,
    provider: 'mock',
    data: null as unknown as T,
    warnings: ['Running on deterministic fallback. Set ANTHROPIC_API_KEY / GOOGLE_API_KEY / OPENAI_API_KEY to activate real LLMs.'],
  };
}

// --- Dispatcher ---------------------------------------------------------

export async function dispatch<T>(req: LLMRequest): Promise<LLMResponse<T>> {
  const target = route[req.task];
  switch (target) {
    case 'claude':
      return claudeAdapter<T>(req);
    case 'gemini':
      return geminiAdapter<T>(req);
    case 'openai':
      return openaiAdapter<T>(req);
  }
}

// --- Introspection (used by /api/health and admin debug panel) ----------

/**
 * Provider status strings that the dashboard renders as coloured pills.
 *
 * 'configured' → key is set; adapter will run.
 * 'missing'    → key not set; any action that requires this provider
 *                will throw LLMRequiredError and return 503 to the UI.
 *
 * Pre-cleanup this returned 'live' | 'mock'. 'mock' was misleading — it
 * implied there was a functioning mock mode shipping useful output, but
 * hot-path callers now throw instead. The dashboard renders 'missing'
 * in red so an operator who glances at the page knows immediately that
 * the deployment is half-configured.
 */
export type ProviderStatus = 'configured' | 'missing';
export function providerStatus(): {
  claude: ProviderStatus;
  gemini: ProviderStatus;
  openai: ProviderStatus;
  deepseek: ProviderStatus;
} {
  const h = hasKey();
  return {
    claude: h.claude ? 'configured' : 'missing',
    gemini: h.gemini ? 'configured' : 'missing',
    openai: h.openai ? 'configured' : 'missing',
    deepseek: h.deepseek ? 'configured' : 'missing',
  };
}

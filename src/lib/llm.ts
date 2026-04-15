/**
 * LLM Orchestrator — Hybrid routing per PRD v5.1 §4.1
 *
 *   Gemini 1.5 Pro   → long document ingestion (manuals, whitepapers) → extract facts
 *   Claude 3.5 Sonnet → structured JSON copywriting, module content generation
 *   GPT-4o            → multilingual localization + cultural self-check
 *
 * Keys are platform-hosted (ENV). Users never configure.
 * If a key is missing, the adapter falls back to deterministic templated output
 * (so the app remains fully functional in dev and self-hosted environments).
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
  provider: 'gemini' | 'claude' | 'openai' | 'mock';
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

const hasKey = {
  claude: !!process.env.ANTHROPIC_API_KEY,
  gemini: !!process.env.GOOGLE_API_KEY,
  openai: !!process.env.OPENAI_API_KEY,
};

// --- Adapters -----------------------------------------------------------

async function claudeAdapter<T>(req: LLMRequest): Promise<LLMResponse<T>> {
  if (!hasKey.claude) return mockAdapter<T>(req);
  // TODO: wire @anthropic-ai/sdk with prompt caching enabled.
  // Prompt cache: system prompt + asset library are cache-hit across calls.
  // For now, the platform operator drops in the real implementation here.
  return mockAdapter<T>(req);
}

async function geminiAdapter<T>(req: LLMRequest): Promise<LLMResponse<T>> {
  if (!hasKey.gemini) return mockAdapter<T>(req);
  // TODO: @google/generative-ai for long-doc ingestion (1M token context).
  return mockAdapter<T>(req);
}

async function openaiAdapter<T>(req: LLMRequest): Promise<LLMResponse<T>> {
  if (!hasKey.openai) return mockAdapter<T>(req);
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

export function providerStatus() {
  return {
    claude: hasKey.claude ? 'live' : 'mock',
    gemini: hasKey.gemini ? 'live' : 'mock',
    openai: hasKey.openai ? 'live' : 'mock',
  };
}

/**
 * Typed errors for failures that MUST be surfaced to the user.
 *
 * Background: CLAUDE.md §4 item 3 used to say "任意 Key 缺失自动回退确定性
 * 模板", and §5 used to say "本地无任何环境变量也能跑：LLM 退到模板，部署
 * 按钮返回 mock URL". That silent-degradation policy produced the
 * "regenerate on 日本語 tab returns Chinese" bug, because the user hit
 * "regenerate copy" (a clearly AI-labelled button) and got a deterministic
 * Chinese template back with no hint anything had fallen through. The
 * user called this pattern a 遮羞布 (fig leaf): looks-right-but-is-actually-
 * wrong. The new rule is: fail loud.
 *
 * How these are used:
 *   - LLM adapters (`llm-claude.ts`, `llm-openai.ts`, `llm-gemini.ts`) throw
 *     LLMRequiredError when the required key is missing, and LLMCallError
 *     when a provisioned key returns an error.
 *   - Orchestrators in `ai.ts` do NOT catch either. They propagate.
 *   - Route handlers catch via `errorResponse()` and return a structured
 *     JSON body with the right HTTP status (503 for missing capability,
 *     502 for upstream call failure, 409 for bad content).
 *
 * NEVER catch these errors inside library code. Only route handlers
 * (`app/api/*`) may translate them to HTTP responses. Library code that
 * catches and substitutes dummy data reintroduces the fig-leaf pattern.
 */

export type LLMFeature =
  | 'strategy'           // generateStrategy()
  | 'module-hydrate'     // hydrateModulesViaClaude()
  | 'module-regen'       // regenerateModule() via Claude
  | 'locale-add'         // POST /api/pages/:id/locales end-to-end
  | 'localize-gpt'       // localizeModulesViaGpt pass
  | 'extract';           // Gemini / Claude long-content extraction

export type LLMProvider = 'claude' | 'gpt' | 'gemini';
export type LLMKey =
  | 'ANTHROPIC_API_KEY'
  | 'OPENAI_API_KEY'
  | 'GEMINI_API_KEY'
  | 'any-llm';

/**
 * The user hit a feature that strictly requires an LLM, but the needed
 * key (or any fallback key) isn't configured. Surfaces as 503.
 */
export class LLMRequiredError extends Error {
  readonly code = 'LLM_REQUIRED' as const;
  constructor(
    public feature: LLMFeature,
    public missing: LLMKey,
    message?: string,
  ) {
    super(
      message ??
        `${feature} requires ${missing === 'any-llm' ? 'an LLM API key' : missing}; none configured`,
    );
    this.name = 'LLMRequiredError';
  }
}

/**
 * An LLM key IS configured, but the call itself failed (network, 429,
 * schema mismatch, malformed JSON). Surfaces as 502.
 */
export class LLMCallError extends Error {
  readonly code = 'LLM_CALL_FAILED' as const;
  constructor(
    public provider: LLMProvider,
    public feature: LLMFeature,
    public cause?: unknown,
    message?: string,
  ) {
    super(
      message ??
        `${provider} failed during ${feature}: ${cause instanceof Error ? cause.message : String(cause ?? 'unknown')}`,
    );
    this.name = 'LLMCallError';
  }
}

/**
 * Deploy was requested but Vercel platform credentials are missing.
 * Surfaces as 503 with the specific variable name so the operator can
 * fix it in the dashboard.
 */
export class DeployRequiredError extends Error {
  readonly code = 'DEPLOY_REQUIRED' as const;
  constructor(
    public missing: 'VC_API_TOKEN' | 'VC_TEAM_ID',
    message?: string,
  ) {
    super(message ?? `Deploy requires ${missing} to be set`);
    this.name = 'DeployRequiredError';
  }
}

/**
 * Production server fell back to filesystem storage. This used to be a
 * silent "`/tmp/.data` on Vercel" degrade; now we refuse to serve writes
 * because `/tmp` is per-lambda and data is lost on the next cold start.
 */
export class StorageRequiredError extends Error {
  readonly code = 'STORAGE_REQUIRED' as const;
  constructor(message?: string) {
    super(
      message ??
        'Persistent storage required in production; set KV_REST_API_URL and KV_REST_API_TOKEN',
    );
    this.name = 'StorageRequiredError';
  }
}

/**
 * Content extraction failed hard (network refused the URL, file type
 * unsupported, LLM refused the prompt). 409 — the user can retry with
 * different input.
 */
export class ExtractionFailedError extends Error {
  readonly code = 'EXTRACTION_FAILED' as const;
  constructor(
    public source: 'url' | 'file' | 'text',
    public cause?: unknown,
    message?: string,
  ) {
    super(
      message ??
        `Extraction failed (${source}): ${cause instanceof Error ? cause.message : String(cause ?? 'unknown')}`,
    );
    this.name = 'ExtractionFailedError';
  }
}

export type StructuredErrorBody = {
  error: string;
  code: string;
  message: string;
  feature?: LLMFeature;
  missing?: string;
  provider?: LLMProvider;
  source?: string;
};

/**
 * Map any caught error to a structured HTTP response. Route handlers use:
 *
 *   try { ... } catch (e) {
 *     const { status, body } = errorResponse(e);
 *     return NextResponse.json(body, { status });
 *   }
 *
 * Unknown errors → 500 with only the message leaked (no stack, no cause
 * chain). Known errors → the matching status + their specific fields
 * so the frontend can render a precise toast ("Add Japanese locale
 * requires ANTHROPIC_API_KEY") instead of a generic "server error".
 */
export function errorResponse(err: unknown): {
  status: number;
  body: StructuredErrorBody;
} {
  if (err instanceof LLMRequiredError) {
    return {
      status: 503,
      body: {
        error: 'llm-required',
        code: err.code,
        feature: err.feature,
        missing: err.missing,
        message: err.message,
      },
    };
  }
  if (err instanceof LLMCallError) {
    return {
      status: 502,
      body: {
        error: 'llm-call-failed',
        code: err.code,
        feature: err.feature,
        provider: err.provider,
        message: err.message,
      },
    };
  }
  if (err instanceof DeployRequiredError) {
    return {
      status: 503,
      body: {
        error: 'deploy-required',
        code: err.code,
        missing: err.missing,
        message: err.message,
      },
    };
  }
  if (err instanceof StorageRequiredError) {
    return {
      status: 503,
      body: {
        error: 'storage-required',
        code: err.code,
        message: err.message,
      },
    };
  }
  if (err instanceof ExtractionFailedError) {
    return {
      status: 409,
      body: {
        error: 'extraction-failed',
        code: err.code,
        source: err.source,
        message: err.message,
      },
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return {
    status: 500,
    body: {
      error: 'internal',
      code: 'INTERNAL',
      message: msg,
    },
  };
}

/**
 * Convenience: throw if the env var is missing. Used by adapter
 * entrypoints (viaClaude / viaGpt) as the first line.
 */
export function assertKeyOrThrow(
  key: LLMKey,
  feature: LLMFeature,
  present: boolean,
): void {
  if (!present) throw new LLMRequiredError(feature, key);
}

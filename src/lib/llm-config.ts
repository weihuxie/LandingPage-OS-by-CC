/**
 * LLM configuration layer (2026-04 新增) — admin-configurable routing + model selection.
 *
 * Design goal: push "which provider runs which scenario" and "which
 * specific model version each provider uses" out of code and into a KV
 * value the admin can edit from /admin/llm, so a quota failure or a new
 * model release doesn't need a redeploy.
 *
 * Layer responsibilities:
 *   - DEFAULT_LLM_CONFIG is the ground truth when KV is unreachable / empty.
 *     Every field in LLMConfig has a default here so the app never blocks
 *     on "config not yet initialized".
 *   - MODEL_OPTIONS enumerates the models the admin UI offers per provider.
 *     Not used at runtime — the adapters accept whatever model string the
 *     KV value holds, so if a provider ships a new ID the admin can type
 *     it in even before we've added it to this list. The dropdown exists
 *     purely as a cheat-sheet so the admin doesn't have to memorize model
 *     names.
 *   - readLLMConfig() is cached per-request (noStore() in callers disables
 *     Next.js Data Cache; see CLAUDE.md §一.4.1). One KV GET per hot-path
 *     call; fall back to DEFAULT_LLM_CONFIG on error so a KV outage
 *     degrades to "use hardcoded models" rather than to a 5xx.
 *   - writeLLMConfig() is the admin-page-only writer; it validates the
 *     whole object in one shot and rejects partial writes (callers always
 *     submit the full config from the form).
 *
 * Error policy:
 *   - Read: never throws. Bad data → log + fall through to defaults.
 *     Dashboard still works with a stale config better than it works
 *     behind an error banner.
 *   - Write: throws on validation failure so the admin form can surface
 *     a precise error. No silent partial accept.
 */
import { kv } from '@vercel/kv';
import { promises as fs } from 'fs';
import path from 'path';
import { StorageRequiredError } from './errors';

/**
 * Which providers participate in scenario routing. Extract is Gemini-only
 * today but modeled as a single-value scenario for symmetry.
 */
export type LLMProvider = 'claude' | 'deepseek' | 'openai' | 'gemini';

/**
 * The four task scenarios that the router considers.
 *
 * - strategy: generate the four-section strategy summary (audience / goal
 *   / narrative / local). Locale-sensitive — JP has its own cell because
 *   Claude's JP copy still beats DeepSeek at the current quality bar.
 * - copy: rewrite a single text-heavy module (hero/pain/benefits/solution
 *   /cta). Same locale-sensitivity as strategy.
 * - localize: native-rewrite modules when the user adds a new locale
 *   (GPT-4o today). Locale-independent — the task IS the locale shift.
 * - extract: long-document ingestion (whitepapers, etc.). Gemini today.
 */
export type LLMScenario = 'strategy' | 'copy' | 'localize' | 'extract';

export interface LLMConfig {
  /** Schema version for forward-compat. Bump when shape changes. */
  version: 1;
  /**
   * Per-provider model identifier that the adapter passes to the SDK.
   * These are the strings the provider's API expects (e.g. the Anthropic
   * pinned model ID), not friendly names.
   */
  providers: {
    claude: { model: string };
    deepseek: { model: string };
    openai: { model: string };
    gemini: { model: string };
  };
  /**
   * Scenario → provider map.
   *
   * Strategy/copy are locale-sensitive via a 2-cell map (ja + default).
   * Localize/extract are single-cell because locale is an input to the
   * task, not a routing decision. If we need more granularity later
   * (per-locale localize provider, etc.) this shape is the place to add it
   * without changing the adapters or the UI's other rows.
   */
  scenarios: {
    strategy: { ja: LLMProvider; default: LLMProvider };
    copy: { ja: LLMProvider; default: LLMProvider };
    localize: LLMProvider;
    extract: LLMProvider;
  };
  /**
   * Automatic provider swap on transient failure. The UI exposes a single
   * on/off plus two toggles for the retry filter; we keep both the filter
   * and the provider ORDER so the admin can, say, fall back from GPT-4o
   * to Claude (which writes reasonable JP) before trying DeepSeek.
   */
  fallback: {
    enabled: boolean;
    /**
     * Error classes that trigger a fallback. "429-quota" is the sticky
     * "you exceeded your monthly billing" case — retrying without a swap
     * is pointless. "429-rate" is short-term rate limiting — the provider
     * will recover in seconds. "5xx" is infra. "4xx-auth" is deliberately
     * NOT listed: if a key is invalid we want the admin to see the error,
     * not to quietly swap and mask a misconfiguration.
     */
    triggers: Array<'429-quota' | '429-rate' | '5xx'>;
    /**
     * Priority order. First provider in the list gets the primary call;
     * later providers get retried in order on trigger-matching errors.
     * Providers without a configured API key are skipped, so the chain
     * degrades gracefully in environments where only a subset of keys
     * are wired.
     */
    chain: LLMProvider[];
  };
}

/**
 * Defaults. These reflect the pre-admin-config hardcoded routing:
 *   - JP → Claude; others → DeepSeek (strategy + copy)
 *   - localize always GPT-4o; extract always Gemini
 *   - fallback OFF by default (the admin has to opt in; silent swaps are
 *     a surprise-behavior risk for a solo-operator app).
 *
 * Model IDs:
 *   - Gemini default is 'gemini-3.0-pro' per explicit user decision. If
 *     the ID isn't live yet the call will 404 and the admin changes it
 *     from the UI in one click. Better to honor user intent than to
 *     second-guess by shipping an older default.
 *   - Others keep their pre-config hardcoded values.
 */
export const DEFAULT_LLM_CONFIG: LLMConfig = {
  version: 1,
  providers: {
    claude: { model: 'claude-opus-4-20250514' },
    deepseek: { model: 'deepseek-chat' },
    openai: { model: 'gpt-4o-2024-08-06' },
    gemini: { model: 'gemini-3.0-pro' },
  },
  scenarios: {
    strategy: { ja: 'claude', default: 'deepseek' },
    copy: { ja: 'claude', default: 'deepseek' },
    localize: 'openai',
    extract: 'gemini',
  },
  fallback: {
    enabled: false,
    triggers: ['429-quota', '5xx'],
    chain: ['claude', 'deepseek', 'openai', 'gemini'],
  },
};

/**
 * Curated dropdown catalog for the admin UI. These are the model IDs the
 * provider's API currently accepts. If a provider ships a new ID we
 * haven't added here, the admin can still type it into the "自定义"
 * field — the adapters don't validate against this list.
 *
 * Keep newest-first so the default at the top of each dropdown is the
 * latest model.
 */
export const MODEL_OPTIONS: Record<
  LLMProvider,
  Array<{ id: string; label: string }>
> = {
  claude: [
    { id: 'claude-opus-4-5-20251015', label: 'Claude Opus 4.5 (最新最强)' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { id: 'claude-opus-4-20250514', label: 'Claude Opus 4 (推荐 · 缓存稳定)' },
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (快/便宜)' },
    { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet (旧)' },
  ],
  gemini: [
    { id: 'gemini-3.0-pro', label: 'Gemini 3.0 Pro (最新最强)' },
    { id: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.0-pro-exp', label: 'Gemini 2.0 Pro (experimental)' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro-latest', label: 'Gemini 1.5 Pro (旧 · 目前 hardcoded)' },
    { id: 'gemini-1.5-flash-latest', label: 'Gemini 1.5 Flash (旧)' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'DeepSeek V3 Chat (通用 · 成本最低)' },
    // NOTE: deepseek-reasoner (R1) intentionally omitted. This codebase's
    // DeepSeek adapter uses tool_choice to force structured JSON, and
    // reasoner returns HTTP 400 ("does not support this tool_choice") —
    // it works only with plain text completions. Adding reasoner as a
    // separate code path (response_format: json_object + prompt-level
    // JSON spec) is viable future work, not in scope today. If admin
    // types it into the 自定义 field anyway, llm-deepseek's resolveModel
    // coerces it back to deepseek-chat with a warning.
  ],
  openai: [
    { id: 'gpt-4o-2024-08-06', label: 'GPT-4o 2024-08 (推荐)' },
    { id: 'gpt-4o', label: 'GPT-4o (latest alias)' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (快/便宜)' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'o1', label: 'o1 (推理)' },
    { id: 'o3-mini', label: 'o3 Mini' },
  ],
};

const KEY_LLM_CONFIG = 'lp:v2:llm-config';

function useKV(): boolean {
  // eslint-disable-next-line dot-notation
  return !!process.env['KV_REST_API_URL'] && !!process.env['KV_REST_API_TOKEN'];
}

/**
 * Same three-way decision `storage.ts` makes for Projects / Products:
 *   - Local (VERCEL !== '1') and no KV  → FS fallback at `.data/`
 *   - Vercel (VERCEL === '1')  and no KV  → refuse (StorageRequiredError)
 *   - KV configured anywhere             → KV
 *
 * The prior behavior was "silently skip the write and log a warning on
 * local dev". That read reasonable ("no KV means local dev, who cares")
 * but it made admin a no-op locally — you'd open /admin/llm, change a
 * model, hit save, see green "saved" and then refresh to find the old
 * value back, with no on-screen signal why. The 2026-04 post-save verify
 * in AdminLLMForm surfaces the mismatch in the UI, but the real fix is
 * to actually persist. FS persistence is bounded to the dev machine so
 * it can't leak into a stale-prod scenario.
 */
function isVercel(): boolean {
  // eslint-disable-next-line dot-notation
  return process.env['VERCEL'] === '1';
}

// FS location mirrors storage.ts — share the `.data/` directory so
// `rm -rf .data/` is the single local-state reset for all persisted
// objects. The file is `llm-config.json` (name is KEY_LLM_CONFIG with
// the `lp:` prefix stripped, matching storage.ts's fsPath convention).
const LLM_CONFIG_FS_PATH = path.join(
  // eslint-disable-next-line dot-notation
  process.env['DATA_DIR'] ?? path.join(process.cwd(), '.data'),
  KEY_LLM_CONFIG.replace(/^lp:/, '').replace(/:/g, '-') + '.json',
);

async function readFs(): Promise<LLMConfig | null> {
  try {
    const raw = await fs.readFile(LLM_CONFIG_FS_PATH, 'utf8');
    return JSON.parse(raw) as LLMConfig;
  } catch {
    // ENOENT on first run, or malformed JSON — treat both as "nothing
    // stored yet" and let the caller fall back to defaults.
    return null;
  }
}

async function writeFs(cfg: LLMConfig): Promise<void> {
  await fs.mkdir(path.dirname(LLM_CONFIG_FS_PATH), { recursive: true });
  await fs.writeFile(LLM_CONFIG_FS_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

/**
 * Returns the current LLM config. Never throws.
 *
 * Read order:
 *   1. KV when configured (prod, and local dev with Upstash wired up)
 *   2. FS at `.data/v2-llm-config.json` on local dev without KV
 *   3. DEFAULT_LLM_CONFIG when neither is present / stored value is bad
 *
 * Callers (the provider adapters) hit this on the hot path. Caching is
 * NOT layered here — the caller's route-level `noStore()` + dynamic =
 * 'force-dynamic' already handle freshness. A KV GET on Upstash is ~5ms,
 * an FS read is a ~single-digit-ms syscall, both negligible next to a
 * Claude/GPT call.
 */
export async function readLLMConfig(): Promise<LLMConfig> {
  if (useKV()) {
    try {
      const stored = (await kv.get<LLMConfig>(KEY_LLM_CONFIG)) ?? null;
      if (!stored) return DEFAULT_LLM_CONFIG;
      // Forward-migrate on read: any field missing from the stored config
      // (because this version added a field) picks up the default value
      // so we never return a partially-shaped config to the adapters.
      return mergeWithDefaults(stored);
    } catch (e) {
      console.error('[llm-config] KV read failed; falling back to defaults:', e);
      return DEFAULT_LLM_CONFIG;
    }
  }

  // No KV.
  if (isVercel()) {
    // Vercel + no KV was the exact fig-leaf storage.ts retired in 2026-04
    // — writes go to an ephemeral /tmp that evaporates cold-start. Don't
    // extend that risk here; admin just doesn't work without KV in prod.
    console.warn('[llm-config] Vercel without KV; returning defaults only.');
    return DEFAULT_LLM_CONFIG;
  }

  try {
    const stored = await readFs();
    if (!stored) return DEFAULT_LLM_CONFIG;
    return mergeWithDefaults(stored);
  } catch (e) {
    console.error('[llm-config] FS read failed; falling back to defaults:', e);
    return DEFAULT_LLM_CONFIG;
  }
}

/**
 * Replace the stored config. Validates the full shape in one pass and
 * refuses to persist anything invalid. Use only from the admin API.
 *
 * Throws StorageRequiredError on Vercel without KV — matches storage.ts,
 * surfaces as 503 ADMIN-layer so the admin form can show "set KV_REST_API_*
 * in Vercel project settings" instead of pretending the write succeeded.
 */
export async function writeLLMConfig(cfg: LLMConfig): Promise<void> {
  const err = validateLLMConfig(cfg);
  if (err) throw new Error(`invalid LLM config: ${err}`);

  if (useKV()) {
    await kv.set(KEY_LLM_CONFIG, cfg);
    return;
  }

  if (isVercel()) {
    // Same posture as storage.ts: we USED to write to /tmp here and
    // pretend it persisted. That silent-success was the bug — admin
    // would save, refresh, see the default config back, no hint why.
    // Fail loud now.
    throw new StorageRequiredError();
  }

  // Local dev: persist to `.data/` so edits survive server restarts and
  // the e2e/api tests can verify the round-trip.
  await writeFs(cfg);
}

/**
 * Full-config validator. Returns an error string on failure, or null on
 * success. Kept verbose + explicit because silent coercion on an admin-
 * facing form is worse than a surfaced error.
 */
export function validateLLMConfig(cfg: unknown): string | null {
  if (!cfg || typeof cfg !== 'object') return 'not an object';
  const c = cfg as Partial<LLMConfig>;
  if (c.version !== 1) return `unsupported version: ${c.version}`;

  // Providers
  const p = c.providers;
  if (!p || typeof p !== 'object') return 'providers missing';
  for (const name of ['claude', 'deepseek', 'openai', 'gemini'] as const) {
    const entry = p[name];
    if (!entry || typeof entry.model !== 'string' || !entry.model.trim()) {
      return `providers.${name}.model missing or empty`;
    }
  }

  // Scenarios
  const s = c.scenarios;
  if (!s || typeof s !== 'object') return 'scenarios missing';
  if (!isProvider(s.strategy?.ja) || !isProvider(s.strategy?.default)) {
    return 'scenarios.strategy malformed';
  }
  if (!isProvider(s.copy?.ja) || !isProvider(s.copy?.default)) {
    return 'scenarios.copy malformed';
  }
  if (!isProvider(s.localize)) return 'scenarios.localize malformed';
  if (!isProvider(s.extract)) return 'scenarios.extract malformed';

  // Fallback
  const f = c.fallback;
  if (!f || typeof f !== 'object') return 'fallback missing';
  if (typeof f.enabled !== 'boolean') return 'fallback.enabled not boolean';
  if (!Array.isArray(f.triggers)) return 'fallback.triggers not array';
  for (const t of f.triggers) {
    if (t !== '429-quota' && t !== '429-rate' && t !== '5xx') {
      return `fallback.triggers invalid value: ${t}`;
    }
  }
  if (!Array.isArray(f.chain)) return 'fallback.chain not array';
  for (const prov of f.chain) {
    if (!isProvider(prov)) return `fallback.chain invalid provider: ${prov}`;
  }

  return null;
}

function isProvider(v: unknown): v is LLMProvider {
  return v === 'claude' || v === 'deepseek' || v === 'openai' || v === 'gemini';
}

/**
 * Forward-compat merge: deep-spreads the stored value on top of defaults,
 * so a config stored before a new field was added still returns the new
 * field populated with its default.
 */
function mergeWithDefaults(stored: Partial<LLMConfig>): LLMConfig {
  return {
    version: 1,
    providers: {
      claude: {
        model: stored.providers?.claude?.model ?? DEFAULT_LLM_CONFIG.providers.claude.model,
      },
      deepseek: {
        model: stored.providers?.deepseek?.model ?? DEFAULT_LLM_CONFIG.providers.deepseek.model,
      },
      openai: {
        model: stored.providers?.openai?.model ?? DEFAULT_LLM_CONFIG.providers.openai.model,
      },
      gemini: {
        model: stored.providers?.gemini?.model ?? DEFAULT_LLM_CONFIG.providers.gemini.model,
      },
    },
    scenarios: {
      strategy: {
        ja: stored.scenarios?.strategy?.ja ?? DEFAULT_LLM_CONFIG.scenarios.strategy.ja,
        default: stored.scenarios?.strategy?.default ?? DEFAULT_LLM_CONFIG.scenarios.strategy.default,
      },
      copy: {
        ja: stored.scenarios?.copy?.ja ?? DEFAULT_LLM_CONFIG.scenarios.copy.ja,
        default: stored.scenarios?.copy?.default ?? DEFAULT_LLM_CONFIG.scenarios.copy.default,
      },
      localize: stored.scenarios?.localize ?? DEFAULT_LLM_CONFIG.scenarios.localize,
      extract: stored.scenarios?.extract ?? DEFAULT_LLM_CONFIG.scenarios.extract,
    },
    fallback: {
      enabled: stored.fallback?.enabled ?? DEFAULT_LLM_CONFIG.fallback.enabled,
      triggers: stored.fallback?.triggers ?? DEFAULT_LLM_CONFIG.fallback.triggers,
      chain: stored.fallback?.chain ?? DEFAULT_LLM_CONFIG.fallback.chain,
    },
  };
}

/**
 * Classify an SDK error into one of the fallback triggers. Used by the
 * wrapper that drives the fallback chain. Auth errors (401/403) and
 * generic 4xx (400, 422) are NOT retryable — they indicate a bad key or
 * a bad prompt, both of which survive a provider swap and just waste
 * the next provider's quota too.
 */
export function classifyProviderError(
  err: unknown,
): '429-quota' | '429-rate' | '5xx' | '4xx-auth' | '4xx-other' | 'network' | null {
  if (!err) return null;
  const e = err as {
    status?: number;
    message?: string;
    code?: string;
  };
  const msg = (e.message ?? '').toLowerCase();
  const status = typeof e.status === 'number' ? e.status : undefined;

  if (status === 401 || status === 403) return '4xx-auth';
  if (status === 429) {
    // Heuristic split: "quota" / "exceeded" / "billing" in the body is
    // usually the sticky exhaustion case (retrying the same provider is
    // pointless). Pure rate limits say "rate limit" / "too many requests"
    // and recover in seconds. If the message is ambiguous we default to
    // "quota" because treating quota as rate would cause rapid retry
    // loops that waste tokens before the chain kicks in.
    if (msg.includes('quota') || msg.includes('exceeded') || msg.includes('billing')) {
      return '429-quota';
    }
    if (msg.includes('rate') || msg.includes('too many')) return '429-rate';
    return '429-quota';
  }
  if (status && status >= 500 && status < 600) return '5xx';
  if (status && status >= 400 && status < 500) return '4xx-other';
  if (!status) return 'network';
  return null;
}

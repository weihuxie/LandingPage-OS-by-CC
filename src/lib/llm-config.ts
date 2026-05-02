/**
 * Admin-tunable LLM configuration · v2 schema.
 *
 * v1 (deprecated, transparently migrated) split the config into three
 * disjoint surfaces:
 *   ① providers.{X}.model       — global model id per provider
 *   ② scenarios.{X}.{ja, default} — primary provider per scenario
 *   ③ fallback.{enabled, chain, triggers} — global retry chain
 *
 * To know how a single call would behave, an admin had to triangulate
 * across three sections, and trigger/enabled were global so per-scenario
 * tuning was impossible. v2 collapses everything into self-contained
 * ScenarioPolicy blocks: each scenario carries its own provider+model
 * chain, its own trigger list, its own enable toggle. Reading one block
 * tells you exactly what happens for that scenario, no mental joins.
 *
 * Migration: `migrateOldConfig()` reads a v1-shaped blob and produces a
 * v2 ScenarioPolicy by:
 *   - building chain[0] from (scenarios.X.primary, providers.<primary>.model)
 *   - appending (provider, providers.<provider>.model) for every other
 *     provider in fallback.chain
 *   - copying fallback.enabled / fallback.triggers verbatim into each
 *     scenario's policy (they were global in v1)
 * The migration runs on read, so KV doesn't need a one-shot rewrite —
 * the next save persists the v2 shape and the v1 blob never re-loads.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { kv } from '@vercel/kv';
import { StorageRequiredError } from './errors';

export type LLMProvider = 'claude' | 'deepseek' | 'openai' | 'gemini';

export type LLMScenario = 'strategy' | 'copy' | 'localize' | 'extract' | 'judge';

export type TriggerClass = '429-quota' | '429-rate' | '5xx';

/**
 * One step in a scenario's provider/model ladder. The first step in a
 * scenario's `chain` is the primary; the rest are fallback rungs walked
 * top-down on trigger-matching errors.
 *
 * `mode` is reserved for scenario-specific behavior dialects. Today the
 * only consumer is `localize` whose non-OpenAI fallback steps run in
 * `skip-polish` mode (no LLM call — return the Claude hydrate-time
 * output unmodified, the documented graceful-degrade path). Most steps
 * default to `normal`.
 */
export interface ScenarioStep {
  provider: LLMProvider;
  /** Provider model ID (the string the SDK sends) */
  model: string;
  mode?: 'normal' | 'skip-polish';
}

export interface ScenarioPolicy {
  /** When false, the scenario refuses calls and the route returns 503. */
  enabled: boolean;
  /** First step is primary; rest are tried in order on trigger match. */
  chain: ScenarioStep[];
  /** Which error classes promote a hop to the next chain step. */
  triggers: TriggerClass[];
}

export interface LLMConfig {
  version: 2;
  scenarios: {
    // v2.1 (2026-04): collapsed the JP/default split for strategy + copy.
    // Original v2 had `{ ja, default }` per scenario, on the assumption
    // Japanese needed Claude while everything else could go cheaper. The
    // split made admins maintain two near-identical chains and read 6
    // configs to understand 4 scenarios. Empirically the same chain works
    // across locales — the model is the same; locale is just an input.
    strategy: ScenarioPolicy;
    copy: ScenarioPolicy;
    localize: ScenarioPolicy;
    extract: ScenarioPolicy;
    /**
     * Independent-reader judge agent. The chain[0] picks the provider that
     * critiques the page; cross-family separation from `copy` is enforced
     * structurally — see pickJudgeProvider in src/lib/judge.ts. The chain
     * is walked just like other scenarios on trigger-matching errors.
     *
     * Default: claude → deepseek (claude first because the default `copy`
     * is deepseek; this gives natural cross-family judging out of the box).
     * Admin can flip the order — same-family configs surface a red banner
     * in the editor's evaluation drawer, they don't refuse to run.
     */
    judge: ScenarioPolicy;
  };
}

// ---------- Defaults --------------------------------------------------

function chainFor(...steps: Array<[LLMProvider, string]>): ScenarioStep[] {
  return steps.map(([provider, model]) => ({ provider, model }));
}

const CLAUDE_MODEL_DEFAULT = 'claude-opus-4-20250514';
const DEEPSEEK_MODEL_DEFAULT = 'deepseek-chat'; // V3, V4 still no tool_choice
const OPENAI_MODEL_DEFAULT = 'gpt-4o';
const GEMINI_MODEL_DEFAULT = 'gemini-3.0-pro';

const DEFAULT_TRIGGERS: TriggerClass[] = ['429-quota', '5xx'];

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  version: 2,
  scenarios: {
    strategy: {
      enabled: true,
      chain: chainFor(
        ['deepseek', DEEPSEEK_MODEL_DEFAULT],
        ['claude', CLAUDE_MODEL_DEFAULT],
      ),
      triggers: [...DEFAULT_TRIGGERS],
    },
    copy: {
      enabled: true,
      chain: chainFor(
        ['deepseek', DEEPSEEK_MODEL_DEFAULT],
        ['claude', CLAUDE_MODEL_DEFAULT],
      ),
      triggers: [...DEFAULT_TRIGGERS],
    },
    localize: {
      enabled: true,
      // Step 0: real OpenAI polish. Step 1: 'skip-polish' fallback —
      // no LLM call, returns Claude hydrate-time native output. Provider
      // tagged 'claude' just to record the source of the result; the
      // executor branches on `mode` not provider.
      chain: [
        { provider: 'openai', model: OPENAI_MODEL_DEFAULT, mode: 'normal' },
        { provider: 'claude', model: CLAUDE_MODEL_DEFAULT, mode: 'skip-polish' },
      ],
      triggers: [...DEFAULT_TRIGGERS],
    },
    extract: {
      enabled: true,
      // Single adapter today. No useful fallback yet.
      chain: chainFor(['gemini', GEMINI_MODEL_DEFAULT]),
      triggers: [...DEFAULT_TRIGGERS],
    },
    judge: {
      enabled: true,
      // Default opposite of copy → cross-family by default. Admin can
      // flip; same-family configs warn but don't block.
      chain: chainFor(
        ['claude', CLAUDE_MODEL_DEFAULT],
        ['deepseek', DEEPSEEK_MODEL_DEFAULT],
      ),
      triggers: [...DEFAULT_TRIGGERS],
    },
  },
};

// ---------- Curated UI catalog ----------------------------------------

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
    { id: 'gemini-1.5-pro-latest', label: 'Gemini 1.5 Pro (旧)' },
    { id: 'gemini-1.5-flash-latest', label: 'Gemini 1.5 Flash (旧)' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'DeepSeek V3 Chat (推荐 · tool_choice 稳定 · 2026-07-24 弃用)' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (V4 旗舰 · 当前 tool_choice 不可用 ⚠️)' },
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (V4 轻量 · 当前 tool_choice 不可用 ⚠️)' },
    // deepseek-reasoner intentionally omitted — see runtime coercion
    // in llm-deepseek.ts.
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o (latest alias · 网关首选)' },
    { id: 'gpt-4o-2024-08-06', label: 'GPT-4o 2024-08 (固定版本)' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (快/便宜)' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'o1', label: 'o1 (推理)' },
    { id: 'o3-mini', label: 'o3 Mini' },
  ],
};

// ---------- Validation -------------------------------------------------

const TRIGGER_VALUES: TriggerClass[] = ['429-quota', '429-rate', '5xx'];

function isProvider(v: unknown): v is LLMProvider {
  return v === 'claude' || v === 'deepseek' || v === 'openai' || v === 'gemini';
}
function isTrigger(v: unknown): v is TriggerClass {
  return TRIGGER_VALUES.includes(v as TriggerClass);
}
function isStep(v: unknown): v is ScenarioStep {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<ScenarioStep>;
  if (!isProvider(s.provider)) return false;
  if (typeof s.model !== 'string' || !s.model.trim()) return false;
  if (s.mode != null && s.mode !== 'normal' && s.mode !== 'skip-polish') return false;
  return true;
}
function isPolicy(v: unknown): v is ScenarioPolicy {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<ScenarioPolicy>;
  if (typeof p.enabled !== 'boolean') return false;
  if (!Array.isArray(p.chain)) return false;
  if (p.chain.length === 0) return false; // primary required
  for (const step of p.chain) if (!isStep(step)) return false;
  if (!Array.isArray(p.triggers)) return false;
  for (const t of p.triggers) if (!isTrigger(t)) return false;
  return true;
}

export function validateLLMConfig(cfg: unknown): string | null {
  if (!cfg || typeof cfg !== 'object') return 'not an object';
  const c = cfg as Partial<LLMConfig>;
  if (c.version !== 2) return `unsupported version: ${c.version}`;
  const s = c.scenarios;
  if (!s) return 'scenarios missing';
  if (!isPolicy((s as any).strategy)) return 'scenarios.strategy invalid';
  if (!isPolicy((s as any).copy)) return 'scenarios.copy invalid';
  if (!isPolicy(s.localize)) return 'scenarios.localize invalid';
  if (!isPolicy(s.extract)) return 'scenarios.extract invalid';
  // judge added 2026-05; tolerate absence on read (mergeWithDefaults
  // seeds it) but require valid shape if present.
  if (s.judge !== undefined && !isPolicy(s.judge)) return 'scenarios.judge invalid';
  return null;
}

// ---------- v1 → v2 migration -----------------------------------------

interface LegacyV1Config {
  version: 1;
  providers?: Partial<Record<LLMProvider, { model?: string }>>;
  scenarios?: {
    strategy?: { ja?: LLMProvider; default?: LLMProvider };
    copy?: { ja?: LLMProvider; default?: LLMProvider };
    localize?: LLMProvider;
    extract?: LLMProvider;
  };
  fallback?: {
    enabled?: boolean;
    triggers?: TriggerClass[];
    chain?: LLMProvider[];
  };
}

function isLegacyV1(v: unknown): v is LegacyV1Config {
  if (!v || typeof v !== 'object') return false;
  const c = v as { version?: unknown };
  return c.version === 1;
}

function modelForProvider(
  legacy: LegacyV1Config,
  p: LLMProvider,
): string {
  return (
    legacy.providers?.[p]?.model ??
    (p === 'claude'
      ? CLAUDE_MODEL_DEFAULT
      : p === 'deepseek'
        ? DEEPSEEK_MODEL_DEFAULT
        : p === 'openai'
          ? OPENAI_MODEL_DEFAULT
          : GEMINI_MODEL_DEFAULT)
  );
}

function buildChainFromLegacy(
  legacy: LegacyV1Config,
  primary: LLMProvider,
): ScenarioStep[] {
  const chain: ScenarioStep[] = [
    { provider: primary, model: modelForProvider(legacy, primary) },
  ];
  const ladder = legacy.fallback?.chain ?? ['claude', 'deepseek', 'openai', 'gemini'];
  for (const p of ladder) {
    if (p === primary) continue;
    chain.push({ provider: p, model: modelForProvider(legacy, p) });
  }
  return chain;
}

export function migrateOldConfig(legacy: LegacyV1Config): LLMConfig {
  const enabled = legacy.fallback?.enabled ?? false;
  const triggers = legacy.fallback?.triggers ?? [...DEFAULT_TRIGGERS];
  // v2.1: drop the JP/default split. We pick `default` as the canonical
  // primary because it covers the wider locale set; admins who want JP-
  // specific routing can manually rewire the chain after migration.
  const strat = legacy.scenarios?.strategy?.default
    ?? legacy.scenarios?.strategy?.ja
    ?? 'deepseek';
  const cop = legacy.scenarios?.copy?.default
    ?? legacy.scenarios?.copy?.ja
    ?? 'deepseek';
  const loc = legacy.scenarios?.localize ?? 'openai';
  const ext = legacy.scenarios?.extract ?? 'gemini';

  const policy = (
    chain: ScenarioStep[],
    perScenarioEnabled: boolean = enabled,
  ): ScenarioPolicy => ({
    enabled: perScenarioEnabled,
    chain,
    triggers: [...triggers],
  });

  return {
    version: 2,
    scenarios: {
      strategy: policy(buildChainFromLegacy(legacy, strat), true),
      copy: policy(buildChainFromLegacy(legacy, cop), true),
      localize:
        loc === 'openai'
          ? policy(
              [
                { provider: 'openai', model: modelForProvider(legacy, 'openai'), mode: 'normal' },
                { provider: 'claude', model: modelForProvider(legacy, 'claude'), mode: 'skip-polish' },
              ],
              true,
            )
          : policy(buildChainFromLegacy(legacy, loc), true),
      extract: policy([{ provider: ext, model: modelForProvider(legacy, ext) }], true),
      // Judge wasn't a v1 concept — seed with the v2 default. Cross-family
      // ordering vs the migrated copy chain is approximate here; admin can
      // tune in /admin/llm after migration if it ends up same-family.
      judge: policy(
        [
          { provider: 'claude', model: modelForProvider(legacy, 'claude') },
          { provider: 'deepseek', model: modelForProvider(legacy, 'deepseek') },
        ],
        true,
      ),
    },
  };
}

// ---------- Storage adapter -------------------------------------------

const KEY = 'lp:v2:llm-config';
const FS_DIR = path.join(process.cwd(), '.data');
const FS_FILE = path.join(FS_DIR, 'v2-llm-config.json');

function useKV(): boolean {
  // eslint-disable-next-line dot-notation
  return !!process.env['KV_REST_API_URL'] && !!process.env['KV_REST_API_TOKEN'];
}
function isVercel(): boolean {
  // eslint-disable-next-line dot-notation
  return process.env['VERCEL'] === '1';
}

async function readKV(): Promise<unknown> {
  return await kv.get(KEY);
}
async function writeKV(cfg: LLMConfig): Promise<void> {
  await kv.set(KEY, cfg);
}
async function readFs(): Promise<unknown> {
  try {
    const raw = await fs.readFile(FS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e: any) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}
async function writeFs(cfg: LLMConfig): Promise<void> {
  await fs.mkdir(FS_DIR, { recursive: true });
  await fs.writeFile(FS_FILE, JSON.stringify(cfg, null, 2));
}

/**
 * Read the live config. Layered:
 *   1. KV (prod / configured local) → migrate if v1, return v2
 *   2. Fs (.data/v2-llm-config.json on local dev) → same migration
 *   3. Defaults — when neither exists, return DEFAULT_LLM_CONFIG
 */
export async function readLLMConfig(): Promise<LLMConfig> {
  let stored: unknown = null;
  if (useKV()) {
    stored = await readKV();
  } else {
    if (isVercel()) throw new StorageRequiredError();
    stored = await readFs();
  }
  if (!stored) return DEFAULT_LLM_CONFIG;
  if (isLegacyV1(stored)) return migrateOldConfig(stored);
  // Forward-compat merge: if a field is missing entirely (e.g. a future
  // schema added a new scenario), fall back to defaults for that field
  // rather than crashing the whole admin page.
  return mergeWithDefaults(stored as Partial<LLMConfig>);
}

export async function writeLLMConfig(cfg: LLMConfig): Promise<void> {
  if (useKV()) {
    await writeKV(cfg);
    return;
  }
  if (isVercel()) throw new StorageRequiredError();
  await writeFs(cfg);
}

function mergeWithDefaults(stored: Partial<LLMConfig>): LLMConfig {
  // v2.0 → v2.1: collapse the old { ja, default } structure to a single
  // policy. Take `default` (or `ja` if default's empty / not policy-shaped).
  // Stored shape may still carry old ja/default in the wild — coerce here.
  function pickStrategyOrCopy(
    blob: any,
    fallback: ScenarioPolicy,
  ): ScenarioPolicy {
    if (!blob) return fallback;
    if (isPolicy(blob)) return blob; // already collapsed (v2.1+ KV blob)
    // Old v2.0 shape: { ja: ScenarioPolicy, default: ScenarioPolicy }
    if (isPolicy(blob.default)) return blob.default;
    if (isPolicy(blob.ja)) return blob.ja;
    return fallback;
  }
  return {
    version: 2,
    scenarios: {
      strategy: pickStrategyOrCopy(
        stored.scenarios?.strategy,
        DEFAULT_LLM_CONFIG.scenarios.strategy,
      ),
      copy: pickStrategyOrCopy(stored.scenarios?.copy, DEFAULT_LLM_CONFIG.scenarios.copy),
      localize: stored.scenarios?.localize ?? DEFAULT_LLM_CONFIG.scenarios.localize,
      extract: stored.scenarios?.extract ?? DEFAULT_LLM_CONFIG.scenarios.extract,
      // Forward-compat: pre-judge KV blobs lack this key — seed defaults.
      judge: stored.scenarios?.judge ?? DEFAULT_LLM_CONFIG.scenarios.judge,
    },
  };
}

// ---------- Resolution helper -----------------------------------------

/**
 * Pick the scenario policy. v2.1: locale-independent — every scenario
 * uses one policy regardless of language. The `locale` param is kept
 * in the signature for back-compat with callers that haven't been
 * updated; it's accepted and ignored.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function policyFor(
  cfg: LLMConfig,
  scenario: LLMScenario,
  _locale?: string,
): ScenarioPolicy {
  return cfg.scenarios[scenario];
}

// ---------- Error classifier (carried over from v1) -------------------

/**
 * Classify a provider error into the bucket used by `triggers` to decide
 * fallback. See the inline comments for what each bucket means.
 *
 * - 429-quota: sticky billing exhaustion (Anthropic 400 "credit balance",
 *   OpenAI 429 / 400 with insufficient_quota, HTTP 402, KSP 403 "has not
 *   activated the model"). Retry on the same provider is pointless;
 *   chain walk to a different one is the correct response.
 * - 429-rate: short-term rate limit. The provider will recover in
 *   seconds; the chain may still help when the admin has cheaper/faster
 *   options ahead of the primary.
 * - 5xx: infra hiccup. Chain walk often clears it.
 * - 4xx-auth (401/403, no quota keywords): API key really wrong. Chain
 *   walk doesn't help; let the admin see the error.
 * - 4xx-other (400, 422 etc with no quota keywords): the prompt or
 *   payload is bad. Chain walk just burns tokens to confirm the same
 *   bad input across providers.
 * - network: SDK didn't even reach the wire. Treat like 5xx.
 */
export function classifyProviderError(
  err: unknown,
):
  | '429-quota'
  | '429-rate'
  | '5xx'
  | '4xx-auth'
  | '4xx-other'
  | 'network'
  | null {
  if (!err) return null;
  // Unwrap LLMCallError to inspect the underlying SDK error's status/msg.
  const raw = (err as { cause?: unknown })?.cause ?? err;
  const e = raw as {
    status?: number;
    message?: string;
    code?: string;
  };
  const msg = (e.message ?? '').toLowerCase();
  const status = typeof e.status === 'number' ? e.status : undefined;
  const code = (e.code ?? '').toLowerCase();

  // Gateway-style quota / billing sentinels — KSP 403 "has not activated",
  // Anthropic 400 "credit balance too low", OpenAI 400 with insufficient_quota,
  // etc. These look like 4xx but mean "billing problem" so chain walk is
  // correct. Check before the 401/403 short-circuit below.
  const isQuotaMessage =
    msg.includes('credit balance') ||
    msg.includes('insufficient_quota') ||
    msg.includes('purchase credits') ||
    msg.includes('plans & billing') ||
    msg.includes('billing') ||
    msg.includes('has not activated the model') ||
    msg.includes('activate the model in the ksp') ||
    msg.includes('not activated') ||
    code === 'insufficient_quota';
  if (status && status >= 400 && status < 500 && isQuotaMessage) {
    return '429-quota';
  }

  if (status === 401 || status === 403) return '4xx-auth';
  if (status === 402) return '429-quota';
  if (status === 429) {
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

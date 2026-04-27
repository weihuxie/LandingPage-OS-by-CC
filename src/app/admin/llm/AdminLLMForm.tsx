'use client';

import { useMemo, useState } from 'react';
import type { LLMConfig, LLMProvider } from '@/lib/llm-config';

type ModelOption = { id: string; label: string };
type ProviderStatus = Record<LLMProvider, boolean>;

interface Props {
  initialConfig: LLMConfig;
  defaults: LLMConfig;
  modelOptions: Record<LLMProvider, ModelOption[]>;
  providerStatus: ProviderStatus;
}

// Provider metadata — display name, env var, primary use case. Used in
// dropdowns, section headers, and the fallback chain reorder UI.
const PROVIDER_META: Record<
  LLMProvider,
  { name: string; envVar: string; hint: string }
> = {
  claude: {
    name: 'Claude (Anthropic)',
    envVar: 'ANTHROPIC_API_KEY',
    hint: '高质量结构化文案 · JP locale 首选 · 有 prompt cache',
  },
  deepseek: {
    name: 'DeepSeek',
    envVar: 'DEEPSEEK_API_KEY',
    hint: '成本最低（~1/30 Claude）· 非 JP 默认 · OpenAI 兼容',
  },
  openai: {
    name: 'GPT-4o (OpenAI)',
    envVar: 'OPENAI_API_KEY',
    hint: '多语言 localize · 文化自检 · JSON mode',
  },
  gemini: {
    name: 'Gemini (Google)',
    envVar: 'GOOGLE_API_KEY',
    hint: '长文档抽取（2M 窗口）· 白皮书/手册 extract',
  },
};

const ALL_PROVIDERS: LLMProvider[] = ['claude', 'deepseek', 'openai', 'gemini'];

/**
 * Per-provider "this model ID is known not to work with our adapter"
 * flags. Mirrors the runtime coerce in llm-deepseek.ts. Kept tiny and
 * hand-maintained — the universe of adapter-incompatible models is small
 * and we want admins to see WHY a pick is flagged, not a generic "bad
 * value" message.
 */
const INCOMPATIBLE_MODELS: Partial<
  Record<LLMProvider, Array<{ id: string; reason: string }>>
> = {
  deepseek: [
    {
      id: 'deepseek-reasoner',
      reason:
        'R1 系列不支持 tool_choice，当前 adapter 依赖 tool_choice 做结构化输出。' +
        '选它后调用会被自动回退到 deepseek-v4-pro（server 日志会 warn）。' +
        '官方 2026-07-24 弃用。',
    },
  ],
};

/**
 * Sentinel value used in the model <select> to mean "switch this row to a
 * free-form text input". Picked deliberately ugly so it can't collide with
 * a real provider model ID (OpenAI/Anthropic/etc never use double
 * underscores). The value never lands in LLMConfig — it's translated to
 * an empty-string model in onChange, which puts the row into custom mode
 * with the input focused.
 */
const CUSTOM_MODEL_SENTINEL = '__custom__';

export default function AdminLLMForm({
  initialConfig,
  defaults,
  modelOptions,
  providerStatus,
}: Props) {
  const [config, setConfig] = useState<LLMConfig>(initialConfig);
  // Baseline = "what's currently on the server". Starts equal to
  // initialConfig (the SSR snapshot), then advances to the just-saved
  // value on a successful PUT. Dirty comparison MUST use this, not
  // initialConfig — otherwise `config !== initialConfig` stays true
  // forever after the first save and "有未保存的改动" sticks (the bug a
  // user reported in 2026-04).
  const [baseline, setBaseline] = useState<LLMConfig>(initialConfig);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(baseline),
    [config, baseline],
  );

  // --- Mutators ---------------------------------------------------------

  function setModel(p: LLMProvider, model: string) {
    setConfig((c) => ({
      ...c,
      providers: { ...c.providers, [p]: { model } },
    }));
  }

  function setScenarioStrategy(key: 'ja' | 'default', v: LLMProvider) {
    setConfig((c) => ({
      ...c,
      scenarios: {
        ...c.scenarios,
        strategy: { ...c.scenarios.strategy, [key]: v },
      },
    }));
  }
  function setScenarioCopy(key: 'ja' | 'default', v: LLMProvider) {
    setConfig((c) => ({
      ...c,
      scenarios: {
        ...c.scenarios,
        copy: { ...c.scenarios.copy, [key]: v },
      },
    }));
  }
  function setScenarioSimple(s: 'localize' | 'extract', v: LLMProvider) {
    setConfig((c) => ({
      ...c,
      scenarios: { ...c.scenarios, [s]: v },
    }));
  }

  function toggleFallback(v: boolean) {
    setConfig((c) => ({ ...c, fallback: { ...c.fallback, enabled: v } }));
  }
  function toggleTrigger(t: '429-quota' | '429-rate' | '5xx', on: boolean) {
    setConfig((c) => ({
      ...c,
      fallback: {
        ...c.fallback,
        triggers: on
          ? Array.from(new Set([...c.fallback.triggers, t]))
          : c.fallback.triggers.filter((x) => x !== t),
      },
    }));
  }
  function moveChain(from: number, to: number) {
    setConfig((c) => {
      const chain = [...c.fallback.chain];
      if (to < 0 || to >= chain.length) return c;
      const [item] = chain.splice(from, 1);
      chain.splice(to, 0, item);
      return { ...c, fallback: { ...c.fallback, chain } };
    });
  }

  function resetToDefaults() {
    if (!confirm('重置为代码默认值？未保存的改动会丢。')) return;
    setConfig(defaults);
  }

  // --- Save -------------------------------------------------------------

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch('/api/admin/llm-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      const body = await resp.json().catch(() => null);
      if (!resp.ok) {
        setError(
          (body && body.message) ||
            `保存失败（HTTP ${resp.status}）`,
        );
        return;
      }
      // Advance the baseline to the just-persisted shape so the dirty
      // indicator clears. Prefer the server-echoed config (authoritative
      // — validateLLMConfig ran on it) when present; fall back to the
      // local snapshot if the response body is missing it.
      const persisted: LLMConfig =
        body && body.config ? (body.config as LLMConfig) : config;
      setBaseline(persisted);
      setConfig(persisted);
      setSavedAt(Date.now());

      // Post-save verify: re-GET the config and sanity-check that what
      // the server has stored matches what we just sent. Catches the
      // "PUT returned 200 but KV silently no-op'd" scenarios — e.g.
      // `writeLLMConfig` short-circuits when KV isn't configured, or
      // an upstream proxy swallows PATCHes, or the middleware rewrote
      // the body. Prior to this check, those all looked like success
      // in the UI while the stored value was actually stale. The
      // 2026-04 "我点了保存但没保存上" report is what motivated it.
      try {
        const verifyResp = await fetch('/api/admin/llm-config', {
          cache: 'no-store',
        });
        if (verifyResp.ok) {
          const verifyBody = await verifyResp.json();
          const serverConfig = verifyBody?.config;
          if (
            serverConfig &&
            JSON.stringify(serverConfig) !== JSON.stringify(persisted)
          ) {
            setError(
              'PUT 返回 200 但 KV 里存的值和刚提交的不一致 —— 可能是后端没配 KV 或写入被吞。检查 /api/health 的 storage 字段。',
            );
          }
        }
      } catch {
        // Verify failures are advisory only — primary save already
        // succeeded per the PUT response. Don't flip it to an error.
      }
    } catch (e: any) {
      setError(e?.message ?? '网络错误');
    } finally {
      setBusy(false);
    }
  }

  // --- Render -----------------------------------------------------------

  return (
    <div className="mt-6 space-y-6">
      {/* Section 1: Model versions */}
      <section className="card p-5">
        <h2 className="text-base font-semibold">① 各提供商用的具体模型</h2>
        <p className="mt-1 text-xs text-ink-500">
          下拉里是已知列表，不在列表里的型号也能直接手填（provider 新发了型号时）。
        </p>
        <div className="mt-4 space-y-4">
          {ALL_PROVIDERS.map((p) => (
            <ModelRow
              key={p}
              provider={p}
              model={config.providers[p].model}
              options={modelOptions[p]}
              keyConfigured={providerStatus[p]}
              onChange={(m) => setModel(p, m)}
            />
          ))}
        </div>
      </section>

      {/* Section 2: Scenario routing */}
      <section className="card p-5">
        <h2 className="text-base font-semibold">② 不同场景用哪家</h2>
        <p className="mt-1 text-xs text-ink-500">
          JP（日文）locale 可以和其他语言走不同家 —— 历史上 Claude 的日文最稳。
        </p>
        <div className="mt-4 space-y-4">
          <ScenarioRow
            label="策略生成"
            hint="4 段式 strategy summary（audience / goal / narrative / local）"
            locales={[
              {
                key: 'ja',
                label: 'JP',
                value: config.scenarios.strategy.ja,
                onChange: (v) => setScenarioStrategy('ja', v),
              },
              {
                key: 'default',
                label: '其他',
                value: config.scenarios.strategy.default,
                onChange: (v) => setScenarioStrategy('default', v),
              },
            ]}
          />
          <ScenarioRow
            label="模块文案"
            hint="hero / pain / benefits / solution / cta 的重写"
            locales={[
              {
                key: 'ja',
                label: 'JP',
                value: config.scenarios.copy.ja,
                onChange: (v) => setScenarioCopy('ja', v),
              },
              {
                key: 'default',
                label: '其他',
                value: config.scenarios.copy.default,
                onChange: (v) => setScenarioCopy('default', v),
              },
            ]}
          />
          <ScenarioRow
            label="本地化 pass"
            hint="加新语言时把现有内容按目标 locale 重写（不是机翻）"
            locales={[
              {
                key: 'single',
                label: '所有 locale',
                value: config.scenarios.localize,
                onChange: (v) => setScenarioSimple('localize', v),
              },
            ]}
          />
          <ScenarioRow
            label="长文档抽取"
            hint="白皮书 / 手册 extract → ExtractedContext"
            locales={[
              {
                key: 'single',
                label: '所有输入',
                value: config.scenarios.extract,
                onChange: (v) => setScenarioSimple('extract', v),
              },
            ]}
          />
        </div>
      </section>

      {/* Section 3: Fallback */}
      <section className="card p-5">
        <h2 className="text-base font-semibold">③ 失败自动切换</h2>
        <p className="mt-1 text-xs text-ink-500">
          开启后：命中触发条件时，按下面的优先级顺序换下一家重试。API key 无效（401/403）永远不会自动切 —— 换家也是白搭，而且会浪费下一家的额度。
        </p>
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.fallback.enabled}
            onChange={(e) => toggleFallback(e.target.checked)}
          />
          <span className="font-medium">开启 fallback</span>
        </label>

        <div className={config.fallback.enabled ? 'mt-4' : 'mt-4 opacity-50 pointer-events-none'}>
          <div className="text-sm font-medium">触发条件</div>
          <div className="mt-2 space-y-1.5 text-sm">
            {(
              [
                ['429-quota', '429 · 配额/账单用完（sticky，换家才有意义）'],
                ['429-rate', '429 · 短时 rate limit（等一下也会恢复，通常换家反而浪费）'],
                ['5xx', '5xx · 服务端抖动'],
              ] as const
            ).map(([t, desc]) => (
              <label key={t} className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={config.fallback.triggers.includes(t)}
                  onChange={(e) => toggleTrigger(t, e.target.checked)}
                />
                <span className="text-xs text-ink-700">{desc}</span>
              </label>
            ))}
          </div>

          <div className="mt-5 text-sm font-medium">优先级顺序</div>
          <p className="text-xs text-ink-500">
            按顺序尝试。未配 key 的 provider 自动跳过。
          </p>
          <ul className="mt-2 space-y-1">
            {config.fallback.chain.map((p, i) => (
              <li
                key={p}
                className="flex items-center justify-between rounded-lg border border-ink-100 bg-white px-3 py-2 text-sm"
              >
                <span>
                  {i + 1}. {PROVIDER_META[p].name}
                  {!providerStatus[p] && (
                    <span className="ml-2 text-xs text-red-600">（未配 key）</span>
                  )}
                </span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => moveChain(i, i - 1)}
                    disabled={i === 0}
                    className="btn btn-secondary px-2 py-1 text-xs disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveChain(i, i + 1)}
                    disabled={i === config.fallback.chain.length - 1}
                    className="btn btn-secondary px-2 py-1 text-xs disabled:opacity-30"
                  >
                    ↓
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Action bar. Pill-shaped status indicators (vs the prior thin
          gray text) so a successful save is visually obvious — the 2026-04
          "我点了保存但没保存上" user report turned out to be partly a
          visibility issue: the small text feedback got missed and the
          sticky bar looked identical before/after the PUT.

          Four states, exactly one pill always visible:
            error         → red "✗ …"           (save failed / verify mismatch)
            dirty         → amber "● 有未保存的改动"
            savedAt       → emerald "✓ 已保存 · <time>" (this session's save)
            (none above)  → slate "· 无改动（与服务器一致）"

          The neutral state was added after a 2026-04 report: user saw a
          custom model value pre-filled on page load, hit the save button,
          got nothing (button was disabled). Turned out the value was
          already in KV from a prior save — button-disabled was correct,
          but empty pill area made "everything's fine" look identical to
          "nothing to save" and "save silently broken". The neutral pill
          distinguishes the first from the others.
       */}
      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white p-3 shadow-lg">
        <div className="flex items-center gap-2">
          {error ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 ring-1 ring-inset ring-red-200">
              ✗ {error}
            </span>
          ) : dirty ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
              ● 有未保存的改动
            </span>
          ) : savedAt ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
              ✓ 已保存 · {new Date(savedAt).toLocaleTimeString()}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
              · 无改动（与服务器一致）
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={resetToDefaults}
            disabled={busy}
            className="btn btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
          >
            重置为默认
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="btn btn-primary px-4 py-1.5 text-xs disabled:opacity-50"
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------

function ModelRow({
  provider,
  model,
  options,
  keyConfigured,
  onChange,
}: {
  provider: LLMProvider;
  model: string;
  options: ModelOption[];
  keyConfigured: boolean;
  onChange: (m: string) => void;
}) {
  const meta = PROVIDER_META[provider];
  // A row is in "custom mode" when its stored value isn't in the preset
  // catalog. We DERIVE this from the value instead of tracking it as
  // separate state — that way a KV round-trip (load config → form →
  // save → re-load) always lands in the same UI shape, and there's no
  // second source of truth to keep in sync. Older split-mode version
  // had a `customMode` useState that got out of sync with the model
  // value after save and caused the "clicked 自定义, typed value, hit
  // save, clicked 返回下拉, value still stuck" dance.
  const isPreset = options.some((o) => o.id === model);
  // Surface known-incompatible picks so the admin doesn't have to hit a
  // 400 to discover "reasoner breaks regen". The adapter coerces at
  // runtime, but the warning lets them fix the config proactively.
  const incompatible = INCOMPATIBLE_MODELS[provider]?.find((m) => m.id === model);

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_1fr]">
      <div>
        <div className="text-sm font-medium">{meta.name}</div>
        <div className="text-[11px] text-ink-500">{meta.hint}</div>
        {!keyConfigured && (
          <div className="mt-0.5 text-[11px] text-red-600">
            未配 {meta.envVar}
          </div>
        )}
      </div>
      <div>
        <select
          value={isPreset ? model : CUSTOM_MODEL_SENTINEL}
          onChange={(e) => {
            const v = e.target.value;
            if (v === CUSTOM_MODEL_SENTINEL) {
              // Switching from a preset to custom: blank the value so the
              // input below focuses and starts empty. If we're already in
              // custom mode the select still shows the sentinel, so this
              // branch only fires on preset → custom transitions.
              if (isPreset) onChange('');
            } else {
              onChange(v);
            }
          }}
          className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-xs outline-none focus:border-brand-500"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label} · {o.id}
            </option>
          ))}
          <option value={CUSTOM_MODEL_SENTINEL}>
            ✏️ 自定义…（手填模型 ID）
          </option>
        </select>
        {!isPreset && (
          <div className="mt-2 rounded-lg border border-brand-200 bg-brand-50/40 p-2">
            <input
              type="text"
              value={model}
              onChange={(e) => onChange(e.target.value)}
              placeholder="输入模型 ID，如 gpt-4o-mini、claude-sonnet-4"
              autoFocus={model === ''}
              className="w-full rounded-md border border-ink-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-brand-500"
            />
            <div className="mt-1.5 text-[11px] text-ink-600">
              自定义 ID 不走平台校验。改完滚到页面最底部的工具栏点
              <b className="text-brand-700">保存</b>。
            </div>
          </div>
        )}
        {incompatible && (
          <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            ⚠️ <code className="font-mono">{incompatible.id}</code> 与当前 adapter 不兼容：
            {incompatible.reason}
          </div>
        )}
        {provider === 'openai' && keyConfigured && (
          <OpenAIModelProbe currentModel={model} onPick={onChange} />
        )}
      </div>
    </div>
  );
}

/**
 * Diagnostic widget on the OpenAI row · click "查看可用模型" to hit
 * GET /api/admin/probe-openai-models which calls the configured
 * OPENAI_BASE_URL's /v1/models endpoint. Shows the catalog so the admin
 * can pick an ID that's actually activated on the gateway (KSP / Azure
 * frequently activate a SUBSET of openai.com's full list, and the
 * runtime 403 "model not activated" is the kind of error the admin
 * needs the gateway to tell them about, not a guess).
 *
 * Click a result row to copy the id straight back into the model field
 * — saves the operator from typing.
 */
function OpenAIModelProbe({
  currentModel,
  onPick,
}: {
  currentModel: string;
  onPick: (id: string) => void;
}) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | {
        kind: 'ok';
        baseURL: string;
        models: Array<{ id: string; ownedBy?: string; created?: number }>;
      }
    | { kind: 'err'; message: string; status?: number }
  >({ kind: 'idle' });

  const probe = async () => {
    setState({ kind: 'loading' });
    try {
      const r = await fetch('/api/admin/probe-openai-models');
      const body = await r.json();
      if (!body.ok) {
        setState({
          kind: 'err',
          message: body.error ?? `HTTP ${r.status}`,
          status: body.status,
        });
        return;
      }
      setState({
        kind: 'ok',
        baseURL: body.baseURL,
        models: body.models,
      });
    } catch (e: any) {
      setState({ kind: 'err', message: e?.message ?? '网络错误' });
    }
  };

  return (
    <div className="mt-2 rounded-md border border-ink-100 bg-ink-50/40 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-600">
          看 OpenAI 网关给你开通了哪些模型 ID（KSP / Azure 等代理常用）
        </span>
        <button
          type="button"
          onClick={probe}
          disabled={state.kind === 'loading'}
          className="rounded-md border border-ink-200 bg-white px-2 py-1 text-[11px] hover:border-brand-300 disabled:opacity-50"
        >
          {state.kind === 'loading' ? '探测中…' : '🔍 查看可用模型'}
        </button>
      </div>
      {state.kind === 'err' && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-800">
          <div className="font-medium">探测失败</div>
          <div className="mt-0.5 break-all font-mono text-[10px]">
            {state.status ? `[${state.status}] ` : ''}
            {state.message}
          </div>
          <div className="mt-1 text-[10px] text-red-700">
            常见原因：API key 错 / OPENAI_BASE_URL 拼错 / 网关没开通 /v1/models
            端点。检查 Vercel 函数日志看完整错误。
          </div>
        </div>
      )}
      {state.kind === 'ok' && (
        <div className="mt-2">
          <div className="text-[10px] text-ink-500">
            <code className="font-mono">{state.baseURL}</code> · 共
            {state.models.length} 个 model（最新在前）
          </div>
          <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-ink-100 bg-white">
            {state.models.length === 0 && (
              <div className="px-2 py-1.5 text-[11px] text-ink-500">
                网关没返回任何模型。
              </div>
            )}
            {state.models.map((m) => {
              const isCurrent = m.id === currentModel;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onPick(m.id)}
                  className={`flex w-full items-center justify-between border-b border-ink-100 px-2 py-1.5 text-left text-[11px] last:border-b-0 ${
                    isCurrent
                      ? 'bg-brand-50/60'
                      : 'hover:bg-ink-50'
                  }`}
                  title={m.ownedBy ? `owned by ${m.ownedBy}` : undefined}
                >
                  <code className="font-mono text-[11px] text-ink-700">{m.id}</code>
                  <span className="text-[10px] text-ink-400">
                    {isCurrent ? '✓ 当前' : '点击选用 →'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ScenarioRow({
  label,
  hint,
  locales,
}: {
  label: string;
  hint: string;
  locales: Array<{
    key: string;
    label: string;
    value: LLMProvider;
    onChange: (v: LLMProvider) => void;
  }>;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_1fr]">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-ink-500">{hint}</div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {locales.map((l) => (
          <div key={l.key} className="flex items-center gap-2">
            <span className="w-14 text-xs text-ink-500">{l.label}</span>
            <select
              value={l.value}
              onChange={(e) => l.onChange(e.target.value as LLMProvider)}
              className="flex-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs outline-none focus:border-brand-500"
            >
              {ALL_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_META[p].name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

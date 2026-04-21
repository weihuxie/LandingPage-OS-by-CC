'use client';

import { useMemo, useState } from 'react';
import type {
  LLMConfig,
  LLMProvider,
  LLMScenario,
} from '@/lib/llm-config';

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
        'R1 不支持 tool_choice，当前 adapter 依赖 tool_choice 做结构化输出。' +
        '选它后调用会被自动回退到 deepseek-chat（server 日志会 warn）。',
    },
  ],
};

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
              defaultModel={defaults.providers[p].model}
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

      {/* Action bar */}
      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white p-3 shadow-lg">
        <div className="flex items-center gap-3 text-xs">
          {savedAt && !dirty && (
            <span className="text-emerald-700">
              已保存 · {new Date(savedAt).toLocaleTimeString()}
            </span>
          )}
          {dirty && <span className="text-amber-700">有未保存的改动</span>}
          {error && <span className="text-red-700">{error}</span>}
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
  defaultModel,
}: {
  provider: LLMProvider;
  model: string;
  options: ModelOption[];
  keyConfigured: boolean;
  onChange: (m: string) => void;
  defaultModel: string;
}) {
  const meta = PROVIDER_META[provider];
  // "Custom" mode kicks in when the current value isn't in the preset list
  // — presumably the admin typed a new model ID by hand. The input stays
  // visible so they can edit it without losing the value.
  const isPreset = options.some((o) => o.id === model);
  const [customMode, setCustomMode] = useState(!isPreset);
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
        {customMode ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={model}
              onChange={(e) => onChange(e.target.value)}
              placeholder="模型 ID（自定义）"
              className="flex-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs outline-none focus:border-brand-500"
            />
            <button
              type="button"
              onClick={() => {
                setCustomMode(false);
                onChange(options[0]?.id ?? defaultModel);
              }}
              className="btn btn-secondary px-2 py-1 text-xs"
            >
              返回下拉
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <select
              value={model}
              onChange={(e) => onChange(e.target.value)}
              className="flex-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs outline-none focus:border-brand-500"
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} · {o.id}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setCustomMode(true)}
              className="btn btn-secondary px-2 py-1 text-xs"
            >
              自定义
            </button>
          </div>
        )}
        {incompatible && (
          <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            ⚠️ <code className="font-mono">{incompatible.id}</code> 与当前 adapter 不兼容：
            {incompatible.reason}
          </div>
        )}
      </div>
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

'use client';

/**
 * Admin LLM config form · v2 schema.
 *
 * One card per scenario. Each card contains its own:
 *   - 启用开关
 *   - 触发条件 checkboxes
 *   - 调用链 (chain[0]=primary, chain[1+]=fallback ladder)
 *     · provider + model dropdown
 *     · move up/down/remove
 *     · add new step
 *   - For localize: per-step `mode` (normal / skip-polish)
 *
 * Reading one card tells you exactly what happens for that scenario,
 * end to end. No more triangulating across "which model" + "which
 * provider per scenario" + "global fallback chain".
 */

import { useMemo, useState } from 'react';
import type {
  LLMConfig,
  LLMProvider,
  ScenarioPolicy,
  ScenarioStep,
  TriggerClass,
} from '@/lib/llm-config';

type ModelOption = { id: string; label: string };
type ProviderStatus = Record<LLMProvider, boolean>;

interface Props {
  initialConfig: LLMConfig;
  defaults: LLMConfig;
  modelOptions: Record<LLMProvider, ModelOption[]>;
  providerStatus: ProviderStatus;
}

const PROVIDER_META: Record<
  LLMProvider,
  { name: string; envVar: string; hint: string }
> = {
  claude: {
    name: 'Claude (Anthropic)',
    envVar: 'ANTHROPIC_API_KEY',
    hint: '高质量结构化文案 · JP locale 首选',
  },
  deepseek: {
    name: 'DeepSeek',
    envVar: 'DEEPSEEK_API_KEY',
    hint: '成本最低（~1/30 Claude）',
  },
  openai: {
    name: 'GPT-4o (OpenAI)',
    envVar: 'OPENAI_API_KEY',
    hint: '本地化 / 多语言 polish',
  },
  gemini: {
    name: 'Gemini (Google)',
    envVar: 'GOOGLE_API_KEY',
    hint: '长文档抽取',
  },
};

const ALL_PROVIDERS: LLMProvider[] = ['claude', 'deepseek', 'openai', 'gemini'];
const ALL_TRIGGERS: TriggerClass[] = ['429-quota', '429-rate', '5xx'];
const TRIGGER_LABEL: Record<TriggerClass, string> = {
  '429-quota': '429 · 配额/账单用完（sticky，换家才有意义）',
  '429-rate': '429 · 短时 rate limit（一会儿恢复）',
  '5xx': '5xx · 服务端抖动 / 网关超时',
};

const CUSTOM_MODEL_SENTINEL = '__custom__';

export default function AdminLLMForm({
  initialConfig,
  defaults,
  modelOptions,
  providerStatus,
}: Props) {
  const [config, setConfig] = useState<LLMConfig>(initialConfig);
  const [baseline, setBaseline] = useState<LLMConfig>(initialConfig);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(baseline),
    [config, baseline],
  );

  function updatePolicy(
    path: ['strategy', 'ja' | 'default'] | ['copy', 'ja' | 'default'] | ['localize'] | ['extract'],
    next: ScenarioPolicy,
  ): void {
    setConfig((prev) => {
      const cp: LLMConfig = JSON.parse(JSON.stringify(prev));
      if (path[0] === 'strategy' || path[0] === 'copy') {
        // Locale-keyed
        (cp.scenarios[path[0]] as any)[path[1]] = next;
      } else {
        (cp.scenarios as any)[path[0]] = next;
      }
      return cp;
    });
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/llm-config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body?.message ?? `HTTP ${r.status}`);
        return;
      }
      setBaseline(JSON.parse(JSON.stringify(config)));
      setSavedAt(Date.now());
    } catch (e: any) {
      setError(e?.message ?? '保存失败');
    } finally {
      setBusy(false);
    }
  }

  function reset(): void {
    setConfig(JSON.parse(JSON.stringify(defaults)));
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Provider key status strip — same across all scenarios so kept up top */}
      <section className="card p-5">
        <h2 className="text-base font-semibold">当前 API Key 状态</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {ALL_PROVIDERS.map((p) => {
            const ok = providerStatus[p];
            return (
              <span
                key={p}
                className={`rounded-full border px-3 py-1 text-xs ${
                  ok
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-red-300 bg-red-50 text-red-800'
                }`}
                title={ok ? PROVIDER_META[p].envVar + ' 已配置' : '未配 ' + PROVIDER_META[p].envVar}
              >
                {ok ? '🟢' : '🔴'} {PROVIDER_META[p].name}
              </span>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-ink-500">
          未配 key 的 provider 在调用链里会被自动跳过；不会拖累其他场景。
        </p>
      </section>

      {/* Strategy — locale-aware */}
      <ScenarioCard
        title="策略生成"
        hint="生成 4 段式 strategy summary。JP locale 走一条链，其他走另一条。"
        modelOptions={modelOptions}
        providerStatus={providerStatus}
        showModeToggle={false}
      >
        <LocalePolicyPair
          ja={config.scenarios.strategy.ja}
          def={config.scenarios.strategy.default}
          onJa={(p) => updatePolicy(['strategy', 'ja'], p)}
          onDef={(p) => updatePolicy(['strategy', 'default'], p)}
          modelOptions={modelOptions}
          providerStatus={providerStatus}
          showModeToggle={false}
        />
      </ScenarioCard>

      {/* Copy — locale-aware */}
      <ScenarioCard
        title="模块文案"
        hint="重写 hero / pain / benefits / solution / cta 模块。JP/其他 分开配置。"
        modelOptions={modelOptions}
        providerStatus={providerStatus}
        showModeToggle={false}
      >
        <LocalePolicyPair
          ja={config.scenarios.copy.ja}
          def={config.scenarios.copy.default}
          onJa={(p) => updatePolicy(['copy', 'ja'], p)}
          onDef={(p) => updatePolicy(['copy', 'default'], p)}
          modelOptions={modelOptions}
          providerStatus={providerStatus}
          showModeToggle={false}
        />
      </ScenarioCard>

      {/* Localize — single chain with mode (skip-polish) */}
      <ScenarioCard
        title="本地化 pass"
        hint="加新语言时把现有内容按目标 locale 重写。OpenAI 是唯一有真正 polish adapter 的；其他 provider 选 skip-polish 模式后跳过 polish 用 Claude hydrate 母语版。"
        modelOptions={modelOptions}
        providerStatus={providerStatus}
        showModeToggle={true}
      >
        <PolicyEditor
          policy={config.scenarios.localize}
          onChange={(p) => updatePolicy(['localize'], p)}
          modelOptions={modelOptions}
          providerStatus={providerStatus}
          showModeToggle={true}
        />
      </ScenarioCard>

      {/* Extract — single chain, single adapter, no real fallback */}
      <ScenarioCard
        title="长文档抽取"
        hint="白皮书 / 手册 → ExtractedContext。当前只有 Gemini 有 adapter，链里加其他 provider 会被跳过。"
        modelOptions={modelOptions}
        providerStatus={providerStatus}
        showModeToggle={false}
      >
        <PolicyEditor
          policy={config.scenarios.extract}
          onChange={(p) => updatePolicy(['extract'], p)}
          modelOptions={modelOptions}
          providerStatus={providerStatus}
          showModeToggle={false}
        />
      </ScenarioCard>

      {/* Action bar — sticks to bottom while form is dirty */}
      <div className="sticky bottom-4 z-10 mt-6 flex items-center justify-between rounded-xl border bg-white px-4 py-3 shadow-soft">
        <div className="text-xs">
          {error ? (
            <span className="rounded-md bg-red-50 px-2 py-1 text-red-800">
              ✗ {error}
            </span>
          ) : dirty ? (
            <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-800">
              ● 未保存
            </span>
          ) : savedAt ? (
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-800">
              ✓ 已保存 ·{' '}
              {new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false })}
            </span>
          ) : (
            <span className="rounded-md bg-ink-100/60 px-2 py-1 text-ink-600">
              · 无改动（与服务器一致）
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="btn btn-secondary text-xs"
            title="加载内置默认值（覆盖当前表单 — 不会自动保存）"
          >
            重置为默认
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="btn btn-primary text-xs disabled:opacity-50"
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- ScenarioCard wrapper -------------------------------------

function ScenarioCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  modelOptions: Record<LLMProvider, ModelOption[]>;
  providerStatus: ProviderStatus;
  showModeToggle: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="card mt-4 p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-ink-500">{hint}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

// ---------- Locale-pair editor (strategy / copy) ---------------------

function LocalePolicyPair({
  ja,
  def,
  onJa,
  onDef,
  modelOptions,
  providerStatus,
  showModeToggle,
}: {
  ja: ScenarioPolicy;
  def: ScenarioPolicy;
  onJa: (p: ScenarioPolicy) => void;
  onDef: (p: ScenarioPolicy) => void;
  modelOptions: Record<LLMProvider, ModelOption[]>;
  providerStatus: ProviderStatus;
  showModeToggle: boolean;
}): JSX.Element {
  const [tab, setTab] = useState<'ja' | 'default'>('default');
  const policy = tab === 'ja' ? ja : def;
  const onChange = tab === 'ja' ? onJa : onDef;
  return (
    <div>
      <div className="flex gap-1 rounded-lg border border-ink-100 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setTab('default')}
          className={`flex-1 rounded-md px-2 py-1 transition ${
            tab === 'default'
              ? 'bg-brand-600 text-white'
              : 'text-ink-500 hover:text-ink-900'
          }`}
        >
          其他 locale
        </button>
        <button
          type="button"
          onClick={() => setTab('ja')}
          className={`flex-1 rounded-md px-2 py-1 transition ${
            tab === 'ja' ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-900'
          }`}
        >
          JP（日文）
        </button>
      </div>
      <div className="mt-3">
        <PolicyEditor
          policy={policy}
          onChange={onChange}
          modelOptions={modelOptions}
          providerStatus={providerStatus}
          showModeToggle={showModeToggle}
        />
      </div>
    </div>
  );
}

// ---------- ScenarioPolicy editor ------------------------------------

function PolicyEditor({
  policy,
  onChange,
  modelOptions,
  providerStatus,
  showModeToggle,
}: {
  policy: ScenarioPolicy;
  onChange: (next: ScenarioPolicy) => void;
  modelOptions: Record<LLMProvider, ModelOption[]>;
  providerStatus: ProviderStatus;
  showModeToggle: boolean;
}): JSX.Element {
  function toggleEnabled(): void {
    onChange({ ...policy, enabled: !policy.enabled });
  }

  function setTrigger(t: TriggerClass, on: boolean): void {
    const ts = on
      ? Array.from(new Set([...policy.triggers, t]))
      : policy.triggers.filter((x) => x !== t);
    onChange({ ...policy, triggers: ts });
  }

  function updateStep(idx: number, step: ScenarioStep): void {
    const chain = policy.chain.map((s, i) => (i === idx ? step : s));
    onChange({ ...policy, chain });
  }

  function moveStep(idx: number, dir: -1 | 1): void {
    const j = idx + dir;
    if (j < 0 || j >= policy.chain.length) return;
    const chain = policy.chain.slice();
    [chain[idx], chain[j]] = [chain[j], chain[idx]];
    onChange({ ...policy, chain });
  }

  function removeStep(idx: number): void {
    if (policy.chain.length <= 1) return; // primary required
    const chain = policy.chain.filter((_, i) => i !== idx);
    onChange({ ...policy, chain });
  }

  function addStep(): void {
    // Default new step: first provider not already in chain, with its
    // first model option. Fall back to claude/default model if all 4
    // providers already on chain.
    const used = new Set(policy.chain.map((s) => s.provider));
    const next = (ALL_PROVIDERS.find((p) => !used.has(p)) ?? 'claude') as LLMProvider;
    const model = modelOptions[next]?.[0]?.id ?? 'claude-opus-4-20250514';
    onChange({ ...policy, chain: [...policy.chain, { provider: next, model }] });
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={policy.enabled}
          onChange={toggleEnabled}
        />
        <span>启用此场景</span>
        {!policy.enabled && (
          <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">
            已停用 — 调用会返回 503
          </span>
        )}
      </label>

      <div>
        <div className="text-xs font-medium">触发条件（命中才换链下一步）</div>
        <div className="mt-1 space-y-1">
          {ALL_TRIGGERS.map((t) => (
            <label key={t} className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={policy.triggers.includes(t)}
                onChange={(e) => setTrigger(t, e.target.checked)}
                className="mt-0.5"
              />
              <span>{TRIGGER_LABEL[t]}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-medium">调用链（首项 = 主选；后续按顺序回退）</div>
        <div className="mt-1 space-y-1">
          {policy.chain.map((step, i) => (
            <StepRow
              key={i}
              idx={i}
              total={policy.chain.length}
              step={step}
              modelOptions={modelOptions}
              providerStatus={providerStatus}
              showModeToggle={showModeToggle}
              onChange={(s) => updateStep(i, s)}
              onMove={(d) => moveStep(i, d)}
              onRemove={() => removeStep(i)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={addStep}
          className="mt-2 rounded-md border border-dashed border-ink-300 bg-white px-3 py-1.5 text-xs text-ink-600 hover:border-brand-400 hover:text-brand-700"
        >
          + 加一步回退
        </button>
      </div>
    </div>
  );
}

// ---------- One step in the chain ------------------------------------

function StepRow({
  idx,
  total,
  step,
  modelOptions,
  providerStatus,
  showModeToggle,
  onChange,
  onMove,
  onRemove,
}: {
  idx: number;
  total: number;
  step: ScenarioStep;
  modelOptions: Record<LLMProvider, ModelOption[]>;
  providerStatus: ProviderStatus;
  showModeToggle: boolean;
  onChange: (s: ScenarioStep) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}): JSX.Element {
  const opts = modelOptions[step.provider] ?? [];
  const isPreset = opts.some((o) => o.id === step.model);
  const isPrimary = idx === 0;
  const keyMissing = !providerStatus[step.provider] && step.mode !== 'skip-polish';

  return (
    <div
      className={`rounded-lg border p-2 ${
        isPrimary ? 'border-brand-300 bg-brand-50/30' : 'border-ink-100'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium ${
            isPrimary ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-700'
          }`}
        >
          {idx + 1}
        </span>
        <span className="text-[11px] font-medium">
          {isPrimary ? '主选' : `回退 ${idx}`}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={idx === 0}
          className="rounded p-1 text-ink-400 hover:bg-ink-100 disabled:opacity-30"
          aria-label="上移"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={idx === total - 1}
          className="rounded p-1 text-ink-400 hover:bg-ink-100 disabled:opacity-30"
          aria-label="下移"
        >
          ↓
        </button>
        {total > 1 && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1 text-red-500 hover:bg-red-50"
            aria-label="删除该步"
            title={isPrimary ? '删除会让 chain[0] 提升为新主选' : undefined}
          >
            ✕
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr]">
        <select
          value={step.provider}
          onChange={(e) =>
            onChange({
              ...step,
              provider: e.target.value as LLMProvider,
              // Reset model to the first preset for the new provider
              model:
                modelOptions[e.target.value as LLMProvider]?.[0]?.id ?? step.model,
            })
          }
          className="rounded-lg border border-ink-200 px-2 py-1 text-xs"
        >
          {ALL_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_META[p].name}
            </option>
          ))}
        </select>
        <select
          value={isPreset ? step.model : CUSTOM_MODEL_SENTINEL}
          onChange={(e) => {
            const v = e.target.value;
            if (v === CUSTOM_MODEL_SENTINEL) {
              if (isPreset) onChange({ ...step, model: '' });
            } else {
              onChange({ ...step, model: v });
            }
          }}
          className="rounded-lg border border-ink-200 px-2 py-1 text-xs"
        >
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label} · {o.id}
            </option>
          ))}
          <option value={CUSTOM_MODEL_SENTINEL}>✏️ 自定义…</option>
        </select>
      </div>
      {!isPreset && (
        <input
          type="text"
          value={step.model}
          onChange={(e) => onChange({ ...step, model: e.target.value })}
          placeholder="输入模型 ID"
          autoFocus={step.model === ''}
          className="mt-2 w-full rounded-md border border-brand-200 bg-white px-2 py-1 text-xs"
        />
      )}
      {showModeToggle && (
        <label className="mt-2 flex items-center gap-2 text-[11px] text-ink-700">
          <input
            type="checkbox"
            checked={step.mode === 'skip-polish'}
            onChange={(e) =>
              onChange({ ...step, mode: e.target.checked ? 'skip-polish' : 'normal' })
            }
          />
          <span>
            skip-polish 模式
            <span className="ml-1 text-[10px] text-ink-500">
              （不调 LLM，直接用上游 hydrate 母语版）
            </span>
          </span>
        </label>
      )}
      {keyMissing && (
        <div className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
          ⚠️ 未配 {PROVIDER_META[step.provider].envVar} — 该步会被运行时跳过
        </div>
      )}
    </div>
  );
}

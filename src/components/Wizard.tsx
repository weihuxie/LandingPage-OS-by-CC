'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

// --- localStorage auto-save (zero-button draft persistence) -----------
const DRAFT_KEY = 'lp-wizard-draft';

interface WizardDraft {
  step: number;
  inputs: any;
  strategy: any;
  brandProbe: any;
  fileContexts: any[];
  savedAt: number;
}

function loadDraft(): WizardDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as WizardDraft;
    // expire after 24 hours
    if (Date.now() - d.savedAt > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

function saveDraft(draft: WizardDraft) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {}
}

function clearDraft() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(DRAFT_KEY);
}
import type {
  ProductInputs,
  StrategySummary,
  CTAGoal,
  LocaleCode,
  MarketCode,
  TrafficSource,
} from '@/lib/types';

const MARKETS: MarketCode[] = ['CN', 'TW', 'JP', 'US', 'EU', 'GLOBAL'];
const LOCALES: LocaleCode[] = ['zh-CN', 'zh-TW', 'ja', 'en'];
const CTAS: CTAGoal[] = ['demo', 'trial', 'download', 'contact', 'quote'];
const SOURCES: TrafficSource[] = ['ads', 'seo', 'sales', 'event', 'referral', 'social'];

type Props = { locale: string };

const defaultInputs = (locale: string): ProductInputs => ({
  name: '',
  tagline: '',
  category: '',
  value: '',
  cta: 'demo',
  market: locale === 'ja' ? 'JP' : locale === 'en' ? 'US' : locale === 'zh-TW' ? 'TW' : 'CN',
  locale: (LOCALES.includes(locale as LocaleCode) ? locale : 'en') as LocaleCode,
  industry: '',
  companySize: '',
  role: '',
  source: 'ads',
  pastedContent: '',
  referenceUrls: [],
  uploadedFileNames: [],
});

export default function Wizard({ locale }: Props) {
  const t = useTranslations();
  const router = useRouter();

  // Restore draft from localStorage if available
  const draft = useMemo(() => loadDraft(), []);
  const [step, setStep] = useState(draft?.step ?? 0);
  const [inputs, setInputs] = useState<ProductInputs>(draft?.inputs ?? defaultInputs(locale));
  const [refUrl, setRefUrl] = useState('');
  const [strategy, setStrategy] = useState<StrategySummary | null>(draft?.strategy ?? null);
  const [extractedContext, setExtractedContext] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [brandProbe, setBrandProbe] = useState<{
    primary?: string;
    candidates: string[];
    source: string;
    siteTitle?: string;
  } | null>(draft?.brandProbe ?? null);
  const [brandProbing, setBrandProbing] = useState(false);
  const [hasDraft] = useState(!!draft);
  const [fileContexts, setFileContexts] = useState<any[]>(draft?.fileContexts ?? []);
  const [fileExtracting, setFileExtracting] = useState(0);
  const totalSteps = 4;

  // Auto-save draft on any meaningful state change
  const persistDraft = useCallback(() => {
    saveDraft({ step, inputs, strategy, brandProbe, fileContexts: fileContexts ?? [], savedAt: Date.now() });
  }, [step, inputs, strategy, brandProbe]);
  useEffect(() => { persistDraft(); }, [persistDraft]);

  const set = (patch: Partial<ProductInputs>) => setInputs((s) => ({ ...s, ...patch }));

  const canNext = useMemo(() => {
    if (step === 0) return inputs.name.trim() && inputs.tagline.trim();
    if (step === 1) return inputs.locale && inputs.market;
    return true;
  }, [step, inputs]);

  const goNext = async () => {
    if (step === 2) {
      setLoading(true);
      const res = await fetch('/api/strategy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputs, fileContexts }),
      });
      const data = await res.json();
      setStrategy(data.strategy);
      setExtractedContext(data.context ?? null);
      setLoading(false);
    }
    setStep((s) => Math.min(totalSteps - 1, s + 1));
  };

  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const addUrl = async () => {
    const u = refUrl.trim();
    if (!u) return;
    set({ referenceUrls: [...inputs.referenceUrls, u] });
    setRefUrl('');
    // Probe brand color from the first URL (PRD §5)
    if (!brandProbe) {
      setBrandProbing(true);
      try {
        const res = await fetch('/api/brand/extract', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: u }),
        });
        const data = await res.json();
        setBrandProbe(data);
      } finally {
        setBrandProbing(false);
      }
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    const names = arr.map((f) => f.name);
    set({ uploadedFileNames: [...inputs.uploadedFileNames, ...names] });

    // Upload each file for extraction; accumulate contexts
    setFileExtracting((n) => n + arr.length);
    const extracted: any[] = [];
    for (const file of arr) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/extract-file', { method: 'POST', body: fd });
        const data = await res.json();
        if (data?.context) {
          extracted.push({ ...data.context, __fileName: file.name });
        }
      } catch {
        // swallow — user sees file listed but no facts contributed
      } finally {
        setFileExtracting((n) => n - 1);
      }
    }
    setFileContexts((prev) => [...prev, ...extracted]);
  };

  const [progress, setProgress] = useState<{
    steps: Array<{ key: string; label: string; done: boolean }>;
  } | null>(null);

  // Scoped strategy regeneration (client helper — calls /api/strategy and picks one block/line)
  const regenerateStrategyBlock = async (
    block: 'audience' | 'goal' | 'narrative' | 'local',
  ): Promise<string[] | null> => {
    const res = await fetch('/api/strategy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.strategy?.[block] ?? null;
  };

  const regenerateStrategyLine = async (
    block: 'audience' | 'goal' | 'narrative' | 'local',
    index: number,
  ): Promise<string | null> => {
    const fresh = await regenerateStrategyBlock(block);
    return fresh?.[index] ?? null;
  };

  const finish = async () => {
    // Include the file contexts alongside paste/URL when finalizing — the
    // server merges everything and grounds both strategy and modules.
    // (Currently server-side re-extracts paste+URL; file contexts are passed
    // from client because they were already extracted via /api/extract-file.)
    // Optimistic progress UI (Phase 3).
    // We show a 4-step checklist, tick each step on a small timer while
    // the real POST runs in parallel. Feels responsive even though the
    // server-side generation is deterministic and near-instant.
    const steps = [
      { key: 'strategy', label: '整合策略输入', done: false },
      { key: 'copy', label: '生成 Hero 与文案', done: false },
      { key: 'variants', label: '产出 A/B 双方案', done: false },
      { key: 'publish', label: '准备进入编辑器', done: false },
    ];
    setProgress({ steps });
    setLoading(true);

    // Tick ticker in background
    const tickTimers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((_, i) => {
      tickTimers.push(
        setTimeout(() => {
          setProgress((p) => {
            if (!p) return p;
            const copy = p.steps.map((s, j) => (j === i ? { ...s, done: true } : s));
            return { steps: copy };
          });
        }, 400 * (i + 1)),
      );
    });

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputs,
          strategy,
          referenceUrl: inputs.referenceUrls[0],
          primary: brandProbe?.primary,
          fileContexts, // file-extracted facts to ground generation
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (!data?.id) throw new Error('no-id');
      // Success! Clear draft — we're done.
      clearDraft();
      // Make sure all ticks show complete before navigation
      await new Promise((r) => setTimeout(r, 1700));
      router.push(`/${locale}/projects/${data.id}`);
    } catch (e: any) {
      tickTimers.forEach(clearTimeout);
      setLoading(false);
      setProgress(null);
      alert(`生成失败：${e?.message ?? 'unknown'}。请重试，或检查网络。`);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('wizard.title')}</h1>
          {hasDraft && step > 0 && (
            <div className="mt-1 flex items-center gap-2 text-xs text-brand-700">
              <span>📋 已从上次中断处恢复</span>
              <button
                className="text-ink-500 hover:text-red-600 underline"
                onClick={() => {
                  if (!confirm('重新开始？会丢弃当前填写的所有内容。')) return;
                  clearDraft();
                  window.location.reload();
                }}
              >
                重新开始
              </button>
            </div>
          )}
        </div>
        <div className="text-sm text-ink-500">
          {t('wizard.step', { current: step + 1, total: totalSteps })}
        </div>
      </div>

      <div className="mb-6 flex gap-1.5">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i <= step ? 'bg-brand-600' : 'bg-ink-100'
            }`}
          />
        ))}
      </div>

      <div className="card p-6 sm:p-8">
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t('wizard.step1.title')}</h2>
            <div>
              <label className="label">{t('wizard.step1.name')}</label>
              <input
                className="input mt-1.5"
                placeholder={t('wizard.step1.namePh')}
                value={inputs.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t('wizard.step1.tagline')}</label>
              <input
                className="input mt-1.5"
                placeholder={t('wizard.step1.taglinePh')}
                value={inputs.tagline}
                onChange={(e) => set({ tagline: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">{t('wizard.step1.category')}</label>
                <input
                  className="input mt-1.5"
                  value={inputs.category}
                  onChange={(e) => set({ category: e.target.value })}
                />
              </div>
              <div>
                <label className="label">{t('wizard.step1.cta')}</label>
                <select
                  className="input mt-1.5"
                  value={inputs.cta}
                  onChange={(e) => set({ cta: e.target.value as CTAGoal })}
                >
                  {CTAS.map((c) => (
                    <option key={c} value={c}>
                      {t(`wizard.step1.ctaOptions.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label">{t('wizard.step1.value')}</label>
              <textarea
                className="input mt-1.5 min-h-[96px]"
                placeholder={t('wizard.step1.valuePh')}
                value={inputs.value}
                onChange={(e) => set({ value: e.target.value })}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t('wizard.step2.title')}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">{t('wizard.step2.market')}</label>
                <select
                  className="input mt-1.5"
                  value={inputs.market}
                  onChange={(e) => set({ market: e.target.value as MarketCode })}
                >
                  {MARKETS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('wizard.step2.language')}</label>
                <select
                  className="input mt-1.5"
                  value={inputs.locale}
                  onChange={(e) => set({ locale: e.target.value as LocaleCode })}
                >
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('wizard.step2.industry')}</label>
                <input
                  className="input mt-1.5"
                  value={inputs.industry}
                  onChange={(e) => set({ industry: e.target.value })}
                />
              </div>
              <div>
                <label className="label">{t('wizard.step2.size')}</label>
                <input
                  className="input mt-1.5"
                  value={inputs.companySize}
                  onChange={(e) => set({ companySize: e.target.value })}
                />
              </div>
              <div>
                <label className="label">{t('wizard.step2.role')}</label>
                <input
                  className="input mt-1.5"
                  value={inputs.role}
                  onChange={(e) => set({ role: e.target.value })}
                />
              </div>
              <div>
                <label className="label">{t('wizard.step2.source')}</label>
                <select
                  className="input mt-1.5"
                  value={inputs.source}
                  onChange={(e) => set({ source: e.target.value as TrafficSource })}
                >
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {t(`wizard.step2.sourceOptions.${s}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t('wizard.step3.title')}</h2>
            <p className="text-sm text-ink-500">{t('wizard.step3.desc')}</p>
            <div>
              <label className="label">{t('wizard.step3.paste')}</label>
              <textarea
                className="input mt-1.5 min-h-[140px]"
                placeholder={t('wizard.step3.pastePh')}
                value={inputs.pastedContent}
                onChange={(e) => set({ pastedContent: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t('wizard.step3.url')}</label>
              <div className="mt-1.5 flex gap-2">
                <input
                  className="input"
                  placeholder={t('wizard.step3.urlPh')}
                  value={refUrl}
                  onChange={(e) => setRefUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addUrl();
                    }
                  }}
                />
                <button className="btn btn-secondary" onClick={addUrl} type="button">
                  +
                </button>
              </div>
              {inputs.referenceUrls.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {inputs.referenceUrls.map((u, i) => (
                    <li key={i} className="pill">
                      {u}
                      <button
                        className="ml-1 text-ink-500 hover:text-ink-900"
                        onClick={() =>
                          set({
                            referenceUrls: inputs.referenceUrls.filter((_, j) => j !== i),
                          })
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {brandProbing && (
                <div className="mt-2 text-xs text-ink-500">正在从 URL 提取品牌色…</div>
              )}
              {brandProbe && brandProbe.primary && (
                <div className="mt-3 rounded-xl border border-ink-100 bg-ink-100/40 p-3">
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span>从 URL 提取到品牌色（来源: {brandProbe.source}）</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {brandProbe.candidates.slice(0, 6).map((c) => (
                      <button
                        key={c}
                        onClick={() => setBrandProbe({ ...brandProbe, primary: c })}
                        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
                          brandProbe.primary === c
                            ? 'border-brand-300 bg-brand-50 text-brand-700'
                            : 'border-ink-100 bg-white'
                        }`}
                      >
                        <span
                          className="inline-block h-3 w-3 rounded"
                          style={{ background: c }}
                        />
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="label">{t('wizard.step3.file')}</label>
              <div className="mt-1.5 rounded-xl border border-dashed border-ink-100 bg-ink-100/30 p-4 text-center text-sm text-ink-500">
                <input
                  id="upload"
                  type="file"
                  className="hidden"
                  multiple
                  onChange={(e) => onFiles(e.target.files)}
                />
                <label htmlFor="upload" className="cursor-pointer text-brand-700 hover:underline">
                  {t('wizard.step3.file')}
                </label>
                <span className="ml-1 text-ink-500">— {t('wizard.step3.fileHint')}</span>
              </div>
              {(fileExtracting > 0 || inputs.uploadedFileNames.length > 0) && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {inputs.uploadedFileNames.map((n, i) => {
                    const ctx = fileContexts.find((c) => c.__fileName === n);
                    const facts = ctx
                      ? (ctx.namedCustomers?.length ?? 0) +
                        (ctx.metrics?.length ?? 0) +
                        (ctx.features?.length ?? 0) +
                        (ctx.pains?.length ?? 0)
                      : 0;
                    return (
                      <li
                        key={i}
                        className={`pill ${ctx ? 'border-brand-200 bg-brand-50 text-brand-700' : ''}`}
                        title={ctx ? `读到 ${facts} 条事实,共 ${ctx.textLength} 字` : '解析中或未识别'}
                      >
                        📎 {n}
                        {ctx && facts > 0 && (
                          <span className="ml-1 text-[10px]">· {facts} 条事实</span>
                        )}
                      </li>
                    );
                  })}
                  {fileExtracting > 0 && (
                    <li className="pill text-ink-500">
                      ⏳ 解析中 ({fileExtracting})
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">{t('wizard.step4.title')}</h2>
              <p className="text-sm text-ink-500">{t('wizard.step4.desc')}</p>
            </div>
            {extractedContext && extractedContext.textLength > 0 && (
              <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-brand-700">
                  <span>📎 AI 从你的素材里读到了：</span>
                  <span className="text-ink-500">
                    共 {extractedContext.textLength} 字 · 来源{' '}
                    {extractedContext.sourceKinds.join(' + ')}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  {extractedContext.namedCustomers?.length > 0 && (
                    <FactsRow
                      label="客户名"
                      items={extractedContext.namedCustomers}
                    />
                  )}
                  {extractedContext.metrics?.length > 0 && (
                    <FactsRow label="量化数字" items={extractedContext.metrics} />
                  )}
                  {extractedContext.features?.length > 0 && (
                    <FactsRow label="功能点" items={extractedContext.features} />
                  )}
                  {extractedContext.personas?.length > 0 && (
                    <FactsRow label="角色" items={extractedContext.personas} />
                  )}
                  {extractedContext.pains?.length > 0 && (
                    <FactsRow
                      label="痛点原话"
                      items={extractedContext.pains.slice(0, 2)}
                    />
                  )}
                </div>
                <div className="mt-2 text-[11px] text-ink-500">
                  下面的策略已用这些事实做了 grounding — 「客户名」
                  会替换 Logo 墙，「量化数字」会进统计区，「痛点原话」会直接出现在痛点模块。
                </div>
              </div>
            )}
            {progress && (
              <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
                <div className="mb-2 text-sm font-medium text-brand-700">正在生成…</div>
                <ul className="space-y-1.5 text-sm">
                  {progress.steps.map((s) => (
                    <li key={s.key} className="flex items-center gap-2">
                      <span
                        className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${
                          s.done ? 'bg-brand-600 text-white' : 'border border-brand-300 bg-white text-brand-300'
                        }`}
                      >
                        {s.done ? '✓' : '·'}
                      </span>
                      <span className={s.done ? 'text-ink-900' : 'text-ink-500'}>{s.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {loading && !progress && <div className="text-sm text-ink-500">…</div>}
            {strategy && !progress && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <StrategyCard
                    title={t('wizard.step4.audience')}
                    block="audience"
                    lines={strategy.audience}
                    onEditLine={(i, v) =>
                      setStrategy({ ...strategy, audience: strategy.audience.map((l, j) => (j === i ? v : l)) })
                    }
                    onRegenLine={async (i) => {
                      const fresh = await regenerateStrategyLine('audience', i);
                      if (fresh) setStrategy({ ...strategy, audience: strategy.audience.map((l, j) => (j === i ? fresh : l)) });
                    }}
                    onRegenBlock={async () => {
                      const fresh = await regenerateStrategyBlock('audience');
                      if (fresh) setStrategy({ ...strategy, audience: fresh });
                    }}
                  />
                  <StrategyCard
                    title={t('wizard.step4.goal')}
                    block="goal"
                    lines={strategy.goal}
                    onEditLine={(i, v) =>
                      setStrategy({ ...strategy, goal: strategy.goal.map((l, j) => (j === i ? v : l)) })
                    }
                    onRegenLine={async (i) => {
                      const fresh = await regenerateStrategyLine('goal', i);
                      if (fresh) setStrategy({ ...strategy, goal: strategy.goal.map((l, j) => (j === i ? fresh : l)) });
                    }}
                    onRegenBlock={async () => {
                      const fresh = await regenerateStrategyBlock('goal');
                      if (fresh) setStrategy({ ...strategy, goal: fresh });
                    }}
                  />
                  <StrategyCard
                    title={t('wizard.step4.narrative')}
                    block="narrative"
                    lines={strategy.narrative}
                    onEditLine={(i, v) =>
                      setStrategy({ ...strategy, narrative: strategy.narrative.map((l, j) => (j === i ? v : l)) })
                    }
                    onRegenLine={async (i) => {
                      const fresh = await regenerateStrategyLine('narrative', i);
                      if (fresh) setStrategy({ ...strategy, narrative: strategy.narrative.map((l, j) => (j === i ? fresh : l)) });
                    }}
                    onRegenBlock={async () => {
                      const fresh = await regenerateStrategyBlock('narrative');
                      if (fresh) setStrategy({ ...strategy, narrative: fresh });
                    }}
                  />
                  <StrategyCard
                    title={t('wizard.step4.local')}
                    block="local"
                    lines={strategy.local}
                    onEditLine={(i, v) =>
                      setStrategy({ ...strategy, local: strategy.local.map((l, j) => (j === i ? v : l)) })
                    }
                    onRegenLine={async (i) => {
                      const fresh = await regenerateStrategyLine('local', i);
                      if (fresh) setStrategy({ ...strategy, local: strategy.local.map((l, j) => (j === i ? fresh : l)) });
                    }}
                    onRegenBlock={async () => {
                      const fresh = await regenerateStrategyBlock('local');
                      if (fresh) setStrategy({ ...strategy, local: fresh });
                    }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="btn btn-secondary"
                    onClick={async () => {
                      if (!confirm('重新生成整份策略会丢弃你所有的手改。继续？')) return;
                      setLoading(true);
                      const res = await fetch('/api/strategy', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ inputs }),
                      });
                      const data = await res.json();
                      setStrategy(data.strategy);
                      setLoading(false);
                    }}
                  >
                    ↻ {t('wizard.step4.regenerate')}（全部）
                  </button>
                  <span className="text-xs text-ink-500">
                    点击任一条可行内编辑；hover 出现单条 ↻ 重新生成
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          className="btn btn-secondary disabled:opacity-40"
          onClick={goBack}
          disabled={step === 0}
        >
          ← {t('wizard.back')}
        </button>
        {step < totalSteps - 1 ? (
          <button
            className="btn btn-primary disabled:opacity-40"
            onClick={goNext}
            disabled={!canNext || loading}
          >
            {t('wizard.next')} →
          </button>
        ) : (
          <button
            className="btn btn-primary disabled:opacity-40"
            onClick={finish}
            disabled={loading || !strategy}
          >
            {t('wizard.finish')} ✦
          </button>
        )}
      </div>
    </div>
  );
}

function FactsRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-ink-500">
        {label}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {items.slice(0, 6).map((it, i) => (
          <span
            key={i}
            className="rounded-md border border-brand-200 bg-white px-1.5 py-0.5 text-[11px] text-ink-700"
            title={it}
          >
            {it.length > 40 ? it.slice(0, 40) + '…' : it}
          </span>
        ))}
      </div>
    </div>
  );
}

function StrategyCard({
  title,
  block,
  lines,
  onEditLine,
  onRegenLine,
  onRegenBlock,
}: {
  title: string;
  block: 'audience' | 'goal' | 'narrative' | 'local';
  lines: string[];
  onEditLine: (index: number, value: string) => void;
  onRegenLine: (index: number) => Promise<void> | void;
  onRegenBlock: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [regen, setRegen] = useState<number | 'block' | null>(null);
  return (
    <div className="group/block rounded-xl border border-ink-100 bg-ink-100/30 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-ink-500">{title}</div>
        <button
          className="rounded-md px-1.5 py-0.5 text-xs text-ink-500 opacity-0 hover:bg-brand-50 hover:text-brand-700 group-hover/block:opacity-100"
          onClick={async () => {
            setRegen('block');
            try {
              await onRegenBlock();
            } finally {
              setRegen(null);
            }
          }}
          title="重新生成整块"
        >
          {regen === 'block' ? '…' : '↻ 整块'}
        </button>
      </div>
      <ul className="mt-2 space-y-1.5 text-sm text-ink-700">
        {lines.map((line, i) => (
          <li key={i} className="group/line flex gap-2">
            <span className="mt-1.5 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-brand-500" />
            {editing === i ? (
              <textarea
                autoFocus
                className="input flex-1 !py-1 text-sm"
                value={line}
                rows={Math.max(1, Math.ceil(line.length / 30))}
                onChange={(e) => onEditLine(i, e.target.value)}
                onBlur={() => setEditing(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditing(null);
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) setEditing(null);
                }}
              />
            ) : (
              <span
                className="flex-1 cursor-text rounded px-1 hover:bg-white"
                onClick={() => setEditing(i)}
              >
                {line}
              </span>
            )}
            <button
              className="self-start rounded px-1 text-xs text-ink-300 opacity-0 hover:text-brand-700 group-hover/line:opacity-100"
              title="重新生成这一条"
              onClick={async () => {
                setRegen(i);
                try {
                  await onRegenLine(i);
                } finally {
                  setRegen(null);
                }
              }}
            >
              {regen === i ? '…' : '↻'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

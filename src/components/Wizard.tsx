'use client';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
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
  const [step, setStep] = useState(0);
  const [inputs, setInputs] = useState<ProductInputs>(defaultInputs(locale));
  const [refUrl, setRefUrl] = useState('');
  const [strategy, setStrategy] = useState<StrategySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [brandProbe, setBrandProbe] = useState<{
    primary?: string;
    candidates: string[];
    source: string;
    siteTitle?: string;
  } | null>(null);
  const [brandProbing, setBrandProbing] = useState(false);
  const totalSteps = 4;

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
        body: JSON.stringify({ inputs }),
      });
      const data = await res.json();
      setStrategy(data.strategy);
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
        const res = await fetch('/api/brand', {
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

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    const names = Array.from(files).map((f) => f.name);
    set({ uploadedFileNames: [...inputs.uploadedFileNames, ...names] });
  };

  const finish = async () => {
    setLoading(true);
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputs,
        strategy,
        referenceUrl: inputs.referenceUrls[0],
        primary: brandProbe?.primary,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (data?.id) router.push(`/${locale}/projects/${data.id}`);
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('wizard.title')}</h1>
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
              {inputs.uploadedFileNames.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {inputs.uploadedFileNames.map((n, i) => (
                    <li key={i} className="pill">
                      📎 {n}
                    </li>
                  ))}
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
            {loading && <div className="text-sm text-ink-500">…</div>}
            {strategy && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <StrategyCard title={t('wizard.step4.audience')} lines={strategy.audience} />
                <StrategyCard title={t('wizard.step4.goal')} lines={strategy.goal} />
                <StrategyCard title={t('wizard.step4.narrative')} lines={strategy.narrative} />
                <StrategyCard title={t('wizard.step4.local')} lines={strategy.local} />
              </div>
            )}
            <div>
              <button
                className="btn btn-secondary"
                onClick={async () => {
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
                ↻ {t('wizard.step4.regenerate')}
              </button>
            </div>
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

function StrategyCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-ink-100/30 p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-ink-500">{title}</div>
      <ul className="mt-2 space-y-1.5 text-sm text-ink-700">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-1.5 inline-block h-1 w-1 rounded-full bg-brand-500" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

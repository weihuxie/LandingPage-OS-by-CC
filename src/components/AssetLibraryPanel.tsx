'use client';
import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import type {
  AssetLibrary,
  TestimonialAsset,
  CertificationAsset,
  CaseStudyAsset,
  PressAsset,
  BrandAsset,
  MarketCode,
  PageLocale,
} from '@/lib/types';
import { PAGE_LOCALES } from '@/lib/types';
import { nativeLabel } from '@/lib/i18n-detect';

type Tab = 'brand' | 'testimonials' | 'certifications' | 'cases' | 'press' | 'media';

const TABS: { id: Tab; label: string }[] = [
  { id: 'brand', label: '企业品牌' },
  { id: 'testimonials', label: '客户证言' },
  { id: 'certifications', label: '认证合规' },
  { id: 'cases', label: '标杆案例' },
  { id: 'press', label: '媒体背书' },
  { id: 'media', label: '素材' },
];

export default function AssetLibraryPanel({ initial }: { initial: AssetLibrary }) {
  const [tab, setTab] = useState<Tab>('brand');
  const [lib, setLib] = useState<AssetLibrary>(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    if (status !== 'saving') return;
    const timer = setTimeout(async () => {
      await fetch('/api/assets', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(lib),
      });
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 1200);
    }, 500);
    return () => clearTimeout(timer);
  }, [status, lib]);

  const touch = () => setStatus('saving');

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-xl border border-ink-100 p-1 text-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`rounded-lg px-3 py-1.5 ${
                tab === t.id ? 'bg-brand-600 text-white' : 'text-ink-700'
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-ink-500">
          {status === 'saving' ? '保存中…' : status === 'saved' ? '已保存' : ''}
        </div>
      </div>

      <div className="mt-6">
        {tab === 'brand' && (
          <BrandTab
            value={lib.brand}
            onChange={(b) => {
              setLib({ ...lib, brand: b });
              touch();
            }}
          />
        )}
        {tab === 'testimonials' && (
          <TestimonialsTab
            value={lib.testimonials}
            onChange={(x) => {
              setLib({ ...lib, testimonials: x });
              touch();
            }}
          />
        )}
        {tab === 'certifications' && (
          <CertsTab
            value={lib.certifications}
            onChange={(x) => {
              setLib({ ...lib, certifications: x });
              touch();
            }}
          />
        )}
        {tab === 'cases' && (
          <CasesTab
            value={lib.cases}
            onChange={(x) => {
              setLib({ ...lib, cases: x });
              touch();
            }}
          />
        )}
        {tab === 'press' && (
          <PressTab
            value={lib.press}
            onChange={(x) => {
              setLib({ ...lib, press: x });
              touch();
            }}
          />
        )}
        {tab === 'media' && (
          <MediaTab
            value={lib.media ?? []}
            onChange={(x) => {
              setLib({ ...lib, media: x });
              touch();
            }}
          />
        )}
      </div>
    </div>
  );
}

function MediaTab({
  value,
  onChange,
}: {
  value: import('@/lib/types').MediaRef[];
  onChange: (x: import('@/lib/types').MediaRef[]) => void;
}) {
  const add = (kind: 'image' | 'video' | 'logo' | 'gif') =>
    onChange([
      { id: nanoid(8), kind, url: '', label: '' } as import('@/lib/types').MediaRef,
      ...value,
    ]);
  const grouped = {
    image: value.filter((m) => m.kind === 'image'),
    video: value.filter((m) => m.kind === 'video'),
    logo: value.filter((m) => m.kind === 'logo'),
    gif: value.filter((m) => m.kind === 'gif'),
  };
  return (
    <div>
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-ink-500">
          模块编辑器里可直接选用这些素材。每条支持「按语言设不同版本」。
        </div>
        <div className="flex gap-1">
          <button className="btn btn-secondary text-xs" onClick={() => add('image')}>
            + 图片
          </button>
          <button className="btn btn-secondary text-xs" onClick={() => add('video')}>
            + 视频
          </button>
          <button className="btn btn-secondary text-xs" onClick={() => add('logo')}>
            + Logo
          </button>
          <button className="btn btn-secondary text-xs" onClick={() => add('gif')}>
            + GIF
          </button>
        </div>
      </div>
      {value.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-100 p-8 text-center text-xs text-ink-500">
          还没有素材。新建一张产品截图或 Demo 视频 URL 看看。
        </div>
      ) : (
        <div className="space-y-4">
          {(['image', 'logo', 'video', 'gif'] as const).map((k) =>
            grouped[k].length ? (
              <div key={k}>
                <div className="label mb-2">{k.toUpperCase()} · {grouped[k].length}</div>
                <div className="space-y-2">
                  {grouped[k].map((m) => {
                    const idx = value.indexOf(m);
                    return (
                      <MediaLibraryRow
                        key={m.id}
                        m={m}
                        onChange={(v) => {
                          const next = [...value];
                          next[idx] = v;
                          onChange(next);
                        }}
                        onRemove={() => onChange(value.filter((_, j) => j !== idx))}
                      />
                    );
                  })}
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function MediaLibraryRow({
  m,
  onChange,
  onRemove,
}: {
  m: import('@/lib/types').MediaRef;
  onChange: (v: import('@/lib/types').MediaRef) => void;
  onRemove: () => void;
}) {
  const filledLocales = m.localizedUrls ? Object.keys(m.localizedUrls).length : 0;
  return (
    <div className="rounded-xl border border-ink-100 p-3">
      <div className="flex items-center gap-2">
        <input
          className="input flex-1 text-sm"
          placeholder={`${m.kind} 的名字（如 "Dashboard 主截图"）`}
          value={m.label ?? ''}
          onChange={(e) => onChange({ ...m, label: e.target.value })}
        />
        <span className="pill text-[11px]">
          {filledLocales}/4 locale
        </span>
        <button className="text-xs text-ink-500 hover:text-red-600" onClick={onRemove}>
          删除
        </button>
      </div>
      <div className="mt-2">
        <input
          className="input text-sm"
          placeholder="默认 URL"
          value={m.url}
          onChange={(e) => onChange({ ...m, url: e.target.value })}
        />
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-ink-500 hover:text-ink-900">
          ▸ 按语言设不同版本（{filledLocales}/4）
        </summary>
        <div className="mt-2 space-y-1.5 rounded-lg border border-ink-100 bg-ink-100/20 p-2">
          {PAGE_LOCALES.map((l) => (
            <div key={l} className="flex items-center gap-1.5">
              <span className="w-16 shrink-0 text-[11px] text-ink-500">{nativeLabel(l)}</span>
              <input
                className="input text-xs !py-1"
                placeholder="(空 = 用默认)"
                value={m.localizedUrls?.[l] ?? ''}
                onChange={(e) => {
                  const next = { ...(m.localizedUrls ?? {}) };
                  if (e.target.value.trim()) next[l] = e.target.value.trim();
                  else delete next[l];
                  onChange({
                    ...m,
                    localizedUrls: Object.keys(next).length ? next : undefined,
                  });
                }}
              />
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function BrandTab({
  value,
  onChange,
}: {
  value: BrandAsset | null;
  onChange: (b: BrandAsset) => void;
}) {
  const b: BrandAsset = value ?? {
    id: nanoid(8),
    logos: [],
    primaryColor: '#4861ff',
  };
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <div className="label mb-1.5">主色</div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={b.primaryColor}
            onChange={(e) => onChange({ ...b, primaryColor: e.target.value })}
            className="h-10 w-16 rounded-lg border border-ink-100"
          />
          <input
            className="input"
            value={b.primaryColor}
            onChange={(e) => onChange({ ...b, primaryColor: e.target.value })}
          />
        </div>
      </div>
      <div>
        <div className="label mb-1.5">辅色（可选）</div>
        <input
          type="color"
          value={b.secondaryColor ?? '#0b1020'}
          onChange={(e) => onChange({ ...b, secondaryColor: e.target.value })}
          className="h-10 w-16 rounded-lg border border-ink-100"
        />
      </div>
      <div className="sm:col-span-2">
        <div className="label mb-1.5">Logo（多版本，多行一个链接）</div>
        <textarea
          className="input min-h-[80px]"
          placeholder="https://..."
          value={b.logos.join('\n')}
          onChange={(e) =>
            onChange({ ...b, logos: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })
          }
        />
      </div>
      <div className="sm:col-span-2">
        <div className="label mb-1.5">字体栈</div>
        <input
          className="input"
          placeholder='例如："Inter", "Noto Sans SC", sans-serif'
          value={b.fontStack ?? ''}
          onChange={(e) => onChange({ ...b, fontStack: e.target.value })}
        />
      </div>
    </div>
  );
}

function TestimonialsTab({
  value,
  onChange,
}: {
  value: TestimonialAsset[];
  onChange: (x: TestimonialAsset[]) => void;
}) {
  const add = () =>
    onChange([
      {
        id: nanoid(8),
        createdAt: Date.now(),
        author: '',
        role: '',
        company: '',
        quote: '',
        primaryLocale: 'zh-CN' as PageLocale,
        tags: [],
      },
      ...value,
    ]);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-ink-500">
          主要语言 = 原话的语言。选对语言能让证言保真展示，而不是机翻
        </div>
        <button className="btn btn-secondary text-xs" onClick={add}>
          + 添加证言
        </button>
      </div>
      <div className="space-y-2">
        {value.map((t, i) => (
          <TestimonialRow
            key={t.id}
            t={t}
            onChange={(v) => update(i, v)}
            onRemove={() => remove(i)}
          />
        ))}
      </div>
    </div>
  );
  function update(i: number, v: TestimonialAsset) {
    const next = [...value];
    next[i] = v;
    onChange(next);
  }
  function remove(i: number) {
    onChange(value.filter((_, j) => j !== i));
  }
}

function TestimonialRow({
  t,
  onChange,
  onRemove,
}: {
  t: TestimonialAsset;
  onChange: (v: TestimonialAsset) => void;
  onRemove: () => void;
}) {
  const [showTranslations, setShowTranslations] = useState(false);
  const primary = t.primaryLocale ?? ('zh-CN' as PageLocale);
  const translationLocales = PAGE_LOCALES.filter((l) => l !== primary);
  const filledTranslations = translationLocales.filter(
    (l) => t.localizedQuotes?.[l]?.quote,
  ).length;

  const setLocQuote = (locale: PageLocale, quote: string, aiGenerated?: boolean) => {
    const next = { ...(t.localizedQuotes ?? {}) };
    if (quote.trim()) {
      next[locale] = { quote: quote.trim(), aiGenerated };
    } else {
      delete next[locale];
    }
    onChange({ ...t, localizedQuotes: Object.keys(next).length ? next : undefined });
  };

  return (
    <div className="rounded-xl border border-ink-100 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input
          className="input"
          placeholder="姓名"
          value={t.author}
          onChange={(e) => onChange({ ...t, author: e.target.value })}
        />
        <input
          className="input"
          placeholder="职位"
          value={t.role}
          onChange={(e) => onChange({ ...t, role: e.target.value })}
        />
        <input
          className="input"
          placeholder="公司"
          value={t.company}
          onChange={(e) => onChange({ ...t, company: e.target.value })}
        />
      </div>
      <div className="mt-2">
        <div className="label mb-1.5">主要语言（原话使用的语言）</div>
        <div className="flex gap-1 rounded-lg border border-ink-100 p-0.5 text-[11px]">
          {PAGE_LOCALES.map((l) => (
            <button
              key={l}
              onClick={() => onChange({ ...t, primaryLocale: l })}
              className={`flex-1 rounded px-2 py-1 ${
                primary === l ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-900'
              }`}
              type="button"
            >
              {nativeLabel(l)}
            </button>
          ))}
        </div>
      </div>
      <textarea
        className="input mt-2 min-h-[72px]"
        placeholder={`${nativeLabel(primary)} 原话`}
        value={t.quote}
        onChange={(e) => onChange({ ...t, quote: e.target.value })}
      />
      <button
        type="button"
        onClick={() => setShowTranslations((s) => !s)}
        className="mt-2 flex w-full items-center justify-between text-left text-[11px] text-ink-500 hover:text-ink-900"
      >
        <span>
          {showTranslations ? '▾' : '▸'} 翻译版本 · {filledTranslations}/
          {translationLocales.length} 已填
        </span>
      </button>
      {showTranslations && (
        <div className="mt-2 space-y-2 rounded-lg border border-ink-100 bg-ink-100/20 p-2">
          <div className="text-[10px] text-ink-500">
            空 = 该语言访客看原话 · 填了 = 该语言访客看翻译版。AI 翻译会加「请校对」水印。
          </div>
          {translationLocales.map((l) => {
            const entry = t.localizedQuotes?.[l];
            return (
              <div key={l} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-[11px] text-ink-500">
                    {nativeLabel(l)}
                  </span>
                  {entry?.aiGenerated && (
                    <span className="pill bg-amber-50 border-amber-200 text-amber-700 text-[10px]">
                      AI 翻译,请校对
                    </span>
                  )}
                  <button
                    type="button"
                    className="ml-auto text-[11px] text-brand-700 hover:underline disabled:text-ink-300"
                    disabled={!t.quote.trim()}
                    onClick={() => {
                      // Stub — real LLM call will land here when OPENAI_API_KEY is set.
                      // For now mark AI-generated with a placeholder that echoes original.
                      setLocQuote(l, `[AI 待翻译] ${t.quote}`, true);
                    }}
                  >
                    AI 翻译
                  </button>
                </div>
                <textarea
                  className="input min-h-[48px] text-xs"
                  placeholder={`(空 = ${nativeLabel(l)} 访客看原话)`}
                  value={entry?.quote ?? ''}
                  onChange={(e) => setLocQuote(l, e.target.value, false)}
                />
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          className="input"
          placeholder="行业"
          value={t.industry ?? ''}
          onChange={(e) => onChange({ ...t, industry: e.target.value })}
        />
        <input
          className="input"
          placeholder='标签（逗号分隔）例如: pain-cost, benefit-roi'
          value={t.tags.join(', ')}
          onChange={(e) =>
            onChange({
              ...t,
              tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
            })
          }
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {(['CN', 'TW', 'JP', 'US', 'EU', 'GLOBAL'] as MarketCode[]).map((m) => {
            const on = t.preferredMarkets?.includes(m);
            return (
              <button
                key={m}
                type="button"
                className={`pill text-[10px] ${on ? 'border-brand-200 bg-brand-50 text-brand-700' : ''}`}
                onClick={() => {
                  const set = new Set(t.preferredMarkets ?? []);
                  if (on) set.delete(m);
                  else set.add(m);
                  onChange({ ...t, preferredMarkets: set.size ? [...set] : undefined });
                }}
              >
                偏好市场 {m}
              </button>
            );
          })}
        </div>
        <button className="text-xs text-ink-500 hover:text-red-600" onClick={onRemove}>
          删除
        </button>
      </div>
    </div>
  );
}

function CertsTab({
  value,
  onChange,
}: {
  value: CertificationAsset[];
  onChange: (x: CertificationAsset[]) => void;
}) {
  const MARKETS: MarketCode[] = ['CN', 'TW', 'JP', 'US', 'EU', 'GLOBAL'];
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-ink-500">SOC2 / ISO / GDPR — 不同市场强化不同信任点</div>
        <button
          className="btn btn-secondary text-xs"
          onClick={() =>
            onChange([{ id: nanoid(8), createdAt: Date.now(), name: '', markets: [] }, ...value])
          }
        >
          + 添加认证
        </button>
      </div>
      <div className="space-y-2">
        {value.map((c, i) => (
          <div key={c.id} className="rounded-xl border border-ink-100 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                className="input"
                placeholder="名称（如 SOC 2 Type II）"
                value={c.name}
                onChange={(e) => {
                  const next = [...value];
                  next[i] = { ...c, name: e.target.value };
                  onChange(next);
                }}
              />
              <input
                className="input"
                placeholder="Logo URL"
                value={c.logoUrl ?? ''}
                onChange={(e) => {
                  const next = [...value];
                  next[i] = { ...c, logoUrl: e.target.value };
                  onChange(next);
                }}
              />
              <input
                className="input"
                placeholder="有效期"
                value={c.validUntil ?? ''}
                onChange={(e) => {
                  const next = [...value];
                  next[i] = { ...c, validUntil: e.target.value };
                  onChange(next);
                }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {MARKETS.map((m) => {
                const on = c.markets.includes(m);
                return (
                  <button
                    key={m}
                    className={`pill ${on ? 'border-brand-200 bg-brand-50 text-brand-700' : ''}`}
                    onClick={() => {
                      const next = [...value];
                      next[i] = {
                        ...c,
                        markets: on ? c.markets.filter((x) => x !== m) : [...c.markets, m],
                      };
                      onChange(next);
                    }}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex justify-end">
              <button
                className="text-xs text-ink-500 hover:text-red-600"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CasesTab({
  value,
  onChange,
}: {
  value: CaseStudyAsset[];
  onChange: (x: CaseStudyAsset[]) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-ink-500">按行业自动生成 Logo 墙与数据背书</div>
        <button
          className="btn btn-secondary text-xs"
          onClick={() =>
            onChange([
              { id: nanoid(8), createdAt: Date.now(), customerName: '', industry: '', metric: '', summary: '' },
              ...value,
            ])
          }
        >
          + 添加案例
        </button>
      </div>
      <div className="space-y-2">
        {value.map((c, i) => (
          <div key={c.id} className="rounded-xl border border-ink-100 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input className="input" placeholder="客户名" value={c.customerName} onChange={(e) => up(i, { ...c, customerName: e.target.value })} />
              <input className="input" placeholder="行业" value={c.industry} onChange={(e) => up(i, { ...c, industry: e.target.value })} />
              <input className="input" placeholder="Logo URL" value={c.customerLogoUrl ?? ''} onChange={(e) => up(i, { ...c, customerLogoUrl: e.target.value })} />
              <input className="input" placeholder='核心指标（如 "3.8× ROI"）' value={c.metric} onChange={(e) => up(i, { ...c, metric: e.target.value })} />
            </div>
            <textarea
              className="input mt-2 min-h-[72px]"
              placeholder="一句话摘要"
              value={c.summary}
              onChange={(e) => up(i, { ...c, summary: e.target.value })}
            />
            <div className="mt-2 flex justify-end">
              <button
                className="text-xs text-ink-500 hover:text-red-600"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  function up(i: number, v: CaseStudyAsset) {
    const next = [...value];
    next[i] = v;
    onChange(next);
  }
}

function PressTab({
  value,
  onChange,
}: {
  value: PressAsset[];
  onChange: (x: PressAsset[]) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-ink-500">第三方媒体公信力</div>
        <button
          className="btn btn-secondary text-xs"
          onClick={() =>
            onChange([{ id: nanoid(8), createdAt: Date.now(), outlet: '', headline: '', url: '' }, ...value])
          }
        >
          + 添加报道
        </button>
      </div>
      <div className="space-y-2">
        {value.map((p, i) => (
          <div key={p.id} className="rounded-xl border border-ink-100 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input className="input" placeholder="媒体" value={p.outlet} onChange={(e) => up(i, { ...p, outlet: e.target.value })} />
              <input className="input" placeholder="标题" value={p.headline} onChange={(e) => up(i, { ...p, headline: e.target.value })} />
              <input className="input sm:col-span-2" placeholder="原文链接" value={p.url} onChange={(e) => up(i, { ...p, url: e.target.value })} />
            </div>
            <textarea
              className="input mt-2 min-h-[60px]"
              placeholder="引用金句（可选）"
              value={p.quote ?? ''}
              onChange={(e) => up(i, { ...p, quote: e.target.value })}
            />
            <div className="mt-2 flex justify-end">
              <button
                className="text-xs text-ink-500 hover:text-red-600"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  function up(i: number, v: PressAsset) {
    const next = [...value];
    next[i] = v;
    onChange(next);
  }
}

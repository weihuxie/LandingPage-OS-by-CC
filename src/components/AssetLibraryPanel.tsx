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
} from '@/lib/types';

type Tab = 'brand' | 'testimonials' | 'certifications' | 'cases' | 'press';

const TABS: { id: Tab; label: string }[] = [
  { id: 'brand', label: '企业品牌' },
  { id: 'testimonials', label: '客户证言' },
  { id: 'certifications', label: '认证合规' },
  { id: 'cases', label: '标杆案例' },
  { id: 'press', label: '媒体背书' },
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
      </div>
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
      { id: nanoid(8), createdAt: Date.now(), author: '', role: '', company: '', quote: '', tags: [] },
      ...value,
    ]);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-ink-500">按痛点/行业标签存，AI 会按命中匹配</div>
        <button className="btn btn-secondary text-xs" onClick={add}>
          + 添加证言
        </button>
      </div>
      <div className="space-y-2">
        {value.map((t, i) => (
          <div key={t.id} className="rounded-xl border border-ink-100 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input className="input" placeholder="姓名" value={t.author} onChange={(e) => update(i, { ...t, author: e.target.value })} />
              <input className="input" placeholder="职位" value={t.role} onChange={(e) => update(i, { ...t, role: e.target.value })} />
              <input className="input" placeholder="公司" value={t.company} onChange={(e) => update(i, { ...t, company: e.target.value })} />
            </div>
            <textarea
              className="input mt-2 min-h-[72px]"
              placeholder="原话"
              value={t.quote}
              onChange={(e) => update(i, { ...t, quote: e.target.value })}
            />
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                className="input"
                placeholder="行业"
                value={t.industry ?? ''}
                onChange={(e) => update(i, { ...t, industry: e.target.value })}
              />
              <input
                className="input"
                placeholder='标签（逗号分隔）例如: pain-cost, benefit-roi'
                value={t.tags.join(', ')}
                onChange={(e) =>
                  update(i, { ...t, tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                }
              />
            </div>
            <div className="mt-2 flex justify-end">
              <button className="text-xs text-ink-500 hover:text-red-600" onClick={() => remove(i)}>
                删除
              </button>
            </div>
          </div>
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

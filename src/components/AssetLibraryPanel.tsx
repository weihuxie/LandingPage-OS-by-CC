'use client';
import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import type {
  AssetLibrary,
  CertificationAsset,
  PressAsset,
  BrandAsset,
  MarketCode,
} from '@/lib/types';

/**
 * Feishu #6 (ownership layering):
 *
 * This is the BRAND-level / company-wide asset library. It only exposes
 * what should be shared across products — brand identity, compliance,
 * and press coverage. Product-scoped assets (testimonials, case studies,
 * media refs) now live on each Product and are edited inline in the
 * landing-page editor — see `Product.assets` in types.ts.
 *
 * Before this trim we had 6 tabs here and the same concepts also inside
 * Product.assets, which made "ownership" ambiguous for users: adding a
 * testimonial here would not automatically show on a specific product,
 * and vice-versa. The tabs for testimonials / cases / media have been
 * removed so the tool guides people to the right place by structure.
 */
type Tab = 'brand' | 'certifications' | 'press';

const TABS: { id: Tab; label: string }[] = [
  { id: 'brand', label: '企业品牌' },
  { id: 'certifications', label: '认证合规' },
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
        {tab === 'certifications' && (
          <CertsTab
            value={lib.certifications}
            onChange={(x) => {
              setLib({ ...lib, certifications: x });
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
      <div className="mt-6 rounded-xl border border-ink-100 bg-ink-100/30 p-3 text-[11px] leading-relaxed text-ink-500">
        💡 客户证言 / 标杆案例 / 截图素材 属于产品级资产，按产品维护 —
        请在「我的产品」→ 选择产品 → 模块编辑器里逐项管理。
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

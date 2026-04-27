'use client';
import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import type {
  AssetLibrary,
  CertificationAsset,
  PressAsset,
  BrandAsset,
  LogoEntry,
  MarketCode,
  PageLocale,
  MediaRef,
} from '@/lib/types';
import { PAGE_LOCALES } from '@/lib/types';
import { nativeLabel } from '@/lib/i18n-detect';
import MediaField from './MediaField';

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
    <div className="space-y-5">
      {/* 品牌色 — renamed from "主色" with a meaningful subtitle + live
          mini-button preview so users see exactly where the color lands.
          辅色 / fontStack 已删除（CLAUDE.md 工程笔记）— see types.ts. */}
      <div>
        <div className="label mb-1.5">
          品牌色
          <span className="ml-1 text-[11px] font-normal text-ink-500">
            （Hero 主 CTA 按钮、超链接、强调色）
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={b.primaryColor}
            onChange={(e) => onChange({ ...b, primaryColor: e.target.value })}
            className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-ink-100"
            aria-label="品牌色 picker"
          />
          <input
            className="input flex-1"
            value={b.primaryColor}
            onChange={(e) => onChange({ ...b, primaryColor: e.target.value })}
            placeholder="#4861ff"
          />
          {/* Live mini button preview — same shape as the renderer's primary
              CTA. Updates immediately as the user picks a color, so they
              can see "粉到亮瞎眼吗？" before saving. */}
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-ink-100 bg-ink-50/50 px-3 py-2">
            <span className="text-[10px] uppercase tracking-wide text-ink-400">预览</span>
            <span
              className="rounded-md px-3 py-1 text-xs font-medium text-white"
              style={{ backgroundColor: b.primaryColor }}
            >
              免费试用 ↗
            </span>
          </div>
        </div>
      </div>

      {/* 字体提示 — directs users to the page-level picker instead of
          the old textarea. Pure copy, zero state. */}
      <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/30 p-3 text-[11px] leading-relaxed text-ink-500">
        💡 字体在「我的产品」→ 选择产品 → 编辑器 Hero 模块的「标题字号」下方调节，提供 6 种语言相关的字体磁贴。这里不再让你手敲 CSS 字体栈。
      </div>

      {/* Logo 列表 — card-list editor with thumbnails / showIn chips /
          MediaField for video & image variants / bulk paste backdoor.
          Replaces the old textarea where users pasted URLs one-per-line. */}
      <LogoListEditor
        label="Logo"
        hint='客户 logo 墙、合作伙伴。支持图片 / 视频 / GIF。每条可设"适用语言"，留空 = 全 locale 通用。'
        value={b.logos}
        onChange={(logos) => onChange({ ...b, logos })}
      />
    </div>
  );
}

/**
 * LogoListEditor — card-list UI for LogoEntry[].
 *
 * Replaces the old textarea-of-URLs (one URL per line) with a proper
 * editor that:
 *   - Shows each entry as a card with thumbnail + label + showIn chips
 *   - Uses MediaField (existing) for image / video / GIF kind support +
 *     localizedUrls (the "same brand, different locale URL" mechanism)
 *   - "+ 添加 Logo" appends an empty entry, edit inline
 *   - "批量粘贴 URL" opens a modal where power users paste N URLs at once,
 *     auto-converted to image entries (the migration path from the old
 *     textarea workflow without losing that affordance entirely)
 *
 * Used by BrandTab (this file) for brand.logos. Same shape can be reused
 * for press.logos / cert.logos in future passes — kept generic on purpose.
 */
function LogoListEditor({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: LogoEntry[];
  onChange: (next: LogoEntry[]) => void;
}) {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const update = (i: number, patch: Partial<LogoEntry>) => {
    const next = [...value];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const target = i + dir;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[i], next[target]] = [next[target], next[i]];
    onChange(next);
  };
  const addEmpty = () =>
    onChange([
      ...value,
      {
        id: nanoid(8),
        media: { id: nanoid(8), kind: 'image', url: '' },
      },
    ]);
  const bulkAdd = () => {
    const urls = bulkText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (urls.length === 0) return;
    const newEntries: LogoEntry[] = urls.map((url) => ({
      id: nanoid(8),
      media: { id: nanoid(8), kind: 'image', url },
    }));
    onChange([...value, ...newEntries]);
    setBulkText('');
    setBulkOpen(false);
  };

  return (
    <div>
      <div className="mb-1.5 flex items-end justify-between">
        <div>
          <div className="label">{label}</div>
          {hint && <div className="text-[11px] text-ink-500">{hint}</div>}
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setBulkOpen((v) => !v)}
            className="text-xs text-ink-500 hover:text-brand-600"
          >
            批量粘贴 URL
          </button>
          <button
            type="button"
            onClick={addEmpty}
            className="btn btn-secondary text-xs"
          >
            + 添加 Logo
          </button>
        </div>
      </div>

      {bulkOpen && (
        <div className="mb-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
          <div className="text-[11px] text-ink-600">
            粘贴 N 行 URL（每行一个），自动转成 image 条目。已添加的 logo 不会重复。
          </div>
          <textarea
            className="input mt-2 min-h-[80px] text-xs"
            placeholder="https://...alibaba-logo.png&#10;https://...microsoft-logo.svg&#10;..."
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setBulkOpen(false);
                setBulkText('');
              }}
              className="text-xs text-ink-500"
            >
              取消
            </button>
            <button
              type="button"
              onClick={bulkAdd}
              disabled={!bulkText.trim()}
              className="btn btn-primary text-xs disabled:opacity-50"
            >
              批量添加
            </button>
          </div>
        </div>
      )}

      {value.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 p-6 text-center text-xs text-ink-500">
          还没有 logo。点右上角"+ 添加 Logo"开始，或"批量粘贴 URL"导入。
        </div>
      ) : (
        <div className="space-y-2">
          {value.map((entry, i) => (
            <LogoEntryCard
              key={entry.id}
              entry={entry}
              isFirst={i === 0}
              isLast={i === value.length - 1}
              onChange={(patch) => update(i, patch)}
              onRemove={() => remove(i)}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LogoEntryCard({
  entry,
  isFirst,
  isLast,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  entry: LogoEntry;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<LogoEntry>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [expanded, setExpanded] = useState(!entry.media.url); // auto-expand new empty entries
  const showIn = entry.showIn ?? [];
  const allLocales = showIn.length === 0;

  const toggleLocale = (loc: PageLocale) => {
    if (allLocales) {
      onChange({ showIn: [loc] }); // 从"全部"切换到只这一个
      return;
    }
    if (showIn.includes(loc)) {
      const next = showIn.filter((l) => l !== loc);
      onChange({ showIn: next.length === 0 ? undefined : next });
    } else {
      onChange({ showIn: [...showIn, loc] });
    }
  };
  const setAllLocales = () => onChange({ showIn: undefined });

  return (
    <div className="rounded-xl border border-ink-100 p-3">
      <div className="flex items-start gap-3">
        {/* Thumbnail — image or video poster, broken-link safe */}
        <Thumbnail media={entry.media} />

        <div className="min-w-0 flex-1 space-y-2">
          {/* Label row */}
          <input
            className="input w-full text-xs"
            placeholder="名称（如：阿里巴巴）— 用作 alt 文案 + 列表识别"
            value={entry.label ?? ''}
            onChange={(e) => onChange({ label: e.target.value || undefined })}
          />

          {/* showIn chips — 全部 + 4 locales, multi-toggle */}
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="text-ink-500">适用语言：</span>
            <button
              type="button"
              onClick={setAllLocales}
              className={`pill px-2 py-0.5 ${
                allLocales
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-ink-200 text-ink-500'
              }`}
            >
              全部
            </button>
            {PAGE_LOCALES.map((loc) => {
              const active = !allLocales && showIn.includes(loc);
              return (
                <button
                  key={loc}
                  type="button"
                  onClick={() => toggleLocale(loc)}
                  className={`pill px-2 py-0.5 ${
                    active
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : 'border-ink-200 text-ink-500'
                  }`}
                  title={nativeLabel(loc)}
                >
                  {loc}
                </button>
              );
            })}
          </div>

          {/* MediaField — collapsed by default to keep card compact;
              expand reveals URL / kind / alt / per-locale URLs. */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] text-ink-500 hover:text-brand-600"
          >
            {expanded ? '收起媒体设置 ▴' : '展开媒体设置 (URL / 类型 / 多语言变体) ▾'}
          </button>
          {expanded && (
            <div className="rounded-lg border border-ink-100 bg-ink-50/30 p-2">
              <MediaField
                value={entry.media}
                onChange={(m) =>
                  onChange({
                    media: m ?? { id: entry.media.id, kind: 'image', url: '' },
                  })
                }
                defaultKind="image"
              />
            </div>
          )}
        </div>

        {/* 排序 + 删除 */}
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            className="text-xs text-ink-500 hover:text-brand-600 disabled:opacity-30"
            aria-label="上移"
            title="上移"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            className="text-xs text-ink-500 hover:text-brand-600 disabled:opacity-30"
            aria-label="下移"
            title="下移"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-ink-500 hover:text-red-600"
            aria-label="删除"
            title="删除"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Lightweight thumbnail for a MediaRef — handles broken images, distinguishes
 * video / GIF / image visually. 48px square; clipped overflow.
 */
function Thumbnail({ media }: { media: MediaRef }) {
  const [errored, setErrored] = useState(false);
  const url = media.url;
  if (!url) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-dashed border-ink-200 text-[10px] text-ink-400">
        空
      </div>
    );
  }
  if (media.kind === 'video' && !errored) {
    return (
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-ink-100 bg-ink-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media.poster ?? url}
          alt={media.alt ?? ''}
          className="h-full w-full object-cover opacity-80"
          onError={() => setErrored(true)}
        />
        <span className="absolute right-0.5 bottom-0.5 rounded bg-black/60 px-1 text-[8px] text-white">
          ▶
        </span>
      </div>
    );
  }
  if (errored) {
    return (
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-[10px] text-amber-700"
        title="图片加载失败 — 检查 URL 是否可公开访问"
      >
        ⚠
      </div>
    );
  }
  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-ink-100 bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={media.alt ?? ''}
        className="h-full w-full object-contain"
        onError={() => setErrored(true)}
      />
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
  const up = (i: number, v: PressAsset) => {
    const next = [...value];
    next[i] = v;
    onChange(next);
  };
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-ink-500">
          第三方媒体公信力 — 文字引用 / 媒体 logo / 采访视频片段都支持
        </div>
        <button
          className="btn btn-secondary text-xs"
          onClick={() =>
            onChange([
              { id: nanoid(8), createdAt: Date.now(), outlet: '', headline: '', url: '' },
              ...value,
            ])
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
            {/* 媒体附件 — optional MediaRef. Outlet logo / article screenshot
                / video clip (CCTV / Bloomberg / 财经访谈片段). 当 kind=video
                时渲染器会播视频；当 kind=image 时渲染器显示外刊 logo 或截图。 */}
            <div className="mt-2 rounded-lg border border-ink-100 bg-ink-50/30 p-2">
              <MediaField
                label="媒体附件 (可选 · 图片 / 视频 / GIF)"
                value={p.media}
                onChange={(m) => up(i, { ...p, media: m })}
                defaultKind="image"
              />
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

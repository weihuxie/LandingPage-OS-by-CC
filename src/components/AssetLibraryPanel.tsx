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
import UploadButton from './UploadButton';
import HelpTip from './HelpTip';

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
        hint='客户 logo 墙、合作伙伴。支持图片 / 视频 / GIF。每条可设"适用语言"，留空 = 全 locale 通用。建议尺寸：长方形 (3:1 ~ 4:1，如 240×80) 视觉最稳；方形 logo 也支持但展示尺寸偏小。'
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
  // 2026-04 redesign: every row has IDENTICAL shape regardless of empty/
  // filled state. Auto-expand-on-empty was breaking visual consistency
  // (first row collapsed, new rows expanded — looked like different
  // widgets). Now URL is ALWAYS the primary visible widget; name is
  // secondary; kind / alt / locale-variants fold under "高级" for the
  // 1% who need video / per-locale URLs.
  const [advOpen, setAdvOpen] = useState(false);
  const showIn = entry.showIn ?? [];
  const allLocales = showIn.length === 0;
  const localizedCount = entry.media.localizedUrls
    ? Object.keys(entry.media.localizedUrls).length
    : 0;

  const toggleLocale = (loc: PageLocale) => {
    if (allLocales) {
      onChange({ showIn: [loc] });
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

  // Auto-detect kind from URL extension on paste — saves a trip to "高级"
  // for the common video / gif case. Doesn't override an explicit user
  // kind choice (only fires while still in the default 'image' kind).
  const setUrl = (url: string) => {
    let nextKind = entry.media.kind;
    if (entry.media.kind === 'image') {
      const lower = url.toLowerCase();
      if (/\.(mp4|webm|mov|m4v)(\?|$)/.test(lower)) nextKind = 'video';
      else if (/\.gif(\?|$)/.test(lower)) nextKind = 'gif';
    }
    onChange({ media: { ...entry.media, url, kind: nextKind } });
  };
  const setKind = (kind: 'image' | 'video' | 'gif' | 'logo') =>
    onChange({ media: { ...entry.media, kind } });
  const setAlt = (alt: string) =>
    onChange({ media: { ...entry.media, alt: alt || undefined } });
  const setLocalizedUrl = (loc: PageLocale, url: string) => {
    const cur = entry.media.localizedUrls ?? {};
    const next = { ...cur };
    if (url.trim()) next[loc] = url.trim();
    else delete next[loc];
    onChange({
      media: {
        ...entry.media,
        localizedUrls: Object.keys(next).length ? next : undefined,
      },
    });
  };

  return (
    <div className="rounded-xl border border-ink-100 p-3">
      <div className="flex items-start gap-3">
        {/* Thumbnail — image or video poster, broken-link safe */}
        <Thumbnail media={entry.media} />

        <div className="min-w-0 flex-1 space-y-2">
          {/* PRIMARY · URL input + 上传 — always visible. URL is for users
              with a public CDN link; 上传 covers the much more common case
              ("我有图片在本地"). Either path ends up populating media.url. */}
          <div className="flex gap-2">
            <input
              className="input flex-1 text-xs"
              placeholder="https://example.com/logo.png  (公开图片 / 视频 / GIF 链接)"
              value={entry.media.url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <UploadButton
              accept="image/*,video/*"
              onUpload={(r) => setUrl(r.url)}
              className="shrink-0 px-2 py-1 text-[11px]"
            />
          </div>
          {/* Diagnostic line — fires when user pastes a known-private URL
              (feishu / lark / google drive / notion / slack file). Tells
              them to upload instead of staring at a broken thumbnail.
              For other broken URLs we let Thumbnail's ⚠ fallback speak
              for itself; only loud here when we have a specific cause. */}
          {(() => {
            const diag = diagnosePrivateUrl(entry.media.url);
            return diag ? (
              <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-relaxed text-amber-800">
                <span aria-hidden>⚠</span>
                <span>{diag}</span>
              </div>
            ) : null;
          })()}

          {/* SECONDARY · name + locale chips on a single compact row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
            <input
              className="input min-w-[140px] flex-1 px-2 py-1 text-[11px]"
              placeholder="名称 (可选, 如 阿里巴巴)"
              value={entry.label ?? ''}
              onChange={(e) => onChange({ label: e.target.value || undefined })}
            />
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-ink-500">适用：</span>
              {/* 不用 .pill 类 — 它的 @apply bg-white 会盖住 active 状态。
                  全自写 inline tailwind 来保证 active vs inactive 对比强。 */}
              <Chip active={allLocales} onClick={setAllLocales} label="全部" />
              {PAGE_LOCALES.map((loc) => (
                <Chip
                  key={loc}
                  active={!allLocales && showIn.includes(loc)}
                  onClick={() => toggleLocale(loc)}
                  label={loc}
                  title={nativeLabel(loc)}
                />
              ))}
            </div>
          </div>

          {/* ADVANCED · kind switch / alt / per-locale URLs.
              Folded by default — most logo entries (image with one URL)
              never need to open it. Badges next to the toggle hint that
              the entry has a non-default kind / alt filled / locale
              variants, so users don't have to expand to remember. */}
          <button
            type="button"
            onClick={() => setAdvOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-ink-500 hover:text-brand-600"
          >
            <span>{advOpen ? '收起 ▴' : '高级 ▾'}</span>
            {!advOpen && entry.media.kind !== 'image' && (
              <span className="rounded bg-ink-100 px-1 py-0 text-[10px] text-ink-600">
                {entry.media.kind}
              </span>
            )}
            {!advOpen && localizedCount > 0 && (
              <span className="rounded bg-brand-50 px-1 py-0 text-[10px] text-brand-700">
                {localizedCount} locale 变体
              </span>
            )}
            {!advOpen && entry.media.alt && (
              <span className="text-[10px] text-ink-400">· alt 已填</span>
            )}
          </button>
          {advOpen && (
            <div className="space-y-2 rounded-lg border border-ink-100 bg-ink-50/30 p-2">
              {/* Kind switcher — same Chip helper, high-contrast active state */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-ink-500">类型：</span>
                {(['image', 'video', 'gif', 'logo'] as const).map((k) => (
                  <Chip
                    key={k}
                    active={entry.media.kind === k}
                    onClick={() => setKind(k)}
                    label={k}
                  />
                ))}
                <span className="text-[10px] text-ink-400">
                  （粘贴 .mp4 / .gif 链接会自动识别）
                </span>
              </div>
              {/* Alt text */}
              <input
                className="input w-full px-2 py-1 text-[11px]"
                placeholder='Alt 文案（无障碍 / SEO，留空时回退到上方"名称"）'
                value={entry.media.alt ?? ''}
                onChange={(e) => setAlt(e.target.value)}
              />
              {/* localizedUrls — 同一 logo 多语言版本 */}
              <div>
                <div className="mb-1 text-[11px] text-ink-500">
                  按语言不同 URL（同一 logo 有多语言版才填，如 腾讯/Tencent）
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {PAGE_LOCALES.map((loc) => (
                    <input
                      key={loc}
                      className="input px-2 py-1 text-[11px]"
                      placeholder={`${loc} URL（留空 = 用上方默认 URL）`}
                      value={entry.media.localizedUrls?.[loc] ?? ''}
                      onChange={(e) => setLocalizedUrl(loc, e.target.value)}
                    />
                  ))}
                </div>
              </div>
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
 * Strong-contrast chip used by LogoEntryCard for locale + kind toggles.
 *
 * Why not the global `.pill` class: `.pill` @applies `bg-white text-ink-700`
 * which won the cascade against my conditional `bg-brand-50 text-brand-700`,
 * so active state was invisible (用户反馈"选中没有反应"). Inline tailwind
 * here fully owns the visual — no fight.
 */
function Chip({
  active,
  onClick,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] transition ${
        active
          ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
          : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:text-brand-600'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Detect URLs that browsers cannot fetch directly (private / auth-walled).
 * The most common case in this product is feishu / lark file references —
 * users paste these because they had the URL in a feishu doc, but the
 * browser can't load them as <img src>. We surface a specific hint so
 * they know to upload instead of staring at a broken thumbnail.
 */
function diagnosePrivateUrl(url: string): string | null {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (/feishu\.cn\/file\/|lark(?:office)?\.com\/file\//.test(lower)) {
    return '飞书文件 URL 是私有的，浏览器无法直接加载。请改为「上传」该图片，或粘贴公开 CDN 链接。';
  }
  if (/(drive\.google\.com|notion\.so|slack\.com\/files)/.test(lower)) {
    return '该平台需要登录才能访问，浏览器无法直接加载。请改为「上传」或使用公开链接。';
  }
  return null;
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
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-dashed border-ink-200 text-ink-300"
        title="粘贴图片 URL 后会自动显示缩略图"
        aria-hidden
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="9" cy="10" r="1.5" fill="currentColor" />
          <path
            d="M3 17l5-5 4 4 3-3 6 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
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
      {/* Onboarding banner — same pattern as PressTab. 反馈 #16:"这里
          写了，怎么添加到页面啊" — 用户填完不知道怎么用。补一条用法
          说明指引到模块编辑器。 */}
      <div className="mb-3 rounded-xl border border-brand-100 bg-brand-50/40 p-3 text-xs leading-relaxed text-ink-700">
        <div className="mb-1 font-medium text-brand-700">如何填写</div>
        <div>
          每条 = 一项你过的合规认证（SOC 2、GDPR、等保…）。访客看到这个判断"这家是否能托管我们的数据"。
          <br />
          示例：名称 <code className="rounded bg-white px-1">SOC 2 Type II</code>
          ，logo URL（可选），适用市场勾 <code className="rounded bg-white px-1">US / EU / GLOBAL</code>。
        </div>
        <div className="mt-2 rounded-md bg-white/60 px-2 py-1.5">
          <span className="font-medium text-brand-700">→ 如何加到落地页：</span>
          这里填好的 logo 不会自动出现在页面上。打开 <code className="rounded bg-white px-1">我的产品 → 选择产品 → 编辑器</code>，
          在 <code className="rounded bg-white px-1">客户背书 (socialProof)</code> 模块点
          <code className="rounded bg-white px-1">📚 从品牌资产库</code> 选取本 tab 填的认证 logo。
        </div>
      </div>
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
      <div className="space-y-3">
        {value.map((c, i) => (
          <div key={c.id} className="rounded-xl border border-ink-100 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FieldWithLabel label="认证名称" helpPath="cert.name" required>
                <input
                  className="input"
                  placeholder="SOC 2 Type II / ISO 27001 / GDPR ..."
                  value={c.name}
                  onChange={(e) => {
                    const next = [...value];
                    next[i] = { ...c, name: e.target.value };
                    onChange(next);
                  }}
                />
              </FieldWithLabel>
              <FieldWithLabel label="Logo URL（可选）" helpPath="cert.logoUrl">
                <input
                  className="input"
                  placeholder="https://...soc2-badge.svg"
                  value={c.logoUrl ?? ''}
                  onChange={(e) => {
                    const next = [...value];
                    next[i] = { ...c, logoUrl: e.target.value };
                    onChange(next);
                  }}
                />
              </FieldWithLabel>
              <FieldWithLabel label="有效期至（可选）" helpPath="cert.validUntil">
                <input
                  className="input"
                  placeholder="2027-06-30"
                  value={c.validUntil ?? ''}
                  onChange={(e) => {
                    const next = [...value];
                    next[i] = { ...c, validUntil: e.target.value };
                    onChange(next);
                  }}
                />
              </FieldWithLabel>
            </div>
            <div className="mt-3">
              <div className="mb-1 inline-flex items-center text-[11px] uppercase tracking-wider text-ink-500">
                适用市场
                <HelpTip path="cert.markets" />
              </div>
              <div className="flex flex-wrap gap-1">
                {MARKETS.map((m) => (
                  <Chip
                    key={m}
                    active={c.markets.includes(m)}
                    label={m}
                    onClick={() => {
                      const on = c.markets.includes(m);
                      const next = [...value];
                      next[i] = {
                        ...c,
                        markets: on ? c.markets.filter((x) => x !== m) : [...c.markets, m],
                      };
                      onChange(next);
                    }}
                  />
                ))}
              </div>
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
      {/* Onboarding banner — what to fill, what to expect, real example.
          Without this users see 4 unlabeled inputs and have no idea what
          shape data we want. Fixed by 2026-04 user feedback "如何填写完
          全不知道". */}
      <div className="mb-3 rounded-xl border border-brand-100 bg-brand-50/40 p-3 text-xs leading-relaxed text-ink-700">
        <div className="mb-1 font-medium text-brand-700">如何填写</div>
        <div>
          每条 = 一篇真实的第三方媒体报道。访客看到会想"哦这家被 XX 采访过"。
          <br />
          示例：媒体名 <code className="rounded bg-white px-1">36氪</code>
          ，标题 <code className="rounded bg-white px-1">"AI 行业 OS：新一代合规底座"</code>
          ，链接是该报道的公开 URL。
        </div>
      </div>
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
      <div className="space-y-3">
        {value.map((p, i) => (
          <div key={p.id} className="rounded-xl border border-ink-100 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FieldWithLabel label="媒体名称" helpPath="press.outlet" required>
                <input
                  className="input"
                  placeholder="36氪 / TechCrunch / Bloomberg ..."
                  value={p.outlet}
                  onChange={(e) => up(i, { ...p, outlet: e.target.value })}
                />
              </FieldWithLabel>
              <FieldWithLabel label="报道标题" helpPath="press.headline" required>
                <input
                  className="input"
                  placeholder='"AI 行业 OS：新一代合规底座"'
                  value={p.headline}
                  onChange={(e) => up(i, { ...p, headline: e.target.value })}
                />
              </FieldWithLabel>
              <div className="sm:col-span-2">
                <FieldWithLabel label="原文链接" helpPath="press.url" required>
                  <input
                    className="input"
                    placeholder="https://36kr.com/p/..."
                    value={p.url}
                    onChange={(e) => up(i, { ...p, url: e.target.value })}
                  />
                </FieldWithLabel>
              </div>
            </div>
            <div className="mt-3">
              <FieldWithLabel label="引用金句（可选）" helpPath="press.quote">
                <textarea
                  className="input min-h-[60px]"
                  placeholder='例如："年度最值得关注的 AI 工具之一"'
                  value={p.quote ?? ''}
                  onChange={(e) => up(i, { ...p, quote: e.target.value })}
                />
              </FieldWithLabel>
            </div>
            {/* 媒体附件 — optional MediaRef. Outlet logo / article screenshot
                / video clip (CCTV / Bloomberg / 财经访谈片段). 当 kind=video
                时渲染器会播视频；当 kind=image 时渲染器显示外刊 logo 或截图。 */}
            <div className="mt-3 rounded-lg border border-ink-100 bg-ink-50/30 p-2">
              <div className="mb-1 inline-flex items-center text-xs font-medium uppercase tracking-wider text-ink-500">
                媒体附件（可选）
                <HelpTip path="press.media" />
              </div>
              <MediaField
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

/**
 * Reusable label-above-input wrapper used by PressTab + CertsTab + LogoEntryCard.
 * Why it exists: the original press / cert UI relied entirely on placeholders
 * for context. Once a user typed anything, the placeholder vanished and so
 * did the field's identity ("这是 outlet 还是 headline 来着？"). User
 * feedback 2026-04: "如何填写完全不知道". This helper restores the
 * label as first-class.
 */
function FieldWithLabel({
  label,
  helpPath,
  required,
  children,
}: {
  label: string;
  helpPath?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label inline-flex items-center text-[11px] uppercase tracking-wider">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
        {helpPath && <HelpTip path={helpPath} />}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

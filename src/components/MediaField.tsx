'use client';
import { useState } from 'react';
import { nanoid } from 'nanoid';
import type { MediaRef, MediaKind, PageLocale } from '@/lib/types';
import { PAGE_LOCALES } from '@/lib/types';
import { nativeLabel } from '@/lib/i18n-detect';
import UploadButton from './UploadButton';

/**
 * Reusable media editor with per-locale override UI (Phase F.4 / F.2).
 *
 * UI:
 *   Label (e.g. "Hero 截图")
 *   URL (default)  [image|video|logo kind toggle]
 *   Alt (accessibility)
 *   ▸ 按语言设不同版本 (N/4)   ← collapsible
 *       日本語:   [url]
 *       English:  [url]
 *       简体:     [url]
 *       繁體:     [url]
 */
export default function MediaField({
  value,
  onChange,
  label,
  defaultKind = 'image',
}: {
  value?: MediaRef;
  onChange: (v: MediaRef | undefined) => void;
  label?: string;
  defaultKind?: MediaKind;
}) {
  const [showLocales, setShowLocales] = useState(false);

  const ensure = (): MediaRef =>
    value ?? {
      id: nanoid(8),
      kind: defaultKind,
      url: '',
    };

  const set = (patch: Partial<MediaRef>) => onChange({ ...ensure(), ...patch });

  const setLocalizedUrl = (locale: PageLocale, url: string) => {
    const cur = ensure();
    const next = { ...(cur.localizedUrls ?? {}) };
    if (url.trim()) next[locale] = url.trim();
    else delete next[locale];
    onChange({ ...cur, localizedUrls: Object.keys(next).length ? next : undefined });
  };

  const filledCount = value?.localizedUrls
    ? Object.keys(value.localizedUrls).length
    : 0;

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-3">
      <div className="flex items-center justify-between">
        <div className="label">{label ?? 'Media'}</div>
        <div className="flex items-center gap-1 rounded-lg border border-ink-100 p-0.5 text-[11px]">
          {(['image', 'video', 'logo', 'gif'] as MediaKind[]).map((k) => (
            <button
              key={k}
              onClick={() => set({ kind: k })}
              className={`rounded px-2 py-0.5 ${
                (value?.kind ?? defaultKind) === k
                  ? 'bg-brand-600 text-white'
                  : 'text-ink-500 hover:text-ink-900'
              }`}
              type="button"
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 space-y-2">
        <div className="flex items-start gap-1.5">
          <input
            className="input flex-1 text-sm"
            placeholder="URL (YouTube / Vimeo / Loom / 图片直链)"
            value={value?.url ?? ''}
            onChange={(e) => set({ url: e.target.value })}
          />
          {/*
           * Upload is only offered for image/logo/gif — videos skip it
           * because re-hosting a multi-MB MP4 through Vercel Blob is
           * almost always wrong (use YouTube/Vimeo/Loom URLs instead).
           */}
          {(value?.kind ?? defaultKind) !== 'video' && (
            <UploadButton
              onUpload={(r) => set({ url: r.url })}
            />
          )}
        </div>
        <input
          className="input text-sm"
          placeholder="Alt 文本 (无障碍)"
          value={value?.alt ?? ''}
          onChange={(e) => set({ alt: e.target.value })}
        />
        {(value?.kind ?? defaultKind) === 'video' && (
          <input
            className="input text-sm"
            placeholder="Poster URL (视频封面,可选)"
            value={value?.poster ?? ''}
            onChange={(e) => set({ poster: e.target.value })}
          />
        )}
        {(value?.kind ?? defaultKind) === 'gif' && (
          <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800">
            💡 提示：贴 <code>.mp4</code> / <code>.webm</code> 外链会自动渲染成
            无声循环视频（体积约为同等质量 GIF 的 1/10）。真正的{' '}
            <code>.gif</code> 文件也可以直接上传（≤5MB）。
          </p>
        )}

        <button
          type="button"
          onClick={() => setShowLocales((s) => !s)}
          className="flex w-full items-center justify-between text-left text-[11px] text-ink-500 hover:text-ink-900"
        >
          <span>
            {showLocales ? '▾' : '▸'} 按语言设不同版本{' '}
            <span className="text-ink-300">({filledCount}/4 已填)</span>
          </span>
          {filledCount > 0 && !showLocales && (
            <span className="text-brand-600">有覆盖</span>
          )}
        </button>
        {showLocales && (
          <div className="space-y-1.5 rounded-lg border border-ink-100 bg-ink-100/20 p-2">
            <div className="text-[10px] text-ink-500">
              空 = 使用默认 URL · 非空 = 当 locale 命中时使用此 URL
            </div>
            {PAGE_LOCALES.map((l) => (
              <div key={l} className="flex items-center gap-1.5">
                <span className="w-16 shrink-0 text-[11px] text-ink-500">
                  {nativeLabel(l)}
                </span>
                <input
                  className="input text-xs !py-1"
                  placeholder="(空 = 用默认)"
                  value={value?.localizedUrls?.[l] ?? ''}
                  onChange={(e) => setLocalizedUrl(l, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * API-ASSET-SHAPE-* · pure coercion + filtering for AssetLibrary.
 *
 * Verifies the legacy `BrandAsset.logos: string[]` → current
 * `LogoEntry[]` migration is idempotent + lossless, and that
 * showIn-based locale filtering works as designed.
 *
 * 纯函数测试 — 不依赖 KV / API key / DOM。
 */
import { test, expect } from '@playwright/test';
import {
  coerceLogoEntry,
  coerceAssetsShape,
  logosForLocale,
  resolveLogoUrl,
} from '../../src/lib/asset-shape';
import type { AssetLibrary, LogoEntry } from '../../src/lib/types';

const emptyLib = (): AssetLibrary => ({
  brand: { id: 'b1', primaryColor: '#4861ff', logos: [] },
  testimonials: [],
  certifications: [],
  cases: [],
  press: [],
});

test.describe('API-ASSET-SHAPE · LogoEntry coercion', () => {
  test('API-ASSET-SHAPE-001 · 字符串 URL 转 image LogoEntry', () => {
    const out = coerceLogoEntry('https://example.com/ali.png');
    expect(out).not.toBeNull();
    expect(out!.media.kind).toBe('image');
    expect(out!.media.url).toBe('https://example.com/ali.png');
    expect(typeof out!.id).toBe('string');
    expect(out!.id.length).toBeGreaterThan(0);
  });

  test('API-ASSET-SHAPE-002 · 空字符串 / 空白 URL → null', () => {
    expect(coerceLogoEntry('')).toBeNull();
    expect(coerceLogoEntry('   ')).toBeNull();
  });

  test('API-ASSET-SHAPE-003 · 已是 LogoEntry 形态 → 保留所有字段（id、label、showIn）', () => {
    const input = {
      id: 'fixed-id-123',
      media: { id: 'm1', kind: 'image' as const, url: 'https://x.png' },
      label: '阿里巴巴',
      showIn: ['zh-CN', 'zh-TW'] as const,
    };
    const out = coerceLogoEntry(input);
    expect(out).not.toBeNull();
    expect(out!.id).toBe('fixed-id-123');
    expect(out!.label).toBe('阿里巴巴');
    expect(out!.showIn).toEqual(['zh-CN', 'zh-TW']);
    expect(out!.media.url).toBe('https://x.png');
  });

  test('API-ASSET-SHAPE-004 · 半迁移形态 {url} → image LogoEntry', () => {
    const out = coerceLogoEntry({ url: 'https://lone-url.png' });
    expect(out).not.toBeNull();
    expect(out!.media.kind).toBe('image');
    expect(out!.media.url).toBe('https://lone-url.png');
  });

  test('API-ASSET-SHAPE-005 · 视频 kind 保留', () => {
    const out = coerceLogoEntry({
      id: 'v1',
      media: {
        id: 'm-v',
        kind: 'video',
        url: 'https://example.com/clip.mp4',
        poster: 'https://example.com/clip.jpg',
      },
    });
    expect(out).not.toBeNull();
    expect(out!.media.kind).toBe('video');
    expect(out!.media.poster).toBe('https://example.com/clip.jpg');
  });

  test('API-ASSET-SHAPE-006 · 垃圾数据 → null（不抛异常）', () => {
    expect(coerceLogoEntry(null)).toBeNull();
    expect(coerceLogoEntry(undefined)).toBeNull();
    expect(coerceLogoEntry(42)).toBeNull();
    expect(coerceLogoEntry({})).toBeNull();
    expect(coerceLogoEntry({ id: 'x' })).toBeNull(); // 没有 media 也没有 url
  });

  test('API-ASSET-SHAPE-007 · coerceAssetsShape 整体迁移 string[] + 新形态混合', () => {
    const lib = emptyLib();
    lib.brand!.logos = [
      'https://legacy1.png',
      {
        id: 'fixed',
        media: { id: 'm', kind: 'image' as const, url: 'https://new.png' },
      },
      '   ', // 空白要被过滤掉
      { url: 'https://half-migrated.png' }, // {url} 形态
    ] as any;
    const coerced = coerceAssetsShape(lib);
    expect(coerced.brand!.logos).toHaveLength(3);
    expect(coerced.brand!.logos[0].media.url).toBe('https://legacy1.png');
    expect(coerced.brand!.logos[1].id).toBe('fixed');
    expect(coerced.brand!.logos[2].media.url).toBe('https://half-migrated.png');
  });

  test('API-ASSET-SHAPE-008 · coerceAssetsShape 幂等', () => {
    const lib = emptyLib();
    lib.brand!.logos = ['https://a.png', 'https://b.png'] as any;
    const once = coerceAssetsShape(lib);
    const twice = coerceAssetsShape(once);
    expect(twice.brand!.logos).toHaveLength(2);
    expect(twice.brand!.logos[0].media.url).toBe('https://a.png');
    expect(twice.brand!.logos[1].media.url).toBe('https://b.png');
  });
});

test.describe('API-ASSET-SHAPE · showIn locale filtering', () => {
  const make = (
    url: string,
    label: string,
    showIn?: ('zh-CN' | 'zh-TW' | 'ja' | 'en')[],
  ): LogoEntry => ({
    id: label,
    media: { id: `m-${label}`, kind: 'image', url },
    label,
    showIn,
  });

  const ali = make('https://ali.png', 'Alibaba', ['zh-CN', 'zh-TW']);
  const line = make('https://line.png', 'LINE', ['ja']);
  const ms = make('https://ms.png', 'Microsoft'); // 全部 locale
  const allLogos = [ali, line, ms];

  test('API-ASSET-SHAPE-101 · zh-CN tab → 阿里 + Microsoft（LINE 不出现）', () => {
    const out = logosForLocale(allLogos, 'zh-CN');
    expect(out.map((l) => l.label)).toEqual(['Alibaba', 'Microsoft']);
  });

  test('API-ASSET-SHAPE-102 · ja tab → LINE + Microsoft（阿里不出现）', () => {
    const out = logosForLocale(allLogos, 'ja');
    expect(out.map((l) => l.label)).toEqual(['LINE', 'Microsoft']);
  });

  test('API-ASSET-SHAPE-103 · en tab → 仅 Microsoft（阿里 + LINE 都不出现）', () => {
    const out = logosForLocale(allLogos, 'en');
    expect(out.map((l) => l.label)).toEqual(['Microsoft']);
  });

  test('API-ASSET-SHAPE-104 · 空 showIn 视为全部 locale', () => {
    const empty = make('https://empty.png', 'EmptyShowIn', []);
    expect(logosForLocale([empty], 'zh-CN').length).toBe(1);
    expect(logosForLocale([empty], 'ja').length).toBe(1);
  });

  test('API-ASSET-SHAPE-105 · 没有 url 的条目被过滤掉', () => {
    const noUrl: LogoEntry = {
      id: 'broken',
      media: { id: 'm', kind: 'image', url: '' },
    };
    expect(logosForLocale([noUrl], 'zh-CN')).toEqual([]);
  });
});

test.describe('API-ASSET-SHAPE · resolveLogoUrl', () => {
  test('API-ASSET-SHAPE-201 · 优先 localizedUrls，回退 base url', () => {
    const entry: LogoEntry = {
      id: 'tencent',
      media: {
        id: 'm',
        kind: 'image',
        url: 'https://tencent-cn.png',
        localizedUrls: {
          en: 'https://tencent-en.png',
          ja: 'https://tencent-jp.png',
        },
      },
    };
    expect(resolveLogoUrl(entry, 'zh-CN')).toBe('https://tencent-cn.png'); // 无变体回退
    expect(resolveLogoUrl(entry, 'en')).toBe('https://tencent-en.png');
    expect(resolveLogoUrl(entry, 'ja')).toBe('https://tencent-jp.png');
    expect(resolveLogoUrl(entry, 'zh-TW')).toBe('https://tencent-cn.png');
  });

  test('API-ASSET-SHAPE-202 · 没 localizedUrls → 永远返回 base url', () => {
    const entry: LogoEntry = {
      id: 'plain',
      media: { id: 'm', kind: 'image', url: 'https://plain.png' },
    };
    expect(resolveLogoUrl(entry, 'zh-CN')).toBe('https://plain.png');
    expect(resolveLogoUrl(entry, 'en')).toBe('https://plain.png');
  });
});

/**
 * API-VSYNC-* · variant-sync filter helpers (A↔B mirror within locale).
 *
 * 纯函数测试 — 不依赖 KV / API key / DOM。
 */
import { test, expect } from '@playwright/test';
import {
  filterContentForSync,
  mergeSyncedContent,
  findSyncTargetIndex,
} from '../../src/lib/variant-sync';
import type { PageModule } from '../../src/lib/types';

test.describe('API-VSYNC · variant-sync filter', () => {
  test('API-VSYNC-001 · socialProof.* 全字段同步（whole-content rule）', () => {
    const out = filterContentForSync('socialProof', {
      title: 'Trusted by',
      logos: ['Acme', 'Globex'],
      stats: [{ label: 'Users', value: '500+' }],
    });
    expect(out).toEqual({
      title: 'Trusted by',
      logos: ['Acme', 'Globex'],
      stats: [{ label: 'Users', value: '500+' }],
    });
  });

  test('API-VSYNC-002 · hero 只同步 media / layout / fontScale / CTA href —— 不同步 headline 等 copy', () => {
    const out = filterContentForSync('hero', {
      eyebrow: 'AI Hidden Cost',
      headline: 'Lose 11 hours/week',
      subhead: 'Until now',
      primaryCta: 'Stop the bleeding',
      primaryCtaHref: 'https://app.example.com/signup',
      secondaryCtaHref: '#demo',
      bullets: ['a', 'b'],
      media: { id: 'm1', kind: 'image', url: 'screenshot.png' },
      layout: 'split',
      fontScale: 'lg',
    });
    expect(out).toEqual({
      primaryCtaHref: 'https://app.example.com/signup',
      secondaryCtaHref: '#demo',
      media: { id: 'm1', kind: 'image', url: 'screenshot.png' },
      layout: 'split',
      fontScale: 'lg',
    });
    // 关键 copy 不应该泄漏过去
    expect((out as any)?.eyebrow).toBeUndefined();
    expect((out as any)?.headline).toBeUndefined();
    expect((out as any)?.subhead).toBeUndefined();
    expect((out as any)?.primaryCta).toBeUndefined();
    expect((out as any)?.bullets).toBeUndefined();
  });

  test('API-VSYNC-003 · form.* 全字段同步', () => {
    const out = filterContentForSync('form', {
      title: 'Get started',
      submitLabel: 'Send',
      fields: ['name', 'email'],
      mode: 'inline',
    });
    expect(out).toEqual({
      title: 'Get started',
      submitLabel: 'Send',
      fields: ['name', 'email'],
      mode: 'inline',
    });
  });

  test('API-VSYNC-004 · pain / solution / benefits / cta 不在白名单 → 返回 null（不同步）', () => {
    expect(filterContentForSync('pain', { title: '...' })).toBeNull();
    expect(filterContentForSync('solution', { title: '...' })).toBeNull();
    expect(filterContentForSync('benefits', { title: '...' })).toBeNull();
    expect(filterContentForSync('cta', { headline: '...' })).toBeNull();
    expect(filterContentForSync('testimonial', { title: '...' })).toBeNull();
  });

  test('API-VSYNC-005 · hero 只改 headline → null（白名单字段都没动）', () => {
    expect(filterContentForSync('hero', { headline: 'Just a copy edit' })).toBeNull();
  });

  test('API-VSYNC-006 · mergeSyncedContent 合并新字段并保留旧字段', () => {
    const target: PageModule = {
      id: 'h-b',
      type: 'hero',
      enabled: true,
      content: {
        eyebrow: 'B Eyebrow',
        headline: 'B Headline',
        subhead: 'B Sub',
        primaryCta: 'B CTA',
        bullets: ['B-1'],
        layout: 'centered',
      } as any,
    };
    const merged = mergeSyncedContent(target, {
      media: { id: 'm', kind: 'image', url: 'x.png' },
      layout: 'split',
    });
    expect((merged.content as any).headline).toBe('B Headline'); // 保留 B 的 copy
    expect((merged.content as any).layout).toBe('split');         // 改用 A 同步过来的 layout
    expect((merged.content as any).media.url).toBe('x.png');     // 添加 A 同步过来的 media
    expect(merged.id).toBe('h-b');                                // id 不动
  });

  test('API-VSYNC-007 · findSyncTargetIndex 按 type 匹配，找不到返回 -1', () => {
    const otherMods: PageModule[] = [
      { id: 'h', type: 'hero', enabled: true, content: {} as any },
      { id: 'sp', type: 'socialProof', enabled: true, content: {} as any },
      { id: 'b', type: 'benefits', enabled: true, content: {} as any },
    ];
    expect(findSyncTargetIndex(otherMods, 'hero')).toBe(0);
    expect(findSyncTargetIndex(otherMods, 'socialProof')).toBe(1);
    expect(findSyncTargetIndex(otherMods, 'pain')).toBe(-1); // 另一 variant 没有 pain
  });

  test('API-VSYNC-008 · 空对象 / 非对象输入 → null', () => {
    expect(filterContentForSync('hero', {})).toBeNull();
    // @ts-expect-error testing runtime guard
    expect(filterContentForSync('hero', null)).toBeNull();
  });
});

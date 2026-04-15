import type { MediaRef, PageLocale, MarketCode } from './types';

/**
 * Resolve a MediaRef to a concrete URL for a given (locale, market).
 * Returns null if the asset is scoped to a market that doesn't match.
 */
export function resolveMedia(
  m: MediaRef | undefined | null,
  locale: PageLocale,
  market: MarketCode,
): { url: string; alt?: string } | null {
  if (!m) return null;
  if (m.scopedToMarkets?.length && !m.scopedToMarkets.includes(market)) {
    return null;
  }
  const url = m.localizedUrls?.[locale] ?? m.url;
  const alt = m.localizedAlts?.[locale] ?? m.alt;
  if (!url) return null;
  return { url, alt };
}

/**
 * Detect the kind of video URL so the renderer can pick the right embed.
 */
export function detectVideoHost(
  url: string,
): 'youtube' | 'vimeo' | 'loom' | 'mp4' | 'other' {
  const lower = url.toLowerCase();
  if (/youtu\.be|youtube\.com/.test(lower)) return 'youtube';
  if (/vimeo\.com/.test(lower)) return 'vimeo';
  if (/loom\.com/.test(lower)) return 'loom';
  if (/\.(mp4|webm|mov)(\?|$)/.test(lower)) return 'mp4';
  return 'other';
}

export function youtubeEmbedUrl(url: string): string {
  // https://youtu.be/XXX or https://youtube.com/watch?v=XXX or /embed/XXX
  const m =
    url.match(/youtu\.be\/([A-Za-z0-9_-]+)/) ||
    url.match(/[?&]v=([A-Za-z0-9_-]+)/) ||
    url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]+)/);
  const id = m?.[1];
  return id ? `https://www.youtube.com/embed/${id}` : url;
}

export function vimeoEmbedUrl(url: string): string {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m?.[1] ? `https://player.vimeo.com/video/${m[1]}` : url;
}

export function loomEmbedUrl(url: string): string {
  const m = url.match(/loom\.com\/share\/([A-Za-z0-9]+)/);
  return m?.[1] ? `https://www.loom.com/embed/${m[1]}` : url;
}

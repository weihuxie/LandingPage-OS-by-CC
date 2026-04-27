/**
 * Pure shape coercion for AssetLibrary (esp. BrandAsset.logos).
 *
 * 2026-04: BrandAsset.logos migrated from `string[]` (URL only) to
 * `LogoEntry[]` (MediaRef + showIn + label). Old KV blobs still hold the
 * URL-only shape; this module coerces on read so we don't need a
 * one-shot data migration and old data keeps working forever.
 *
 * Pulled out of storage.ts so tests can import the pure function without
 * pulling in KV / fs / nanoid wiring.
 */
import type { AssetLibrary, LogoEntry, MediaRef, PageLocale } from './types';

/**
 * Tiny in-process ID generator. Used when coercion needs to mint an ID
 * for legacy entries that don't have one. Not crypto-secure but fine
 * for ephemeral row identity in the editor; nanoid would be overkill.
 */
function localId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Coerce a single LogoEntry-ish input from any historical shape into
 * the current LogoEntry shape. Returns null when the input has no
 * usable URL — caller drops null entries.
 *
 * Supported inputs:
 *   "https://...png"                          → image LogoEntry
 *   { url: "..." }                            → image LogoEntry
 *   { id, media, label?, showIn? }            → kept as-is (validated)
 *   anything else                             → null
 */
export function coerceLogoEntry(entry: unknown): LogoEntry | null {
  if (typeof entry === 'string') {
    const url = entry.trim();
    if (!url) return null;
    return {
      id: localId(),
      media: { id: localId(), kind: 'image', url },
    };
  }
  if (entry && typeof entry === 'object') {
    const e = entry as Record<string, unknown>;
    // Already-current shape.
    if (e.media && typeof e.media === 'object') {
      const media = e.media as MediaRef;
      if (typeof media.url !== 'string' || !media.url.trim()) return null;
      return {
        id: typeof e.id === 'string' && e.id ? e.id : localId(),
        media,
        label: typeof e.label === 'string' ? e.label : undefined,
        showIn: Array.isArray(e.showIn)
          ? (e.showIn as PageLocale[])
          : undefined,
      };
    }
    // Half-migrated shape: bare {url} bag.
    if (typeof e.url === 'string' && e.url.trim()) {
      return {
        id: typeof e.id === 'string' && e.id ? e.id : localId(),
        media: { id: localId(), kind: 'image', url: e.url.trim() },
      };
    }
  }
  return null;
}

/**
 * Coerce an entire AssetLibrary blob's brand.logos into the current
 * shape. Idempotent — safe to call on already-migrated data. Returns a
 * NEW AssetLibrary object (never mutates input).
 */
export function coerceAssetsShape(lib: AssetLibrary): AssetLibrary {
  if (!lib?.brand) return lib;
  if (!Array.isArray(lib.brand.logos)) return lib;

  const coerced: LogoEntry[] = [];
  for (const raw of lib.brand.logos as unknown[]) {
    const ent = coerceLogoEntry(raw);
    if (ent) coerced.push(ent);
  }
  return { ...lib, brand: { ...lib.brand, logos: coerced } };
}

/**
 * Filter logos by current locale. Entry without showIn applies to all
 * locales; entry with non-empty showIn only matches when the current
 * locale is in the list. Used by BrandAssetLogoPicker in the module
 * editor (and would be used by socialProof renderers that pull from the
 * brand library — currently they pull from per-page logos array).
 */
export function logosForLocale(
  logos: LogoEntry[],
  locale: PageLocale,
): LogoEntry[] {
  return logos.filter((entry) => {
    if (!entry?.media?.url) return false;
    if (!entry.showIn || entry.showIn.length === 0) return true;
    return entry.showIn.includes(locale);
  });
}

/**
 * Resolve the URL to actually render for a LogoEntry given a locale.
 * Walks MediaRef.localizedUrls first (same logo, locale-specific URL),
 * falls back to base url. Returns empty string if neither is set.
 */
export function resolveLogoUrl(entry: LogoEntry, locale: PageLocale): string {
  return entry.media.localizedUrls?.[locale] ?? entry.media.url ?? '';
}

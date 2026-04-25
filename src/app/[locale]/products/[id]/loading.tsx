/**
 * Streamed during RSC fetch for the product detail route.
 *
 * Why this exists: without a loading.tsx, App Router keeps showing the
 * previous page (dashboard) until the RSC payload arrives — users click
 * a product card and stare at the dashboard for 300–800ms thinking the
 * click missed. The skeleton flips the visual state immediately so the
 * "did I actually click?" anxiety goes away even when KV is slow.
 *
 * Layout mirrors the real page (header strip + pages list block) so the
 * paint-to-paint shift is minimal — feels like the page filled in,
 * not like two different pages flashed.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="h-4 w-24 animate-pulse rounded bg-ink-100" />
      <div className="mt-2 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 animate-pulse rounded-xl bg-ink-100" />
            <div className="space-y-2">
              <div className="h-6 w-48 animate-pulse rounded bg-ink-100" />
              <div className="h-3 w-40 animate-pulse rounded bg-ink-100/70" />
            </div>
          </div>
          <div className="mt-3 h-3 w-96 max-w-full animate-pulse rounded bg-ink-100/70" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-9 w-28 animate-pulse rounded-lg bg-ink-100" />
          <div className="h-4 w-16 animate-pulse rounded bg-ink-100/70" />
        </div>
      </div>

      <div className="mt-8 space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl border border-ink-100 bg-ink-100/30"
          />
        ))}
      </div>

      <div className="mt-8 h-16 animate-pulse rounded-2xl border border-ink-100 bg-ink-100/20" />
    </div>
  );
}

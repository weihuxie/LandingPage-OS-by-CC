'use client';
import { useEffect } from 'react';

export default function TrackView({
  slug,
  variant,
  locale,
  referrer,
}: {
  slug: string;
  variant: 'A' | 'B';
  locale: string;
  referrer?: string;
}) {
  useEffect(() => {
    // Persist variant for sticky A/B
    document.cookie = `lp_v=${variant}; Max-Age=${60 * 60 * 24 * 30}; Path=/; SameSite=Lax`;

    // Fire view event once per session per slug
    const key = `lp_viewed_${slug}`;
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, variant, type: 'view', locale, referrer }),
        keepalive: true,
      }).catch(() => {});
    }
  }, [slug, variant, locale, referrer]);

  return null;
}

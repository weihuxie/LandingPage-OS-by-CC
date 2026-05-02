/**
 * API-LOC-DEGRADED-* · skip-polish persistent flag (Wave 2 #I).
 *
 * The from-scratch add-locale path may roll past OpenAI to a synthetic
 * skip-polish chain step (uses Claude hydrate output, no GPT polish).
 * Without persistence the only signal was a transient response banner
 * — closed and forgotten. We now persist `page.localizationDegraded`
 * as a per-locale list so the editor can re-display the warning on
 * every reload until the locale is re-added with normal polish.
 *
 * This spec exercises the data-shape rules of that list:
 *   - it accepts new locales when set
 *   - it deduplicates
 *   - clearing one locale doesn't clobber others
 *   - clearing the last locale collapses to undefined (matches "no flag")
 *
 * The actual /api/pages/[id]/locales POST flow needs LLM keys + KV +
 * dev server (covered by tests/api/locales.spec.ts when run with the
 * full stack). Here we test the pure data-shape code path that the
 * route handler executes.
 */
import { test, expect } from '@playwright/test';
import type { LandingPage, PageLocale } from '../../src/lib/types';

/**
 * Mirror of the route handler's degraded-flag block (Wave 2 #I).
 * Extracted as a pure helper so we can unit-test the rule without the
 * full route. The route itself uses the same logic inline.
 */
function applyLocalizationDegradedFlag(
  page: Pick<LandingPage, 'localizationDegraded'>,
  locale: PageLocale,
  skipPolish: boolean,
): PageLocale[] | undefined {
  const cur = page.localizationDegraded ?? [];
  if (skipPolish) {
    if (!cur.includes(locale)) return [...cur, locale];
    return cur;
  } else {
    const next = cur.filter((l) => l !== locale);
    return next.length ? next : undefined;
  }
}

test.describe('API-LOC-DEGRADED · localizationDegraded flag rules (Wave 2 #I)', () => {
  test('API-LOC-DEGRADED-001 · skip-polish on empty page sets the locale', () => {
    const next = applyLocalizationDegradedFlag({}, 'ja', true);
    expect(next).toEqual(['ja']);
  });

  test('API-LOC-DEGRADED-002 · skip-polish twice on same locale is idempotent', () => {
    const after1 = applyLocalizationDegradedFlag({}, 'ja', true);
    const after2 = applyLocalizationDegradedFlag(
      { localizationDegraded: after1 },
      'ja',
      true,
    );
    expect(after2).toEqual(['ja']); // not ['ja', 'ja']
  });

  test('API-LOC-DEGRADED-003 · skip-polish on different locales appends', () => {
    let flag = applyLocalizationDegradedFlag({}, 'ja', true);
    flag = applyLocalizationDegradedFlag({ localizationDegraded: flag }, 'en', true);
    expect(flag).toEqual(['ja', 'en']);
  });

  test('API-LOC-DEGRADED-004 · normal polish on flagged locale clears it', () => {
    const next = applyLocalizationDegradedFlag(
      { localizationDegraded: ['ja'] },
      'ja',
      false,
    );
    expect(next).toBeUndefined(); // collapsed (no other entries)
  });

  test('API-LOC-DEGRADED-005 · normal polish on one locale preserves others', () => {
    const next = applyLocalizationDegradedFlag(
      { localizationDegraded: ['ja', 'en'] },
      'ja',
      false,
    );
    expect(next).toEqual(['en']);
  });

  test('API-LOC-DEGRADED-006 · normal polish on never-flagged locale is no-op', () => {
    // Adding zh-CN with normal polish to a page that has ja flagged shouldn't
    // touch ja's flag.
    const next = applyLocalizationDegradedFlag(
      { localizationDegraded: ['ja'] },
      'zh-CN',
      false,
    );
    expect(next).toEqual(['ja']);
  });

  test('API-LOC-DEGRADED-007 · undefined flag stays undefined when normal polish runs', () => {
    const next = applyLocalizationDegradedFlag({}, 'zh-CN', false);
    expect(next).toBeUndefined();
  });
});

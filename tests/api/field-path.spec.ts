/**
 * API-FIELD-PATH-* · pure helper for judge-suggestion path application
 * (Phase 3 of judge agent).
 */
import { test, expect } from '@playwright/test';
import { applyFieldPath, parseFieldPath } from '../../src/lib/field-path';

test.describe('API-FIELD-PATH · parseFieldPath', () => {
  test('API-FIELD-PATH-001 · top-level field', () => {
    expect(parseFieldPath('headline')).toEqual({ field: 'headline' });
  });
  test('API-FIELD-PATH-002 · array element', () => {
    expect(parseFieldPath('bullets[2]')).toEqual({ field: 'bullets', index: 2 });
  });
  test('API-FIELD-PATH-003 · array element with sub-field', () => {
    expect(parseFieldPath('items[0].title')).toEqual({ field: 'items', index: 0, subField: 'title' });
  });
  test('API-FIELD-PATH-004 · invalid paths return null', () => {
    expect(parseFieldPath('content.deep.nested')).toBeNull();
    expect(parseFieldPath('items[].title')).toBeNull();
    expect(parseFieldPath('')).toBeNull();
    expect(parseFieldPath('items[abc]')).toBeNull();
  });
});

test.describe('API-FIELD-PATH · applyFieldPath', () => {
  test('API-FIELD-PATH-101 · top-level string replacement', () => {
    const r = applyFieldPath({ headline: 'old', subhead: 'keep' }, 'headline', 'new');
    expect(r).toEqual({ headline: 'new', subhead: 'keep' });
  });

  test('API-FIELD-PATH-102 · top-level non-string field returns null (anti-clobber)', () => {
    expect(applyFieldPath({ bullets: ['a', 'b'] }, 'bullets', 'replaces array')).toBeNull();
  });

  test('API-FIELD-PATH-103 · array string element', () => {
    const r = applyFieldPath({ bullets: ['a', 'b', 'c'] }, 'bullets[1]', 'B');
    expect(r).toEqual({ bullets: ['a', 'B', 'c'] });
  });

  test('API-FIELD-PATH-104 · out-of-range index returns null', () => {
    expect(applyFieldPath({ bullets: ['a'] }, 'bullets[5]', 'x')).toBeNull();
  });

  test('API-FIELD-PATH-105 · object array sub-field', () => {
    const r = applyFieldPath(
      { items: [{ title: 'old', body: 'keep' }, { title: 'second' }] },
      'items[0].title',
      'NEW',
    );
    expect(r).toEqual({ items: [{ title: 'NEW', body: 'keep' }, { title: 'second' }] });
  });

  test('API-FIELD-PATH-106 · sub-field non-string returns null', () => {
    expect(
      applyFieldPath(
        { items: [{ tags: ['x', 'y'] }] },
        'items[0].tags',
        'flat string',
      ),
    ).toBeNull();
  });

  test('API-FIELD-PATH-107 · invalid path syntax returns null', () => {
    expect(applyFieldPath({ headline: 'x' }, 'headline.deep', 'y')).toBeNull();
  });

  test('API-FIELD-PATH-108 · returns NEW object (immutability)', () => {
    const src = { headline: 'old', bullets: ['a', 'b'] };
    const r = applyFieldPath(src, 'headline', 'new')!;
    expect(r).not.toBe(src);
    expect(src.headline).toBe('old'); // source unchanged
  });
});

/**
 * API-LOC-MERGE-* · `mergeLocalizedContent` array-shrink defense (Wave 3 #B).
 *
 * GPT-4o sometimes returns a length-sensitive array (bullets / items /
 * stats / logos / fields) shorter than the source. The old shallow merge
 * `{ ...source, ...parsed }` would silently overwrite the longer source
 * with GPT's shorter version, so a hero with [A,B,C] bullets lost a
 * bullet on the localized page with no signal anywhere.
 *
 * The new helper compares per-type-known length-sensitive fields and
 * preserves the source array when GPT shrank it. Equal length and longer
 * (e.g. GPT split a bullet into two for clarity) are accepted as
 * legitimate edits.
 */
import { test, expect } from '@playwright/test';
import { mergeLocalizedContent } from '../../src/lib/llm-openai';

test.describe('API-LOC-MERGE · length-sensitive array preservation (Wave 3 #B)', () => {
  test('API-LOC-MERGE-001 · hero.bullets shrunk → source preserved + flagged', () => {
    const src = { headline: 'Old', bullets: ['A', 'B', 'C'] };
    const parsed = { headline: '新', bullets: ['Aja', 'Cja'] }; // dropped B
    const r = mergeLocalizedContent('hero', src, parsed);
    expect(r.preservedFields).toEqual(['bullets']);
    expect(r.content.headline).toBe('新'); // headline still localized
    expect(r.content.bullets).toEqual(['A', 'B', 'C']); // source kept
  });

  test('API-LOC-MERGE-002 · same-length array accepted (legit translation)', () => {
    const src = { bullets: ['A', 'B', 'C'] };
    const parsed = { bullets: ['Aja', 'Bja', 'Cja'] };
    const r = mergeLocalizedContent('hero', src, parsed);
    expect(r.preservedFields).toEqual([]);
    expect(r.content.bullets).toEqual(['Aja', 'Bja', 'Cja']);
  });

  test('API-LOC-MERGE-003 · longer array accepted (GPT split a bullet)', () => {
    const src = { bullets: ['Long single bullet'] };
    const parsed = { bullets: ['Part 1', 'Part 2'] };
    const r = mergeLocalizedContent('hero', src, parsed);
    expect(r.preservedFields).toEqual([]);
    expect(r.content.bullets).toEqual(['Part 1', 'Part 2']);
  });

  test('API-LOC-MERGE-004 · benefits.items shrunk → source preserved', () => {
    const src = {
      title: 'Why',
      items: [
        { title: 'Fast', body: 'a' },
        { title: 'Cheap', body: 'b' },
        { title: 'Reliable', body: 'c' },
      ],
    };
    const parsed = {
      title: 'なぜ',
      items: [
        { title: '速い', body: 'a-ja' },
        { title: '信頼', body: 'c-ja' },
      ],
    };
    const r = mergeLocalizedContent('benefits', src, parsed);
    expect(r.preservedFields).toEqual(['items']);
    expect(r.content.title).toBe('なぜ');
    expect((r.content.items as unknown[]).length).toBe(3); // source items kept
  });

  test('API-LOC-MERGE-005 · multiple fields independently checked', () => {
    const src = {
      logos: ['Acme', 'Globex', 'Hooli'],
      stats: [
        { label: 'Teams', value: '1000+' },
        { label: 'ROI', value: '3x' },
      ],
    };
    // GPT shrinks logos but accepts stats
    const parsed = {
      logos: ['Acme', 'Hooli'],
      stats: [
        { label: 'チーム', value: '1000+' },
        { label: 'ROI', value: '3x' },
      ],
    };
    const r = mergeLocalizedContent('socialProof', src, parsed);
    expect(r.preservedFields).toEqual(['logos']);
    expect((r.content.logos as unknown[]).length).toBe(3);
    expect((r.content.stats as unknown[]).length).toBe(2);
    expect((r.content.stats as Array<{ label: string }>)[0].label).toBe('チーム');
  });

  test('API-LOC-MERGE-006 · GPT misses an array entirely → source preserved', () => {
    // GPT returned an object without the bullets key at all.
    const src = { headline: 'Old', bullets: ['A', 'B'] };
    const parsed = { headline: '新' };
    const r = mergeLocalizedContent('hero', src, parsed);
    // preservedFields empty because parsed had no bullets to compare;
    // shallow merge naturally preserves source.
    expect(r.preservedFields).toEqual([]);
    expect(r.content.bullets).toEqual(['A', 'B']);
  });

  test('API-LOC-MERGE-007 · type with no length-sensitive fields → no preservation logic fires', () => {
    // solution has no array fields in our table.
    const src = { title: 'Old', body: 'Long text' };
    const parsed = { title: '新', body: '日本語テキスト' };
    const r = mergeLocalizedContent('solution', src, parsed);
    expect(r.preservedFields).toEqual([]);
    expect(r.content).toEqual({ title: '新', body: '日本語テキスト' });
  });
});

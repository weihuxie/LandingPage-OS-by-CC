/**
 * API-FILE-* · extractFileText unit tests.
 *
 * Covers from audit-2026-05.md §3.11:
 *   401  .txt → text (sanitized)
 *   402  .md → text
 *   403  .csv → text
 *   404  real .pdf fixture → non-empty text
 *   405  real .docx fixture → non-empty text
 *   406  broken .pdf (empty buffer) → null (catch swallows)
 *   407  .pptx → null (unsupported MVP)
 *   408  no extension 'README' → null
 *   409  text with `\r\n\r\n\r\n` → sanitize collapses to `\n\n`
 *   410  text 60K → truncated to 50K
 *   411  all-whitespace text → '' (trim)
 *   412  uppercase extension `.PDF` → routes via toLowerCase
 *
 * PDF + DOCX fixtures are copied from upstream package test data into
 * tests/fixtures/ — keeps the spec self-contained and stable across
 * package reinstalls.
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import path from 'path';
import { extractFileText } from '../../src/lib/file-read';

const FIXTURES = path.resolve(__dirname, '../fixtures');

test.describe('API-FILE · plain-text formats', () => {

  test('API-FILE-401 · .txt → text (sanitized)', async () => {
    const buf = Buffer.from('hello\nworld');
    const out = await extractFileText(buf, 'note.txt');
    expect(out).toBe('hello\nworld');
  });

  test('API-FILE-402 · .md → text', async () => {
    const buf = Buffer.from('# Heading\n\nbody text');
    const out = await extractFileText(buf, 'doc.md');
    expect(out).toBe('# Heading\n\nbody text');
  });

  test('API-FILE-403 · .csv → text (raw, NOT parsed)', async () => {
    const buf = Buffer.from('a,b,c\n1,2,3\n4,5,6');
    const out = await extractFileText(buf, 'data.csv');
    // sanitize trims trailing newlines but keeps internal commas as-is —
    // we don't parse CSV here, only extract raw text.
    expect(out).toContain('a,b,c');
    expect(out).toContain('4,5,6');
  });
});

test.describe('API-FILE · binary formats with real fixtures', () => {

  test('API-FILE-404 · .pdf real fixture → non-empty extracted text', async () => {
    const buf = await fs.readFile(path.join(FIXTURES, 'sample.pdf'));
    const out = await extractFileText(buf, 'sample.pdf');
    expect(out).not.toBeNull();
    // Don't pin exact text — pdf-parse output depends on the upstream
    // sample document content. Just confirm we got real extracted text
    // (not an empty string from a degenerate parse).
    expect(out!.length).toBeGreaterThan(50);
    // sanitize() caps at 50KB; should be well under for the test fixture.
    expect(out!.length).toBeLessThanOrEqual(50_000);
  });

  test('API-FILE-405 · .docx real fixture → non-empty extracted text', async () => {
    const buf = await fs.readFile(path.join(FIXTURES, 'sample.docx'));
    const out = await extractFileText(buf, 'sample.docx');
    expect(out).not.toBeNull();
    expect(out!.length).toBeGreaterThan(0);
  });

  test('API-FILE-412 · uppercase extension `.PDF` routes via toLowerCase', async () => {
    const buf = await fs.readFile(path.join(FIXTURES, 'sample.pdf'));
    const out = await extractFileText(buf, 'SAMPLE.PDF');
    expect(out).not.toBeNull();
    expect(out!.length).toBeGreaterThan(50);
  });
});

test.describe('API-FILE · failure + unsupported paths', () => {

  test('API-FILE-406 · broken .pdf (empty buffer) → null (catch swallows)', async () => {
    const out = await extractFileText(Buffer.alloc(0), 'corrupt.pdf');
    // pdf-parse throws on an empty / invalid buffer; the wrapper's
    // try/catch returns null (UI surfaces "unsupported-or-empty").
    expect(out).toBeNull();
  });

  test('API-FILE-406b · garbage bytes with .docx extension → null', async () => {
    const out = await extractFileText(Buffer.from('not actually a docx'), 'fake.docx');
    expect(out).toBeNull();
  });

  test('API-FILE-407 · .pptx → null (MVP unsupported)', async () => {
    const out = await extractFileText(Buffer.from('whatever'), 'deck.pptx');
    expect(out).toBeNull();
  });

  test('API-FILE-408 · no extension → null', async () => {
    const out = await extractFileText(Buffer.from('whatever'), 'README');
    expect(out).toBeNull();
  });
});

test.describe('API-FILE · sanitize() side effects (observed via .txt path)', () => {

  test('API-FILE-409 · `\\r\\n\\r\\n\\r\\n` → collapsed to `\\n\\n`', async () => {
    const buf = Buffer.from('line1\r\n\r\n\r\nline2');
    const out = await extractFileText(buf, 'crlf.txt');
    expect(out).toBe('line1\n\nline2');
  });

  test('API-FILE-410 · 60K text → truncated to 50K cap', async () => {
    const big = 'a'.repeat(60_000);
    const out = await extractFileText(Buffer.from(big), 'huge.txt');
    expect(out).not.toBeNull();
    expect(out!.length).toBe(50_000);
  });

  test('API-FILE-411 · all whitespace → empty string (trim)', async () => {
    const out = await extractFileText(Buffer.from('   \n\n\t\t   '), 'blank.txt');
    expect(out).toBe('');
  });

  test('API-FILE-409b · `\\r\\n` (single newline pair) → `\\n` (no collapse below threshold)', async () => {
    // sanitize only collapses 3-or-more newlines to 2; 1-2 newlines are
    // preserved. This guards the regex `{3,}` boundary.
    const out = await extractFileText(Buffer.from('line1\r\nline2\r\nline3'), 'lines.txt');
    expect(out).toBe('line1\nline2\nline3');
  });
});

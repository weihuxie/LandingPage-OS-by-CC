/**
 * API-EXTRACT-JSON-* · `extractJsonObject` diagnostic logging (Wave 2 #E).
 *
 * Function still returns null on failure (caller behavior preserved), but
 * each failure path now console.warn's enough context for ops to locate
 * the breakage in Vercel logs without enabling verbose Anthropic SDK logs.
 *
 * Tests assert:
 *   1. Happy paths still return the parsed object (no regression)
 *   2. Each failure path logs (we capture console.warn)
 *   3. The log carries the right kind of context (length / head / position)
 */
import { test, expect } from '@playwright/test';
import { extractJsonObject } from '../../src/lib/llm-claude';

function captureWarns<T>(fn: () => T): { result: T; warns: string[] } {
  const orig = console.warn;
  const warns: string[] = [];
  console.warn = (...args: unknown[]) => {
    warns.push(args.map((a) => String(a)).join(' '));
  };
  try {
    return { result: fn(), warns };
  } finally {
    console.warn = orig;
  }
}

test.describe('API-EXTRACT-JSON · happy paths (no regression)', () => {
  test('API-EXTRACT-JSON-001 · plain JSON parses', () => {
    const { result, warns } = captureWarns(() =>
      extractJsonObject<{ a: number }>('{"a":1}'),
    );
    expect(result).toEqual({ a: 1 });
    expect(warns).toHaveLength(0);
  });

  test('API-EXTRACT-JSON-002 · fenced JSON parses', () => {
    const { result } = captureWarns(() =>
      extractJsonObject<{ a: number }>('```json\n{"a":2}\n```'),
    );
    expect(result).toEqual({ a: 2 });
  });

  test('API-EXTRACT-JSON-003 · prose-prefixed JSON parses via balanced-brace', () => {
    const { result } = captureWarns(() =>
      extractJsonObject<{ a: number }>('Here is the JSON: {"a":3}'),
    );
    expect(result).toEqual({ a: 3 });
  });
});

test.describe('API-EXTRACT-JSON · failure diagnostics (Wave 2 #E)', () => {
  test('API-EXTRACT-JSON-101 · empty input logs + returns null', () => {
    const { result, warns } = captureWarns(() => extractJsonObject(''));
    expect(result).toBeNull();
    expect(warns.some((w) => w.includes('empty input'))).toBe(true);
  });

  test('API-EXTRACT-JSON-102 · no `{` logs full length + head/tail context', () => {
    const text = 'a'.repeat(8000) + ' no json here ' + 'b'.repeat(2000);
    const { result, warns } = captureWarns(() => extractJsonObject(text));
    expect(result).toBeNull();
    const w = warns.join(' ');
    expect(w).toMatch(/no '\{'/);
    expect(w).toContain(`${text.length}-char`);
    // Both head and tail context present
    expect(w).toContain('head=');
    expect(w).toContain('tail=');
  });

  test('API-EXTRACT-JSON-103 · broken JSON inside braces logs error + position context', () => {
    // Broken: unescaped quote inside a string value.
    // V8 reports the parse position; we expect a HERE marker around it.
    const broken = 'preface {"key": "value with "unescaped" inner quote"}';
    const { result, warns } = captureWarns(() => extractJsonObject(broken));
    expect(result).toBeNull();
    const w = warns.join(' ');
    expect(w).toMatch(/failed JSON\.parse/);
    expect(w).toContain('context=');
    // Either has HERE marker (modern V8) or fallback first-400 context.
    expect(w).toMatch(/⟪HERE⟫|context="\\?"\{/);
  });

  test('API-EXTRACT-JSON-104 · unbalanced braces logs depth + start position', () => {
    // Opens 3 braces, closes 1 — depth never returns to 0.
    const text = 'before {{ {  "a": 1 } never closed';
    const { result, warns } = captureWarns(() => extractJsonObject(text));
    expect(result).toBeNull();
    const w = warns.join(' ');
    expect(w).toMatch(/unbalanced braces/);
    expect(w).toMatch(/final depth=\d+/);
  });
});

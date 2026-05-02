/**
 * API-JUDGE-ROUTE-* · cross-family judge provider routing (Phase 1b).
 *
 * Validates pickJudgeProvider's behavior:
 *   1. Generator known + cross-family key present → use cross
 *   2. Generator known + only same-family key → use same + flag warning
 *   3. Generator unknown → use copy chain[0] heuristic
 *   4. Neither key → throws LLMRequiredError
 *
 * The athlete-referee separation rests on this routing being correct.
 * Tests run in-process with env-mutation, no LLM calls.
 */
import { test, expect } from '@playwright/test';
import { pickJudgeProvider } from '../../src/lib/judge';
import { LLMRequiredError } from '../../src/lib/errors';

const SAVED_CLAUDE = process.env.ANTHROPIC_API_KEY;
const SAVED_DEEPSEEK = process.env.DEEPSEEK_API_KEY;

function setKeys(claude: boolean, deepseek: boolean) {
  if (claude) process.env.ANTHROPIC_API_KEY = SAVED_CLAUDE || 'test-key-claude';
  else delete process.env.ANTHROPIC_API_KEY;
  if (deepseek) process.env.DEEPSEEK_API_KEY = SAVED_DEEPSEEK || 'test-key-deepseek';
  else delete process.env.DEEPSEEK_API_KEY;
}

test.afterEach(() => {
  // Restore original env so other specs aren't polluted.
  if (SAVED_CLAUDE) process.env.ANTHROPIC_API_KEY = SAVED_CLAUDE;
  else delete process.env.ANTHROPIC_API_KEY;
  if (SAVED_DEEPSEEK) process.env.DEEPSEEK_API_KEY = SAVED_DEEPSEEK;
  else delete process.env.DEEPSEEK_API_KEY;
});

test.describe('API-JUDGE-ROUTE · cross-family judge picking', () => {
  test('API-JUDGE-ROUTE-001 · generator=claude + both keys → judge=deepseek (cross)', async () => {
    setKeys(true, true);
    const choice = await pickJudgeProvider('claude', 'zh-CN');
    expect(choice.provider).toBe('deepseek');
    expect(choice.sameFamilyWarning).toBe(false);
    expect(choice.model.length).toBeGreaterThan(0);
  });

  test('API-JUDGE-ROUTE-002 · generator=deepseek + both keys → judge=claude (cross)', async () => {
    setKeys(true, true);
    const choice = await pickJudgeProvider('deepseek', 'zh-CN');
    expect(choice.provider).toBe('claude');
    expect(choice.sameFamilyWarning).toBe(false);
  });

  test('API-JUDGE-ROUTE-101 · generator=claude + only claude key → same-family warning', async () => {
    setKeys(true, false);
    const choice = await pickJudgeProvider('claude', 'zh-CN');
    expect(choice.provider).toBe('claude');
    expect(choice.sameFamilyWarning).toBe(true);
  });

  test('API-JUDGE-ROUTE-102 · generator=deepseek + only deepseek key → same-family warning', async () => {
    setKeys(false, true);
    const choice = await pickJudgeProvider('deepseek', 'zh-CN');
    expect(choice.provider).toBe('deepseek');
    expect(choice.sameFamilyWarning).toBe(true);
  });

  test('API-JUDGE-ROUTE-103 · generator=claude + only deepseek key → cross still works (no warning)', async () => {
    setKeys(false, true);
    const choice = await pickJudgeProvider('claude', 'zh-CN');
    expect(choice.provider).toBe('deepseek');
    expect(choice.sameFamilyWarning).toBe(false);
  });

  test('API-JUDGE-ROUTE-201 · neither key → LLMRequiredError', async () => {
    setKeys(false, false);
    await expect(pickJudgeProvider('claude', 'zh-CN')).rejects.toThrow(LLMRequiredError);
  });

  test('API-JUDGE-ROUTE-301 · generator unknown + both keys → falls back to copy primary cross', async () => {
    setKeys(true, true);
    // copy primary in DEFAULT_LLM_CONFIG is deepseek (chain[0]); cross is claude.
    const choice = await pickJudgeProvider(undefined, 'zh-CN');
    expect(choice.provider).toBe('claude');
    expect(choice.sameFamilyWarning).toBe(false);
  });
});

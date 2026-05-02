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

test.describe('API-JUDGE-ROUTE · admin-chain-driven judge picking', () => {
  // DEFAULT_LLM_CONFIG.scenarios.judge.chain = [claude, deepseek]
  // (opposite of copy default = [deepseek, claude]) — so the default
  // out-of-the-box behavior is cross-family vs default copy.
  test('API-JUDGE-ROUTE-001 · gen=deepseek + default chain (claude first) → cross to claude', async () => {
    setKeys(true, true);
    const choice = await pickJudgeProvider('deepseek', 'zh-CN');
    expect(choice.provider).toBe('claude');
    expect(choice.sameFamilyWarning).toBe(false);
  });

  test('API-JUDGE-ROUTE-002 · gen=claude + default chain (claude first) → same-family WARNING (admin can flip in /admin/llm)', async () => {
    setKeys(true, true);
    const choice = await pickJudgeProvider('claude', 'zh-CN');
    // Admin chose claude as primary; we honor that even when gen=claude.
    // The warning surfaces in the editor drawer so admin sees the cost.
    expect(choice.provider).toBe('claude');
    expect(choice.sameFamilyWarning).toBe(true);
  });

  test('API-JUDGE-ROUTE-101 · gen=claude + only claude key → falls to claude with warning', async () => {
    setKeys(true, false);
    const choice = await pickJudgeProvider('claude', 'zh-CN');
    expect(choice.provider).toBe('claude');
    expect(choice.sameFamilyWarning).toBe(true);
  });

  test('API-JUDGE-ROUTE-102 · gen=deepseek + only deepseek key → chain promotes past claude (no key) to deepseek', async () => {
    setKeys(false, true);
    const choice = await pickJudgeProvider('deepseek', 'zh-CN');
    expect(choice.provider).toBe('deepseek');
    expect(choice.sameFamilyWarning).toBe(true);
  });

  test('API-JUDGE-ROUTE-103 · gen=claude + only deepseek key → chain promotes to deepseek (cross, no warning)', async () => {
    setKeys(false, true);
    const choice = await pickJudgeProvider('claude', 'zh-CN');
    expect(choice.provider).toBe('deepseek');
    expect(choice.sameFamilyWarning).toBe(false);
  });

  test('API-JUDGE-ROUTE-201 · neither key → LLMRequiredError', async () => {
    setKeys(false, false);
    await expect(pickJudgeProvider('claude', 'zh-CN')).rejects.toThrow(LLMRequiredError);
  });

  test('API-JUDGE-ROUTE-301 · gen unknown + default chain → uses chain[0] (claude); generator inferred from copy (deepseek) → cross', async () => {
    setKeys(true, true);
    const choice = await pickJudgeProvider(undefined, 'zh-CN');
    // gen unknown → look up copy.chain[0] = deepseek. judge.chain[0] = claude.
    // claude != deepseek → cross-family.
    expect(choice.provider).toBe('claude');
    expect(choice.sameFamilyWarning).toBe(false);
  });
});

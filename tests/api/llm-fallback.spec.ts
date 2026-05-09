/**
 * API-FALLBACK-* · executeScenario chain walk tests.
 *
 * Covers from audit-2026-05.md §2.2:
 *   401  happy path zero-cost (chain[0] success → no hops)
 *   402  429-quota → promote, deepseek wins
 *   403  4xx-auth → short-circuit
 *   404  4xx-other → short-circuit
 *   405  429-rate not in triggers → short-circuit
 *   406  primary key missing → LLMRequiredError (covers 2026-05 bug fix)
 *   407  every step missing key → LLMRequiredError, missing=chain[0] env
 *   408  executor throws LLMRequiredError → propagate untouched
 *   409  policy.enabled=false → LLMRequiredError
 *   410  chain.length===0 → LLMRequiredError
 *   411  step.mode='skip-polish' + no key → NOT skipped (synthetic step)
 *   412  3-step chain, two 5xx → final success, hops.length===2
 *   413  network classified → triggered when '5xx' in triggers
 *   414  network classified → short-circuit when '5xx' not in triggers
 *   415  scenario='localize' all-skip → feature='localize-gpt' on error
 *
 * Test strategy: write a `LLMConfig` fixture to `.data/v2-llm-config.json`
 * before each test (executeScenario reads it via readLLMConfig() in
 * local-dev mode), drive executor behavior with synthetic errors, and
 * inspect the resulting FallbackOutcome / thrown error type.
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import path from 'path';
import { executeScenario, NoAdapterSkipError } from '../../src/lib/llm-fallback';
import type { LLMConfig, ScenarioStep } from '../../src/lib/llm-config';
import { LLMRequiredError } from '../../src/lib/errors';

const CONFIG_FILE = path.join(process.cwd(), '.data', 'v2-llm-config.json');

async function writeConfig(cfg: LLMConfig): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

async function clearConfig(): Promise<void> {
  await fs.unlink(CONFIG_FILE).catch(() => {});
}

/**
 * Make a minimal valid LLMConfig where ALL scenarios share `chain` and
 * `triggers`. Tests only exercise one scenario at a time so duplicating
 * across the map is fine and keeps the fixture short.
 */
function makeConfig(opts: {
  chain: ScenarioStep[];
  triggers?: ('429-quota' | '429-rate' | '5xx')[];
  enabled?: boolean;
}): LLMConfig {
  const policy = {
    enabled: opts.enabled ?? true,
    chain: opts.chain,
    triggers: opts.triggers ?? ['429-quota', '5xx'],
  };
  return {
    version: 2,
    scenarios: {
      strategy: policy,
      copy: policy,
      localize: policy,
      extract: policy,
      judge: policy,
    },
  };
}

/**
 * A non-empty filler policy that satisfies mergeWithDefaults' `isPolicy`
 * check, used when only ONE scenario in the fixture should carry the
 * test-specific shape (the others must be valid or merge will reset
 * them and silently mask the test target).
 */
const DEFAULT_FILLER = {
  enabled: true,
  chain: [{ provider: 'claude', model: 'claude-haiku-4-5' }],
  triggers: ['5xx'],
};

/** Fake all 4 LLM keys so `hasKey()` doesn't skip steps. */
function setAllKeys() {
  process.env.ANTHROPIC_API_KEY = 'fake-anthropic';
  process.env.DEEPSEEK_API_KEY = 'fake-deepseek';
  process.env.OPENAI_API_KEY = 'fake-openai';
  process.env.GOOGLE_API_KEY = 'fake-google';
}

function clearAllKeys() {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
}

test.describe('API-FALLBACK · executeScenario chain walk', () => {

  let savedKeys: Record<string, string | undefined>;

  test.beforeEach(async () => {
    savedKeys = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    };
    await clearConfig();
  });

  test.afterEach(async () => {
    for (const [k, v] of Object.entries(savedKeys)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await clearConfig();
  });

  test('API-FALLBACK-401 · happy path: chain[0] success → no hops, zero overhead', async () => {
    setAllKeys();
    await writeConfig(makeConfig({ chain: [{ provider: 'claude', model: 'claude-haiku-4-5' }] }));
    const out = await executeScenario('copy', 'en', async (step) => {
      return { used: step.provider, model: step.model };
    });
    expect(out.usedStep.provider).toBe('claude');
    expect(out.usedStep.model).toBe('claude-haiku-4-5');
    expect(out.hops).toEqual([]);
    expect(out.result).toEqual({ used: 'claude', model: 'claude-haiku-4-5' });
  });

  test('API-FALLBACK-402 · 429-quota promotes to fallback step', async () => {
    setAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'claude', model: 'claude-opus-4-20250514' },
          { provider: 'deepseek', model: 'deepseek-chat' },
        ],
      }),
    );
    let calls = 0;
    const out = await executeScenario('copy', 'en', async (step) => {
      calls++;
      if (step.provider === 'claude') {
        // Synthetic 429-quota: status 429 + 'quota' in message.
        const e = Object.assign(new Error('You exceeded your current quota'), { status: 429 });
        throw e;
      }
      return { used: step.provider };
    });
    expect(calls).toBe(2);
    expect(out.usedStep.provider).toBe('deepseek');
    expect(out.hops.length).toBe(1);
    expect(out.hops[0].provider).toBe('claude');
    expect(out.hops[0].errorClass).toBe('429-quota');
  });

  test('API-FALLBACK-403 · 4xx-auth short-circuits chain', async () => {
    setAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'claude', model: 'm1' },
          { provider: 'deepseek', model: 'm2' },
        ],
      }),
    );
    let calls = 0;
    const authErr = Object.assign(new Error('invalid api key'), { status: 401 });
    let caught: unknown = null;
    try {
      await executeScenario('copy', 'en', async () => {
        calls++;
        throw authErr;
      });
    } catch (e) {
      caught = e;
    }
    // 4xx-auth on the same input would re-fail on every provider — the
    // chain is supposed to short-circuit and propagate the original error.
    expect(calls).toBe(1);
    expect(caught).toBe(authErr);
  });

  test('API-FALLBACK-404 · 4xx-other short-circuits chain', async () => {
    setAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'claude', model: 'm1' },
          { provider: 'deepseek', model: 'm2' },
        ],
      }),
    );
    let calls = 0;
    // 422 with no quota keywords → 4xx-other → bail.
    const promptErr = Object.assign(new Error('prompt is too long'), { status: 422 });
    await expect(
      executeScenario('copy', 'en', async () => {
        calls++;
        throw promptErr;
      }),
    ).rejects.toBe(promptErr);
    expect(calls).toBe(1);
  });

  test('API-FALLBACK-405 · 429-rate not in triggers → short-circuit', async () => {
    setAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'claude', model: 'm1' },
          { provider: 'deepseek', model: 'm2' },
        ],
        triggers: ['429-quota', '5xx'], // explicitly no '429-rate'
      }),
    );
    let calls = 0;
    // status 429 + 'rate' in message → classified 429-rate (not in triggers).
    const rateErr = Object.assign(new Error('rate limit, please slow down'), { status: 429 });
    await expect(
      executeScenario('copy', 'en', async () => {
        calls++;
        throw rateErr;
      }),
    ).rejects.toBe(rateErr);
    expect(calls).toBe(1);
  });

  test('API-FALLBACK-406 · primary missing key → LLMRequiredError (single-step chain)', async () => {
    clearAllKeys();
    await writeConfig(makeConfig({ chain: [{ provider: 'claude', model: 'm1' }] }));
    let caught: unknown = null;
    try {
      await executeScenario('copy', 'en', async () => 'should-not-fire');
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof LLMRequiredError).toBe(true);
    // 2026-05 bug fix: when every step is skipped due to missing key,
    // the orchestrator must surface LLMRequiredError (HTTP 503), NOT a
    // generic Error mapped to 500.
    expect((caught as LLMRequiredError).missing).toBe('ANTHROPIC_API_KEY');
  });

  test('API-FALLBACK-407 · all keys missing across chain → LLMRequiredError reports chain[0]', async () => {
    clearAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'claude', model: 'm1' },
          { provider: 'deepseek', model: 'm2' },
          { provider: 'openai', model: 'm3' },
        ],
      }),
    );
    let caught: unknown = null;
    try {
      await executeScenario('copy', 'en', async () => 'never');
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof LLMRequiredError).toBe(true);
    // chain[0] is claude → reports the most-actionable missing key first.
    expect((caught as LLMRequiredError).missing).toBe('ANTHROPIC_API_KEY');
  });

  test('API-FALLBACK-408 · executor throws LLMRequiredError → propagate untouched (not wrapped)', async () => {
    setAllKeys();
    await writeConfig(makeConfig({ chain: [{ provider: 'claude', model: 'm1' }] }));
    const inner = new LLMRequiredError('module-regen', 'ANTHROPIC_API_KEY', 'inner missing');
    let caught: unknown = null;
    try {
      await executeScenario('copy', 'en', async () => {
        throw inner;
      });
    } catch (e) {
      caught = e;
    }
    // Identity check: the orchestrator must NOT wrap our typed error
    // (would mask the missing-key state from the route handler).
    expect(caught).toBe(inner);
  });

  test('API-FALLBACK-409 · policy.enabled=false → LLMRequiredError ("disabled")', async () => {
    setAllKeys();
    await writeConfig(
      makeConfig({
        chain: [{ provider: 'claude', model: 'm1' }],
        enabled: false,
      }),
    );
    let caught: unknown = null;
    try {
      await executeScenario('copy', 'en', async () => 'never');
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof LLMRequiredError).toBe(true);
    expect((caught as LLMRequiredError).message).toContain('disabled');
  });

  test('API-FALLBACK-410 · chain.length===0 → LLMRequiredError ("empty")', async () => {
    setAllKeys();
    // Bypass validateLLMConfig (which rejects empty chains) by writing
    // directly. mergeWithDefaults validates `strategy`/`copy` via isPolicy
    // (empty chain → fall back to defaults), but `localize`/`extract`/
    // `judge` use raw `??` and pass through any shape — so we use one of
    // those to actually surface the empty chain to executeScenario, which
    // has its own defense for that case (the 410 contract).
    await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
    await fs.writeFile(
      CONFIG_FILE,
      JSON.stringify({
        version: 2,
        scenarios: {
          strategy: DEFAULT_FILLER,
          copy: DEFAULT_FILLER,
          localize: { enabled: true, chain: [], triggers: ['5xx'] },
          extract: DEFAULT_FILLER,
          judge: DEFAULT_FILLER,
        },
      }),
    );
    let caught: unknown = null;
    try {
      await executeScenario('localize', 'en', async () => 'never');
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof LLMRequiredError).toBe(true);
    expect((caught as LLMRequiredError).message).toContain('empty');
  });

  test('API-FALLBACK-411 · skip-polish step + no key → does NOT skip (synthetic step)', async () => {
    // Only ANTHROPIC key removed; the skip-polish step still has to run
    // because its contract is "no API call — return a synthetic value".
    delete process.env.ANTHROPIC_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'fake';
    process.env.OPENAI_API_KEY = 'fake';
    await writeConfig(
      makeConfig({
        chain: [
          // skip-polish marked with 'claude' provider for source attribution
          // even though no Claude API call happens; per llm-config.ts comment.
          { provider: 'claude', model: 'm1', mode: 'skip-polish' },
        ],
      }),
    );
    const out = await executeScenario('localize', 'ja', async (step) => {
      // Executor receives the skip-polish step and decides what to do.
      // For this test we assert it was *invoked* despite missing claude key.
      return { mode: step.mode, providerSeen: step.provider };
    });
    expect(out.result).toEqual({ mode: 'skip-polish', providerSeen: 'claude' });
    expect(out.hops).toEqual([]);
  });

  test('API-FALLBACK-412 · 3-step chain: two 5xx then success → 2 hops', async () => {
    setAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'claude', model: 'm1' },
          { provider: 'deepseek', model: 'm2' },
          { provider: 'openai', model: 'm3' },
        ],
        triggers: ['5xx', '429-quota'],
      }),
    );
    const out = await executeScenario('copy', 'en', async (step) => {
      if (step.provider === 'claude' || step.provider === 'deepseek') {
        const e = Object.assign(new Error('upstream 503'), { status: 503 });
        throw e;
      }
      return { used: step.provider };
    });
    expect(out.usedStep.provider).toBe('openai');
    expect(out.hops.length).toBe(2);
    expect(out.hops.map((h) => h.provider)).toEqual(['claude', 'deepseek']);
    for (const h of out.hops) expect(h.errorClass).toBe('5xx');
  });

  test('API-FALLBACK-413 · network error + "5xx" in triggers → continues to next step', async () => {
    setAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'claude', model: 'm1' },
          { provider: 'deepseek', model: 'm2' },
        ],
        triggers: ['5xx'], // network is treated as 5xx by isTriggered()
      }),
    );
    const out = await executeScenario('copy', 'en', async (step) => {
      if (step.provider === 'claude') {
        // No status field → classifier returns 'network'.
        throw new Error('ECONNRESET');
      }
      return { used: step.provider };
    });
    expect(out.usedStep.provider).toBe('deepseek');
    expect(out.hops.length).toBe(1);
    expect(out.hops[0].errorClass).toBe('network');
  });

  test('API-FALLBACK-414 · network error + "5xx" NOT in triggers → short-circuit', async () => {
    setAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'claude', model: 'm1' },
          { provider: 'deepseek', model: 'm2' },
        ],
        triggers: ['429-quota'], // intentionally no '5xx'
      }),
    );
    let calls = 0;
    const netErr = new Error('network down');
    await expect(
      executeScenario('copy', 'en', async () => {
        calls++;
        throw netErr;
      }),
    ).rejects.toBe(netErr);
    expect(calls).toBe(1);
  });

  test('API-FALLBACK-415 · scenario="localize" + all-skipped → feature="localize-gpt"', async () => {
    clearAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'openai', model: 'm1' },
        ],
      }),
    );
    let caught: unknown = null;
    try {
      await executeScenario('localize', 'en', async () => 'never');
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof LLMRequiredError).toBe(true);
    // The error feature mapping: localize → 'localize-gpt' (the SDK feature
    // name, used by errorResponse to compose the user-facing message).
    expect((caught as LLMRequiredError).feature).toBe('localize-gpt');
  });

  /**
   * 2026-05 fix: localize chain (openai/normal → claude/skip-polish) hit
   * a dead end when openai returned 401. The walker break'd on 4xx-auth
   * and never reached chain[1]'s skip-polish step — even though that step
   * is a graceful-degrade marker that doesn't depend on any LLM call
   * succeeding upstream. Fix: 4xx-auth (and 4xx-other / non-trigger errors)
   * still try remaining skip-polish steps before bailing.
   */
  test('API-FALLBACK-416 · 4xx-auth + remaining skip-polish step → walker jumps to it', async () => {
    setAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'openai', model: 'gpt-4o' },
          { provider: 'claude', model: 'claude-opus-4-20250514', mode: 'skip-polish' },
        ],
      }),
    );
    const authErr = Object.assign(new Error('Incorrect API key provided: ebbd...'), { status: 401 });
    let calls = 0;
    const seenProviders: string[] = [];
    const out = await executeScenario('localize', 'ja', async (step) => {
      calls++;
      seenProviders.push(`${step.provider}/${step.mode ?? 'normal'}`);
      if (step.mode !== 'skip-polish') throw authErr;
      return { skipped: true, source: step.provider };
    });
    expect(calls).toBe(2);
    expect(seenProviders).toEqual(['openai/normal', 'claude/skip-polish']);
    expect(out.usedStep.mode).toBe('skip-polish');
    expect(out.result).toEqual({ skipped: true, source: 'claude' });
    // The failed openai call IS recorded as a hop — the diff vs 411 is that
    // the chain didn't dead-end on it.
    expect(out.hops.length).toBe(1);
    expect(out.hops[0].errorClass).toBe('4xx-auth');
  });

  test('API-FALLBACK-417 · 4xx-other + remaining skip-polish step → walker jumps to it', async () => {
    setAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'openai', model: 'gpt-4o' },
          { provider: 'claude', model: 'claude-opus-4-20250514', mode: 'skip-polish' },
        ],
      }),
    );
    const promptErr = Object.assign(new Error('prompt token limit exceeded'), { status: 422 });
    let calls = 0;
    const out = await executeScenario('localize', 'ja', async (step) => {
      calls++;
      if (step.mode !== 'skip-polish') throw promptErr;
      return { skipped: true };
    });
    expect(calls).toBe(2);
    expect(out.usedStep.mode).toBe('skip-polish');
    expect(out.hops[0].errorClass).toBe('4xx-other');
  });

  test('API-FALLBACK-418 · non-trigger error + remaining skip-polish step → walker jumps to it', async () => {
    setAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'openai', model: 'gpt-4o' },
          { provider: 'claude', model: 'claude-opus-4-20250514', mode: 'skip-polish' },
        ],
        triggers: ['429-quota'], // 429-rate not in triggers
      }),
    );
    // Message must NOT contain quota keywords ('quota', 'exceeded', 'billing')
    // or it'd reclassify as 429-quota which IS in triggers — wrong test target.
    // 'rate' alone keeps the classifier on the 429-rate branch.
    const rateErr = Object.assign(new Error('rate limit, please slow down'), { status: 429 });
    let calls = 0;
    const out = await executeScenario('localize', 'ja', async (step) => {
      calls++;
      if (step.mode !== 'skip-polish') throw rateErr;
      return { skipped: true };
    });
    expect(calls).toBe(2);
    expect(out.usedStep.mode).toBe('skip-polish');
    // hop classified as 429-rate (not in triggers, but skip-polish let walker through anyway)
    expect(out.hops[0].errorClass).toBe('429-rate');
  });

  test('API-FALLBACK-419 · 4xx-auth + NO skip-polish in remaining chain → still short-circuits (regression for 403)', async () => {
    // Sanity check: my 416/417/418 fixes must NOT regress the original
    // 4xx-auth-bails behavior when there's no skip-polish lifeline. Same
    // setup as 403 — chain has only normal-mode steps.
    setAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'claude', model: 'm1' },
          { provider: 'deepseek', model: 'm2' },
        ],
      }),
    );
    let calls = 0;
    const authErr = Object.assign(new Error('invalid api key'), { status: 401 });
    let caught: unknown = null;
    try {
      await executeScenario('copy', 'en', async () => {
        calls++;
        throw authErr;
      });
    } catch (e) {
      caught = e;
    }
    expect(calls).toBe(1);
    expect(caught).toBe(authErr);
  });

  /**
   * NoAdapterSkipError sentinel — executors throw this when the step's
   * provider is in the chain but has no adapter for the scenario (e.g.
   * judge has no openai/gemini adapter; admin keeps them as forward-
   * compat placeholders). The walker treats it like a no-key skip:
   * silent, no hop recorded, walks to the next step.
   */
  test('API-FALLBACK-420 · executor throws NoAdapterSkipError → silent skip, walker continues', async () => {
    setAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'openai', model: 'gpt-4o' }, // no judge adapter
          { provider: 'claude', model: 'claude-opus-4-20250514' },
        ],
      }),
    );
    const seenProviders: string[] = [];
    const out = await executeScenario('judge', 'en', async (step) => {
      seenProviders.push(step.provider);
      if (step.provider === 'openai') {
        throw new NoAdapterSkipError(step.provider, 'judge');
      }
      return { used: step.provider };
    });
    expect(seenProviders).toEqual(['openai', 'claude']);
    expect(out.usedStep.provider).toBe('claude');
    // Critical: NoAdapterSkipError does NOT add a hop entry. Hops are for
    // attempted-but-failed calls; "skipped, no adapter" is conceptually the
    // same shape as "skipped, no key".
    expect(out.hops).toEqual([]);
  });

  test('API-FALLBACK-421 · ALL NoAdapterSkipError → LLMRequiredError (not a generic 500)', async () => {
    setAllKeys();
    await writeConfig(
      makeConfig({
        chain: [
          { provider: 'openai', model: 'm1' },
          { provider: 'gemini', model: 'm2' },
        ],
      }),
    );
    let caught: unknown = null;
    try {
      await executeScenario('judge', 'en', async (step) => {
        throw new NoAdapterSkipError(step.provider, 'judge');
      });
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof LLMRequiredError).toBe(true);
    // chain[0] is openai → reports its env var as the most-actionable hint
    expect((caught as LLMRequiredError).missing).toBe('OPENAI_API_KEY');
  });
});

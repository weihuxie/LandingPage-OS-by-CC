/**
 * API-PROVIDER-* · llm-provider.ts dispatch + capability description.
 *
 * Covers from audit-2026-05.md §2.3:
 *   406  describeCopyPrimary(locale) shape (chain[0] reflected, reason string)
 *   407  no LLM key anywhere → LLMRequiredError propagates from executeScenario
 *
 * Deferred (require live LLM SDK mocks the project doesn't currently
 * install):
 *   401  chain=[claude,deepseek] happy path (would call real adapter)
 *   402  chain=[gemini,claude] no-adapter → promote-to-claude (would call
 *        real Anthropic SDK with a fake key — slow, network-dependent,
 *        impolite to Anthropic). Audit-doc CLARIFY-001 documents the
 *        actual classification behavior; the orchestrator path is
 *        covered transitively by API-FALLBACK-413/414 (network class).
 *   403  onTrace callback shape on actual fallback (needs real adapter)
 *   404  DeepSeek runtime swap → trace.usedModel reflects swap (needs
 *        real DeepSeek SDK; partially covered by API-DS-RUNTIME-* in S3-C
 *        which directly tests the swap-decision pure function).
 *   405  regenerateModuleViaProvider variant transparency to adapter
 *
 * The dispatch executor itself is purely a `if step.provider === ...`
 * router; once S3-A locks executeScenario chain semantics and S3-C locks
 * the DeepSeek runtime-swap, the remaining behavior is "the executor
 * calls the right adapter" — verifiable by inspection (file is ~180
 * lines) and by the live `[需 KEY]` integration tests already in the
 * project (API-HYD-* / API-LOC-*).
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import path from 'path';
import {
  describeCopyPrimary,
  generateStrategyViaProvider,
  regenerateModuleViaProvider,
} from '../../src/lib/llm-provider';
import type { LLMConfig } from '../../src/lib/llm-config';
import { LLMRequiredError } from '../../src/lib/errors';
import type { ProductInputs, StrategySummary } from '../../src/lib/types';

const CONFIG_FILE = path.join(process.cwd(), '.data', 'v2-llm-config.json');

async function clearConfig(): Promise<void> {
  await fs.unlink(CONFIG_FILE).catch(() => {});
}

async function writeConfig(cfg: LLMConfig): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

const FILLER = {
  enabled: true,
  chain: [{ provider: 'claude' as const, model: 'm' }],
  triggers: ['5xx' as const],
};

function fixtureWithCopy(copyChain: Array<[string, string]>): LLMConfig {
  return {
    version: 2,
    scenarios: {
      strategy: FILLER,
      copy: {
        enabled: true,
        chain: copyChain.map(([provider, model]) => ({ provider: provider as any, model })),
        triggers: ['5xx'],
      },
      localize: FILLER,
      extract: FILLER,
      judge: FILLER,
    },
  };
}

test.describe('API-PROVIDER · describeCopyPrimary (capability snapshot)', () => {

  let savedKeys: Record<string, string | undefined>;

  test.beforeEach(async () => {
    savedKeys = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
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

  test('API-PROVIDER-406 · default config → primary="deepseek", reason mentions provider+model', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const out = await describeCopyPrimary('zh-CN');
    // Default copy chain[0] is deepseek per llm-config.ts DEFAULT_LLM_CONFIG.
    expect(out.primary).toBe('deepseek');
    expect(out.primaryModel).toBe('deepseek-chat');
    expect(out.reason).toContain('deepseek');
    expect(out.reason).toContain('deepseek-chat');
    expect(out.reason).toContain('copy/zh-CN');
  });

  test('API-PROVIDER-406b · admin chain=[claude,deepseek] → primary="claude"', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    await writeConfig(
      fixtureWithCopy([
        ['claude', 'claude-haiku-4-5'],
        ['deepseek', 'deepseek-chat'],
      ]),
    );
    const out = await describeCopyPrimary('en');
    expect(out.primary).toBe('claude');
    expect(out.primaryModel).toBe('claude-haiku-4-5');
    expect(out.reason).toContain('claude');
    expect(out.reason).toContain('copy/en');
  });

  test('API-PROVIDER-406c · hasClaude / hasDeepseek booleans reflect env', async () => {
    process.env.ANTHROPIC_API_KEY = 'fake-anthropic';
    delete process.env.DEEPSEEK_API_KEY;
    const out = await describeCopyPrimary('zh-CN');
    expect(out.hasClaude).toBe(true);
    expect(out.hasDeepseek).toBe(false);
  });

  test('API-PROVIDER-406d · both keys absent → both booleans false (still returns chain[0] meta)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const out = await describeCopyPrimary('zh-CN');
    expect(out.hasClaude).toBe(false);
    expect(out.hasDeepseek).toBe(false);
    // The describer must still report which provider WOULD be primary
    // — it's a config snapshot, not a "can I call now" check. The
    // `ready` flag in /api/capabilities is the gate; this is the
    // info source for the UI tooltip.
    expect(out.primary).toBeTruthy();
  });
});

test.describe('API-PROVIDER · no-key error propagation', () => {

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

  // Minimal ProductInputs satisfying the type. Adapter never sees this
  // because we test the no-key short-circuit; only shape matters for TS.
  const inputs: ProductInputs = {
    name: 'X',
    tagline: 't',
    category: 'SaaS',
    value: 'v',
    cta: 'demo',
    market: 'CN',
    locale: 'zh-CN',
    industry: 'SaaS',
    companySize: '10-50',
    role: 'PM',
    source: 'ads',
    pastedContent: '',
    referenceUrls: [],
    uploadedFileNames: [],
  };

  const strategy: StrategySummary = {
    audience: ['a'],
    goal: ['g'],
    narrative: ['n'],
    local: ['l'],
  };

  test('API-PROVIDER-407 · no LLM keys → generateStrategyViaProvider throws LLMRequiredError', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    let caught: unknown = null;
    try {
      await generateStrategyViaProvider(inputs);
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof LLMRequiredError).toBe(true);
    // The adapter layer must NOT swallow / convert LLMRequiredError —
    // route handlers map this code to 503 with a specific banner; any
    // wrapping would lose the shape and surface a generic 500.
    expect((caught as LLMRequiredError).code).toBe('LLM_REQUIRED');
  });

  test('API-PROVIDER-407b · no LLM keys → regenerateModuleViaProvider throws LLMRequiredError', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    let caught: unknown = null;
    try {
      await regenerateModuleViaProvider('hero', inputs, strategy, 'saas', 'zh-CN', 'B');
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof LLMRequiredError).toBe(true);
    expect((caught as LLMRequiredError).code).toBe('LLM_REQUIRED');
  });
});

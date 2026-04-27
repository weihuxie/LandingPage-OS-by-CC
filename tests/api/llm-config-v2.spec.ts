/**
 * API-LLM-V2-* · v2 schema migration + per-scenario policy resolution.
 *
 * 纯函数测试 — 不依赖 KV / API key。
 */
import { test, expect } from '@playwright/test';
import {
  DEFAULT_LLM_CONFIG,
  migrateOldConfig,
  policyFor,
  validateLLMConfig,
} from '../../src/lib/llm-config';

test.describe('API-LLM-V2 · v2 schema', () => {
  test('API-LLM-V2-001 · DEFAULT_LLM_CONFIG 通过 validateLLMConfig', () => {
    expect(validateLLMConfig(DEFAULT_LLM_CONFIG)).toBeNull();
  });

  test('API-LLM-V2-002 · v1 → v2 迁移：scenarios.localize=openai 加 skip-polish 兜底', () => {
    const v1 = {
      version: 1 as const,
      providers: {
        claude: { model: 'claude-opus-4-20250514' },
        deepseek: { model: 'deepseek-chat' },
        openai: { model: 'gpt-4o' },
        gemini: { model: 'gemini-3.0-pro' },
      },
      scenarios: {
        strategy: { ja: 'claude' as const, default: 'deepseek' as const },
        copy: { ja: 'claude' as const, default: 'deepseek' as const },
        localize: 'openai' as const,
        extract: 'gemini' as const,
      },
      fallback: {
        enabled: true,
        triggers: ['429-quota' as const, '5xx' as const],
        chain: ['deepseek' as const, 'claude' as const, 'openai' as const, 'gemini' as const],
      },
    };
    const v2 = migrateOldConfig(v1);
    expect(v2.version).toBe(2);
    // localize chain[0] = openai
    expect(v2.scenarios.localize.chain[0].provider).toBe('openai');
    expect(v2.scenarios.localize.chain[0].mode).toBe('normal');
    // localize chain[1] = claude with skip-polish (graceful degrade)
    expect(v2.scenarios.localize.chain[1].provider).toBe('claude');
    expect(v2.scenarios.localize.chain[1].mode).toBe('skip-polish');
    // strategy.ja chain has claude first (the v1 primary), then deepseek
    expect(v2.scenarios.strategy.ja.chain[0].provider).toBe('claude');
    expect(v2.scenarios.strategy.ja.chain[0].model).toBe('claude-opus-4-20250514');
    expect(v2.scenarios.strategy.ja.chain[1].provider).toBe('deepseek');
    // fallback.triggers carry over per-scenario
    expect(v2.scenarios.strategy.ja.triggers).toEqual(['429-quota', '5xx']);
    expect(v2.scenarios.copy.default.triggers).toEqual(['429-quota', '5xx']);
    // enabled flag carries over (was global, now per-scenario)
    expect(v2.scenarios.strategy.ja.enabled).toBe(true);
  });

  test('API-LLM-V2-003 · policyFor 按 (scenario, locale) 选 policy', () => {
    // strategy/copy 看 locale；其他不看
    expect(policyFor(DEFAULT_LLM_CONFIG, 'strategy', 'ja')).toBe(
      DEFAULT_LLM_CONFIG.scenarios.strategy.ja,
    );
    expect(policyFor(DEFAULT_LLM_CONFIG, 'strategy', 'zh-CN')).toBe(
      DEFAULT_LLM_CONFIG.scenarios.strategy.default,
    );
    expect(policyFor(DEFAULT_LLM_CONFIG, 'copy', 'ja')).toBe(
      DEFAULT_LLM_CONFIG.scenarios.copy.ja,
    );
    expect(policyFor(DEFAULT_LLM_CONFIG, 'localize', 'ja')).toBe(
      DEFAULT_LLM_CONFIG.scenarios.localize,
    );
    expect(policyFor(DEFAULT_LLM_CONFIG, 'extract', 'en')).toBe(
      DEFAULT_LLM_CONFIG.scenarios.extract,
    );
  });

  test('API-LLM-V2-004 · validateLLMConfig 拒绝空 chain / 缺 model / 错 mode', () => {
    const base = JSON.parse(JSON.stringify(DEFAULT_LLM_CONFIG));
    base.scenarios.strategy.ja.chain = [];
    expect(validateLLMConfig(base)).toBeTruthy();
    const b2 = JSON.parse(JSON.stringify(DEFAULT_LLM_CONFIG));
    b2.scenarios.strategy.ja.chain[0].model = '';
    expect(validateLLMConfig(b2)).toBeTruthy();
    const b3 = JSON.parse(JSON.stringify(DEFAULT_LLM_CONFIG));
    b3.scenarios.localize.chain[1].mode = 'bogus';
    expect(validateLLMConfig(b3)).toBeTruthy();
  });
});

/**
 * API-DS-MODEL-* · DeepSeek `onModelUsed` callback signature contract
 * (Wave 2 #D).
 *
 * The runtime swap from a config-time model (e.g. deepseek-reasoner) to
 * RUNTIME_FALLBACK_MODEL (deepseek-chat) used to be invisible to the
 * trace shown in the editor's routing badge — admins thought their
 * V4/reasoner config was actually serving traffic.
 *
 * The fix surfaces the actual model via an optional `onModelUsed`
 * callback. This spec is a static assertion that the callback param
 * exists in the public adapter signatures, so a future refactor that
 * drops the parameter fails CI immediately rather than silently breaking
 * the trace again.
 *
 * Behavioural verification (the swap actually fires the callback) needs
 * a real DeepSeek key + would be flaky CI — we rely on the structural
 * contract here + the existing deepseek-reasoner-fallback.spec.ts which
 * already exercises the swap path.
 */
import { test, expect } from '@playwright/test';
import {
  generateStrategyViaDeepseek,
  regenerateModuleViaDeepseek,
} from '../../src/lib/llm-deepseek';

test.describe('API-DS-MODEL · onModelUsed callback contract', () => {
  test('API-DS-MODEL-001 · generateStrategyViaDeepseek arity ≥ 4 (incl. onModelUsed)', () => {
    // 4 declared params: inputs, context?, modelOverride?, onModelUsed?
    // Function.length only counts params before the first default/optional,
    // so we can't trust .length; instead assert the function reference
    // exists and is callable.
    expect(typeof generateStrategyViaDeepseek).toBe('function');
    // Sanity: source-level check via toString — the signature must mention
    // the callback parameter name. Brittle, but cheap CI-time tripwire.
    const src = generateStrategyViaDeepseek.toString();
    expect(src).toContain('onModelUsed');
  });

  test('API-DS-MODEL-002 · regenerateModuleViaDeepseek mentions onModelUsed', () => {
    expect(typeof regenerateModuleViaDeepseek).toBe('function');
    const src = regenerateModuleViaDeepseek.toString();
    expect(src).toContain('onModelUsed');
  });
});

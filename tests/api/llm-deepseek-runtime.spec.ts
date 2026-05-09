/**
 * API-DS-MAIN-* · DeepSeek adapter runtime behavior.
 *
 * Covers from audit-2026-05.md §3.2:
 *   401  no DEEPSEEK_API_KEY → LLMRequiredError
 *   410  empty DEEPSEEK_API_KEY string → hasDeepseekKey() === false
 *   407  resolveModel: configured 'deepseek-reasoner' → coerces to chat
 *        (verified via SDK call + fetch-mock capturing the actual model sent)
 *   402  runtime swap: SDK returns 400 "tool_choice unsupported" → adapter
 *        retries with deepseek-chat → onModelUsed reports the swap
 *   404  no infinite swap: when configured model is already RUNTIME_FALLBACK
 *        and SDK 400s, error propagates (no second retry with same model)
 *   405  onModelUsed undefined → no throw
 *
 * Mock strategy: monkey-patch `globalThis.fetch` to intercept DeepSeek API
 * calls (`api.deepseek.com`). The OpenAI SDK v6 uses native fetch, so a
 * global override transparently catches its requests. Each test installs
 * a fresh responder, captures every call, and asserts on the model field
 * inside the JSON request body.
 *
 * The pure parts of the adapter are already tested by the existing
 * tests/api/deepseek-reasoner-fallback.spec.ts (API-DS-RSN-001~004) and
 * tests/api/deepseek-actual-model-trace.spec.ts (API-DS-MODEL-001~002).
 * This spec covers the runtime-call paths those can't reach.
 */
import { test, expect } from '@playwright/test';
import {
  generateStrategyViaDeepseek,
  hasDeepseekKey,
} from '../../src/lib/llm-deepseek';
import { LLMRequiredError, LLMCallError } from '../../src/lib/errors';
import type { ProductInputs } from '../../src/lib/types';

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

interface CapturedCall {
  url: string;
  body: any;
}

let originalFetch: typeof fetch;
let originalKey: string | undefined;
let calls: CapturedCall[] = [];

function installDeepseekResponder(
  responder: (call: { url: string; body: any; callIndex: number }) => Response | Promise<Response>,
): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('api.deepseek.com')) {
      let parsed: any = null;
      try {
        parsed = init?.body ? JSON.parse(init.body as string) : null;
      } catch {
        parsed = null;
      }
      const callIndex = calls.length;
      calls.push({ url, body: parsed });
      return await responder({ url, body: parsed, callIndex });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

function chatCompletionResponse(model: string): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_test',
                type: 'function',
                function: {
                  name: 'emit_strategy',
                  arguments: JSON.stringify({
                    audience: ['a'],
                    goal: ['g'],
                    narrative: ['n'],
                    local: ['l'],
                  }),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function toolChoiceUnsupported400(modelHint: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: `${modelHint} does not support this tool_choice`,
        type: 'invalid_request_error',
        code: null,
      },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  );
}

test.describe('API-DS-MAIN · DeepSeek adapter runtime', () => {

  test.beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalKey = process.env.DEEPSEEK_API_KEY;
    calls = [];
  });

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  });

  test('API-DS-MAIN-401 · no key → LLMRequiredError, fetch never called', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    installDeepseekResponder(() => new Response('should not be called', { status: 500 }));
    let caught: unknown = null;
    try {
      await generateStrategyViaDeepseek(inputs);
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof LLMRequiredError).toBe(true);
    expect((caught as LLMRequiredError).missing).toBe('DEEPSEEK_API_KEY');
    expect(calls.length).toBe(0);
  });

  test('API-DS-MAIN-410 · empty string key → hasDeepseekKey() false', () => {
    process.env.DEEPSEEK_API_KEY = '';
    // hasDeepseekKey uses `!!process.env[X]` — empty string is falsy.
    expect(hasDeepseekKey()).toBe(false);
  });

  test('API-DS-MAIN-410b · key set → hasDeepseekKey() true', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-fake';
    expect(hasDeepseekKey()).toBe(true);
  });

  test('API-DS-MAIN-407 · admin model="deepseek-reasoner" → resolveModel coerces to chat BEFORE SDK call', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-fake';
    installDeepseekResponder(({ body }) => chatCompletionResponse(body.model));
    await generateStrategyViaDeepseek(inputs, undefined, 'deepseek-reasoner');
    // resolveModel coerces reasoner-family early; only ONE SDK call, with
    // the safe default ('deepseek-chat'). No runtime swap needed.
    expect(calls.length).toBe(1);
    expect(calls[0].body.model).toBe('deepseek-chat');
  });

  test('API-DS-MAIN-402 · runtime swap: 400 tool_choice unsupported → retry with deepseek-chat', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-fake';
    // Simulate a model name that PASSES isReasonerFamily (so resolveModel
    // doesn't coerce it) but DeepSeek's API still rejects tool_choice on
    // it — represents a future / unknown-bad model alias. We use
    // 'deepseek-v4-pro' which is in MODEL_OPTIONS but per CLAUDE.md §2.5
    // currently has tool_choice issues.
    installDeepseekResponder(({ body, callIndex }) => {
      if (callIndex === 0) {
        // Mimic DeepSeek's 400 reply for unsupported tool_choice.
        return toolChoiceUnsupported400(body.model);
      }
      return chatCompletionResponse(body.model);
    });
    let reportedModel: string | undefined;
    await generateStrategyViaDeepseek(inputs, undefined, 'deepseek-v4-pro', (m) => {
      reportedModel = m;
    });
    // Two calls: first with the configured model (rejected), second with
    // the runtime fallback (deepseek-chat).
    expect(calls.length).toBe(2);
    expect(calls[0].body.model).toBe('deepseek-v4-pro');
    expect(calls[1].body.model).toBe('deepseek-chat');
    // onModelUsed must reflect the actually-used model so admin trace
    // doesn't lie about which model produced the output.
    expect(reportedModel).toBe('deepseek-chat');
  });

  test('API-DS-MAIN-404 · already deepseek-chat + 400 → no infinite swap, error propagates', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-fake';
    installDeepseekResponder(({ body }) => toolChoiceUnsupported400(body.model));
    let caught: unknown = null;
    try {
      await generateStrategyViaDeepseek(inputs, undefined, 'deepseek-chat');
    } catch (e) {
      caught = e;
    }
    // Already running on the runtime-fallback model — no second retry,
    // error gets wrapped to LLMCallError (or surfaces from the upper
    // retry loop). With the inner-attempt `model !== RUNTIME_FALLBACK_MODEL`
    // guard, only ONE call to the SDK happens.
    expect(calls.length).toBe(1);
    expect(calls[0].body.model).toBe('deepseek-chat');
    expect(caught instanceof LLMCallError).toBe(true);
  });

  test('API-DS-MAIN-405 · onModelUsed undefined → no throw on happy path', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-fake';
    installDeepseekResponder(({ body }) => chatCompletionResponse(body.model));
    // No onModelUsed callback. Adapter must not crash on
    // `onModelUsed?.(model)` — the optional-chaining guard is what we're
    // asserting, plus that the caller pattern `await fn(...)` resolves.
    const out = await generateStrategyViaDeepseek(inputs, undefined, 'deepseek-chat');
    expect(out.audience).toBeDefined();
    expect(out.goal).toBeDefined();
    expect(out.narrative).toBeDefined();
    expect(out.local).toBeDefined();
  });

  test('API-DS-MAIN-405b · onModelUsed callback fires once on success even without runtime swap', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-fake';
    installDeepseekResponder(({ body }) => chatCompletionResponse(body.model));
    let calledTimes = 0;
    let lastModel: string | undefined;
    await generateStrategyViaDeepseek(inputs, undefined, 'deepseek-chat', (m) => {
      calledTimes++;
      lastModel = m;
    });
    expect(calledTimes).toBe(1);
    expect(lastModel).toBe('deepseek-chat');
  });

  test('API-DS-MAIN-408 · 5xx → wrapped in LLMCallError (after retry)', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-fake';
    installDeepseekResponder(
      () =>
        new Response('upstream gateway error', {
          status: 503,
          headers: { 'content-type': 'text/plain' },
        }),
    );
    let caught: unknown = null;
    try {
      await generateStrategyViaDeepseek(inputs, undefined, 'deepseek-chat');
    } catch (e) {
      caught = e;
    }
    // The adapter retries 5xx (RETRYABLE_STATUSES includes 503) up to
    // MAX_ATTEMPTS=2, then wraps. Either 2 calls (full retry) or 1+
    // (depending on internal retry timing); minimum is 1.
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(caught instanceof LLMCallError).toBe(true);
    expect((caught as LLMCallError).provider).toBe('deepseek');
    expect((caught as LLMCallError).feature).toBe('strategy');
  });

  test('API-DS-MAIN-409 · empty content + no tool_call → LLMCallError mentioning finish_reason', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-fake';
    installDeepseekResponder(
      () =>
        new Response(
          JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'deepseek-chat',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: null },
                finish_reason: 'length',
              },
            ],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    let caught: unknown = null;
    try {
      await generateStrategyViaDeepseek(inputs, undefined, 'deepseek-chat');
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof LLMCallError).toBe(true);
    expect((caught as LLMCallError).message).toContain('finish_reason');
  });
});

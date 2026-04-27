/**
 * API-ADMIN-LLM-* · /api/admin/llm-config 的 CRUD + 自定义值 round-trip。
 *
 * Motivation (2026-04)：用户反馈 "我改了自定义模型保存上不" —— 当场怀疑
 * KV PUT 是否真的写进去了。这组用例从 API 层直接验：
 *   - PUT 合法的自定义 model ID → GET 能读回
 *   - PUT 非法值（空字符串）→ 400 + INVALID_CONFIG code
 *   - PUT scenarios.localize = deepseek → GET 能读回（验上一条 bug 的回归：
 *     /api/pages/[id]/locales 路由曾把 primary 硬编码成 openai）
 *
 * 都要求 ADMIN_PASSWORD 有配 —— 没配就 skip，不是失败（和 capabilities.ts
 * 里 hasClaude/hasOpenAI 的 skip 策略一致）。
 */
import { test, expect } from '@playwright/test';
import { getAdminPassword, loginAdminViaRequest } from '../helpers/admin';

test.describe('API-ADMIN-LLM · config round-trip', () => {
  test.skip(!getAdminPassword(), 'requires ADMIN_PASSWORD env var');

  test('API-ADMIN-LLM-001 · 自定义 OpenAI 模型 PUT → GET 读回一致', async ({
    request,
  }) => {
    const cookie = await loginAdminViaRequest(request);

    // Baseline — 测完要 restore
    const baselineRes = await request.get('/api/admin/llm-config', {
      headers: { cookie },
    });
    expect(baselineRes.ok()).toBe(true);
    const baseline = (await baselineRes.json()).config;
    const originalModel = baseline.providers.openai.model;

    const customModel = `ci-custom-${Date.now()}`;

    try {
      const putRes = await request.put('/api/admin/llm-config', {
        headers: { cookie },
        data: {
          config: {
            ...baseline,
            providers: {
              ...baseline.providers,
              openai: { model: customModel },
            },
          },
        },
      });
      expect(putRes.status()).toBe(200);
      const putBody = await putRes.json();
      expect(putBody.ok).toBe(true);
      expect(putBody.config.providers.openai.model).toBe(customModel);

      // 核心断言：独立 GET —— 验 KV 真的写进去了（不是 PUT 的回显糊弄人）
      const getRes = await request.get('/api/admin/llm-config', {
        headers: { cookie },
      });
      expect(getRes.ok()).toBe(true);
      const fresh = (await getRes.json()).config;
      expect(fresh.providers.openai.model).toBe(customModel);
    } finally {
      // 恢复
      await request.put('/api/admin/llm-config', {
        headers: { cookie },
        data: {
          config: {
            ...baseline,
            providers: {
              ...baseline.providers,
              openai: { model: originalModel },
            },
          },
        },
      });
    }
  });

  test('API-ADMIN-LLM-002 · 空 model 被 validator 拒绝（400 INVALID_CONFIG）', async ({
    request,
  }) => {
    const cookie = await loginAdminViaRequest(request);

    const baselineRes = await request.get('/api/admin/llm-config', {
      headers: { cookie },
    });
    const baseline = (await baselineRes.json()).config;

    const putRes = await request.put('/api/admin/llm-config', {
      headers: { cookie },
      data: {
        config: {
          ...baseline,
          providers: {
            ...baseline.providers,
            openai: { model: '' },
          },
        },
      },
    });
    expect(putRes.status()).toBe(400);
    const body = await putRes.json();
    expect(body.code).toBe('INVALID_CONFIG');
    expect(body.message).toContain('openai');
  });

  test('API-ADMIN-LLM-003 · scenarios.localize=deepseek 能写能读（路由不回 openai）', async ({
    request,
  }) => {
    const cookie = await loginAdminViaRequest(request);

    const baselineRes = await request.get('/api/admin/llm-config', {
      headers: { cookie },
    });
    const baseline = (await baselineRes.json()).config;
    const originalLocalize = baseline.scenarios.localize;

    try {
      const putRes = await request.put('/api/admin/llm-config', {
        headers: { cookie },
        data: {
          config: {
            ...baseline,
            scenarios: {
              ...baseline.scenarios,
              localize: 'deepseek',
            },
          },
        },
      });
      expect(putRes.status()).toBe(200);

      const getRes = await request.get('/api/admin/llm-config', {
        headers: { cookie },
      });
      const fresh = (await getRes.json()).config;
      expect(fresh.scenarios.localize).toBe('deepseek');
    } finally {
      await request.put('/api/admin/llm-config', {
        headers: { cookie },
        data: {
          config: {
            ...baseline,
            scenarios: {
              ...baseline.scenarios,
              localize: originalLocalize,
            },
          },
        },
      });
    }
  });

  test('API-ADMIN-LLM-004 · 无 cookie 请求返回 401', async ({ request }) => {
    const res = await request.get('/api/admin/llm-config');
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('ADMIN_UNAUTHORIZED');
  });
});

/**
 * Regression for 2026-04: 用户点 "重新生成" 撞到 Anthropic 400
 * "Your credit balance is too low to access the Anthropic API.
 * Please go to Plans & Billing to upgrade or purchase credits"。
 * 这条错误之前会被分类成 4xx-other —— 硬编码永不回退 —— 于是就算 admin
 * 把 fallback.enabled 打开并把 DeepSeek 加进 chain，module-regen 还是会
 * 直接挂。分类器现在:
 *   - 把 LLMCallError 的 cause 先剥出来再读 status / message（wrapper 本身
 *     没有 status 字段，不剥的话永远 fall through 到 'network'）
 *   - 把 400 里带 "credit balance" / "insufficient_quota" / "billing" /
 *     "purchase credits" / "plans & billing" 的响应提升为 429-quota
 *   - 把 HTTP 402 Payment Required 当成 quota
 *
 * 纯函数，不走 HTTP，不需要 ADMIN_PASSWORD / LLM key，永远开。
 */
import { classifyProviderError } from '../../src/lib/llm-config';
import { LLMCallError } from '../../src/lib/errors';

test.describe('API-ADMIN-LLM · classifyProviderError 分类', () => {
  test('API-ADMIN-LLM-101 · Anthropic 400 "credit balance" 视为 429-quota', () => {
    const anthropicCreditErr = Object.assign(
      new Error(
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
      ),
      { status: 400 },
    );
    expect(classifyProviderError(anthropicCreditErr)).toBe('429-quota');
  });

  test('API-ADMIN-LLM-102 · LLMCallError 剥 cause 后分类', () => {
    // adapter 在生产里抛的永远是 LLMCallError(cause=<Anthropic SDK err>)，
    // classifier 直接读 wrapper 的 status 永远是 undefined —— 必须先剥 cause。
    const inner = Object.assign(new Error('401 authentication_error'), { status: 401 });
    const wrapped = new LLMCallError('claude', 'module-regen', inner);
    expect(classifyProviderError(wrapped)).toBe('4xx-auth');

    const innerCredit = Object.assign(
      new Error('400 Your credit balance is too low. Please purchase credits.'),
      { status: 400 },
    );
    const wrappedCredit = new LLMCallError('claude', 'module-regen', innerCredit);
    expect(classifyProviderError(wrappedCredit)).toBe('429-quota');
  });

  test('API-ADMIN-LLM-103 · OpenAI insufficient_quota code 视为 429-quota', () => {
    // OpenAI 有时候返回 429 带 code=insufficient_quota，有时候回 400。
    // 都要识别出来走 quota 通道而不是 4xx-other。
    const openaiQuota400 = Object.assign(new Error('bad request'), {
      status: 400,
      code: 'insufficient_quota',
    });
    expect(classifyProviderError(openaiQuota400)).toBe('429-quota');

    const openaiQuotaMsg = Object.assign(
      new Error('You exceeded your current quota, please check your plan and billing details.'),
      { status: 429 },
    );
    expect(classifyProviderError(openaiQuotaMsg)).toBe('429-quota');
  });

  test('API-ADMIN-LLM-104 · HTTP 402 Payment Required 视为 429-quota', () => {
    const err402 = Object.assign(new Error('payment required'), { status: 402 });
    expect(classifyProviderError(err402)).toBe('429-quota');
  });

  test('API-ADMIN-LLM-105 · 真 400 不含 billing 关键词仍是 4xx-other', () => {
    // 防过度修补：正常的 prompt 太长 / 参数非法 400 还应该是 4xx-other，
    // 不然会拖别的 provider 陪跑。
    const realBadReq = Object.assign(
      new Error('prompt is too long: 200000 tokens > 200000 maximum'),
      { status: 400 },
    );
    expect(classifyProviderError(realBadReq)).toBe('4xx-other');
  });

  test('API-ADMIN-LLM-106 · 401/403/5xx/network 原有分类不动', () => {
    expect(classifyProviderError(Object.assign(new Error(''), { status: 401 }))).toBe('4xx-auth');
    expect(classifyProviderError(Object.assign(new Error(''), { status: 403 }))).toBe('4xx-auth');
    expect(classifyProviderError(Object.assign(new Error(''), { status: 500 }))).toBe('5xx');
    expect(classifyProviderError(Object.assign(new Error(''), { status: 503 }))).toBe('5xx');
    expect(classifyProviderError(new Error('fetch failed'))).toBe('network');
    expect(classifyProviderError(null)).toBeNull();
  });

  test('API-ADMIN-LLM-107 · KSP "has not activated the model" 403 视为 429-quota', () => {
    // Gateway-style "model not activated" 是账户级 billing/授权问题，
    // 跟 quota 同源；归到 429-quota 让 fallback.enabled 时能触发优雅
    // 降级 (localize 跳 polish 用 hydrate 产物)。归到 4xx-auth 会永
    // 不回退，用户撞 hard 502。
    const kspErr = Object.assign(
      new Error(
        '403 Your account 2000172632 has not activated the model gpt-4o-2024-08-06. Please activate the model in the KSP Console',
      ),
      { status: 403 },
    );
    expect(classifyProviderError(kspErr)).toBe('429-quota');

    // mini 也走同一路径
    const kspErrMini = Object.assign(
      new Error(
        '403 Your account 2000172632 has not activated the model gpt-4o-mini. Please activate the model in the KSP Console',
      ),
      { status: 403 },
    );
    expect(classifyProviderError(kspErrMini)).toBe('429-quota');
  });
});

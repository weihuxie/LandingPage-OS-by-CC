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

/**
 * E2E-ADMIN-LLM-* · /admin/llm 页面的 "自定义模型" 保存流程。
 *
 * 2026-04 用户反馈 "我改了自定义模型，去哪里保存" → "点了下面的保存但
 * 没保存上"。那次修了三个改动（commit a58a78a）:
 *   1. ModelRow 把 "自定义"/"返回下拉" 两个按钮合并成下拉末尾的
 *      "✏️ 自定义…" 选项
 *   2. 状态栏 pill 化（✓ 已保存 / ● 未保存 / ✗ 错误）
 *   3. PUT 后自动 GET 核对 KV 里存的值
 *
 * 这条用例就是把这三条的 UI 断言一次打包，防止回归：
 *   - 下拉里有 "✏️ 自定义…" 选项
 *   - 选中后出现输入框
 *   - dirty 时琥珀 pill 出现
 *   - 保存后绿色 "✓ 已保存" pill 出现
 *   - 刷新页面后自定义值仍在输入框里（KV 真的写成功）
 */
import { test, expect } from '@playwright/test';
import { getAdminPassword, loginAdminViaContext } from '../helpers/admin';

test.describe('E2E-ADMIN-LLM · Save custom model', () => {
  test.skip(!getAdminPassword(), 'requires ADMIN_PASSWORD env var');

  test('E2E-ADMIN-LLM-001 · 自定义 OpenAI model 保存 → 刷新仍在', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);

    // 1) Login — cookie 落在 BrowserContext，page 和 context.request 共享
    await loginAdminViaContext(context);

    // 2) Baseline config —— 测完恢复
    const baselineRes = await context.request.get('/api/admin/llm-config');
    expect(baselineRes.ok()).toBe(true);
    const baseline = (await baselineRes.json()).config;
    const originalOpenAI = baseline.providers.openai.model;

    const customModel = `ci-e2e-${Date.now()}`;

    try {
      // 3) 进管理页
      await page.goto('/admin/llm');
      await expect(
        page.getByRole('heading', { name: 'LLM 配置' }),
      ).toBeVisible();

      // 4) 定位 OpenAI 行的 select —— 用 "包含 gpt-4o option 的 select"
      //    区分于 Claude/DeepSeek/Gemini 的同结构下拉
      const openaiSelect = page
        .locator('select')
        .filter({ has: page.locator('option', { hasText: /gpt-4o/i }) })
        .first();
      await expect(openaiSelect).toBeVisible();

      // 选 "✏️ 自定义…（手填模型 ID）"
      // '__custom__' is the CUSTOM_MODEL_SENTINEL in AdminLLMForm.tsx;
      // selectOption wants an exact string, not a regex, so target by value.
      await openaiSelect.selectOption('__custom__');

      // 输入框应该出现在同一行里
      const customInput = page.getByPlaceholder(/输入模型 ID/);
      await expect(customInput).toBeVisible();
      // 自动聚焦 —— 验一下（auto-focus 时 document.activeElement 是这个 input）
      await expect(customInput).toBeFocused();

      await customInput.fill(customModel);

      // 5) dirty pill 出现
      await expect(page.getByText(/有未保存的改动/)).toBeVisible();

      // 6) 点保存
      await page.getByRole('button', { name: /^保存$/ }).click();

      // 7) 已保存 pill 出现（中间可能短暂 "保存中…"）
      await expect(page.getByText(/✓\s*已保存/)).toBeVisible({
        timeout: 10_000,
      });

      // 没有错误 pill 出现
      const errorPill = page.locator('text=/^✗/').first();
      await expect(errorPill).not.toBeVisible();

      // 8) 刷新 —— KV 真的写进去了才能验
      await page.reload();
      await expect(
        page.getByRole('heading', { name: 'LLM 配置' }),
      ).toBeVisible();

      // 刷新后 OpenAI 的 select 应该显示 "✏️ 自定义…"，
      // 因为 customModel 不在 preset 列表里
      const inputAfter = page.getByPlaceholder(/输入模型 ID/);
      await expect(inputAfter).toBeVisible();
      await expect(inputAfter).toHaveValue(customModel);
    } finally {
      // 恢复 baseline —— 即使 test 中途 assert 失败也得跑
      await context.request.put('/api/admin/llm-config', {
        data: {
          config: {
            ...baseline,
            providers: {
              ...baseline.providers,
              openai: { model: originalOpenAI },
            },
          },
        },
      });
    }
  });

  test('E2E-ADMIN-LLM-002 · 选 preset → 输入框消失 + dirty + 保存', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);

    await loginAdminViaContext(context);

    const baselineRes = await context.request.get('/api/admin/llm-config');
    const baseline = (await baselineRes.json()).config;
    const originalOpenAI = baseline.providers.openai.model;

    try {
      await page.goto('/admin/llm');

      const openaiSelect = page
        .locator('select')
        .filter({ has: page.locator('option', { hasText: /gpt-4o/i }) })
        .first();

      // 先切到自定义，确认输入框出现
      // '__custom__' is the CUSTOM_MODEL_SENTINEL in AdminLLMForm.tsx;
      // selectOption wants an exact string, not a regex, so target by value.
      await openaiSelect.selectOption('__custom__');
      await expect(page.getByPlaceholder(/输入模型 ID/)).toBeVisible();

      // 再切回 preset —— 输入框应当消失
      await openaiSelect.selectOption('gpt-4o-mini');
      await expect(page.getByPlaceholder(/输入模型 ID/)).not.toBeVisible();

      // dirty pill —— 因为从原值（比如 gpt-4o-2024-08-06）变成 gpt-4o-mini
      // 但如果 baseline 本来就是 gpt-4o-mini，会没 dirty。处理一下
      if (originalOpenAI !== 'gpt-4o-mini') {
        await expect(page.getByText(/有未保存的改动/)).toBeVisible();
        await page.getByRole('button', { name: /^保存$/ }).click();
        await expect(page.getByText(/✓\s*已保存/)).toBeVisible({
          timeout: 10_000,
        });
      }
    } finally {
      await context.request.put('/api/admin/llm-config', {
        data: {
          config: {
            ...baseline,
            providers: {
              ...baseline.providers,
              openai: { model: originalOpenAI },
            },
          },
        },
      });
    }
  });
});

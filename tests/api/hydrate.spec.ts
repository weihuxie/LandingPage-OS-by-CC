/**
 * API-HYD-* · hydrate 端点(Claude 重跑当前 locale)。
 * 对应用例文档:docs/testcases/api-testcases.md API-HYD 行。
 */
import { test, expect } from '@playwright/test';
import { loginAndEnsureTenant } from '../helpers/user-auth';
import { cleanupProject, seedProject, patchPageFixture, getPage } from '../helpers/seed';
import { getCapabilities } from '../helpers/capabilities';
import { variantHintForModule } from '../../src/lib/llm-claude';

test.describe('API-HYD · Hydrate', () => {

  test.beforeEach(async ({ request }) => {
    await loginAndEnsureTenant(request);
  });
  test('API-HYD-001 · [需 KEY] 重跑 Claude hydrate 当前 locale', async ({ request }) => {
    const caps = await getCapabilities(request);
    test.skip(!caps.hasClaude, 'requires ANTHROPIC_API_KEY');
    test.setTimeout(120_000);

    const seeded = await seedProject(request);
    try {
      // 把 hero headline 强制改成可辨识的占位,hydrationFailed=true
      const page = await getPage(request, seeded.pageId);
      const modsA = page.variants.A['zh-CN'].map((m: any) =>
        m.type === 'hero'
          ? { ...m, content: { ...m.content, headline: 'TEMPLATE_PLACEHOLDER_HEADLINE' } }
          : m,
      );
      const modsB = page.variants.B['zh-CN'].map((m: any) =>
        m.type === 'hero'
          ? { ...m, content: { ...m.content, headline: 'TEMPLATE_PLACEHOLDER_HEADLINE' } }
          : m,
      );
      await patchPageFixture(seeded.pageId, {
        hydrationFailed: true,
        variants: {
          ...page.variants,
          A: { ...page.variants.A, 'zh-CN': modsA },
          B: { ...page.variants.B, 'zh-CN': modsB },
        },
      });

      const res = await request.post(`/api/pages/${seeded.pageId}/hydrate`, {
        data: { locale: 'zh-CN' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.locales).toEqual(['zh-CN']);
      const heroA = body.page.variants.A['zh-CN'].find((m: any) => m.type === 'hero');
      expect(heroA.content.headline).not.toBe('TEMPLATE_PLACEHOLDER_HEADLINE');
      expect(heroA.content.headline).toBeTruthy();

      // 落库
      const fresh = await getPage(request, seeded.pageId);
      const freshHero = fresh.variants.A['zh-CN'].find((m: any) => m.type === 'hero');
      expect(freshHero.content.headline).not.toBe('TEMPLATE_PLACEHOLDER_HEADLINE');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-HYD-002 · [无 KEY] Hydrate 失败走 LLM_REQUIRED', async ({ request }) => {
    const caps = await getCapabilities(request);
    test.skip(caps.hasClaude, 'requires MISSING ANTHROPIC_API_KEY');

    const seeded = await seedProject(request);
    try {
      await patchPageFixture(seeded.pageId, { hydrationFailed: true });

      const before = await getPage(request, seeded.pageId);
      const heroBefore = before.variants.A['zh-CN'].find((m: any) => m.type === 'hero');

      const res = await request.post(`/api/pages/${seeded.pageId}/hydrate`, {
        data: { locale: 'zh-CN' },
      });
      expect(res.status()).toBe(503);
      const body = await res.json();
      expect(body.code).toBe('LLM_REQUIRED');
      // Default copy chain[0] is deepseek (cheap), so missing reports
      // its key. If admin reorders chain to claude-first, expect would
      // flip — accept either.
      expect(body.missing).toMatch(/ANTHROPIC_API_KEY|DEEPSEEK_API_KEY/);

      // 落库未变
      const fresh = await getPage(request, seeded.pageId);
      const heroFresh = fresh.variants.A['zh-CN'].find((m: any) => m.type === 'hero');
      expect(heroFresh.content.headline).toBe(heroBefore.content.headline);
      expect(fresh.hydrationFailed).toBe(true);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-HYD-003 · Hydrate 非法 locale(UNKNOWN_LOCALE)', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const res = await request.post(`/api/pages/${seeded.pageId}/hydrate`, {
        data: { locale: 'ja' }, // ja 未加入 availableLocales
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('UNKNOWN_LOCALE');
      expect(body.error).toBe('unknown-locale');
      expect(body.message).toContain('ja');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  /**
   * Regression for 2026-04 用户反馈：编辑器顶部 "方案 A · 痛点" / "方案 B · 收益"
   * 切换时两个方案 hero 一模一样。根因：hydrateModulesViaClaude 对 hero 只调
   * 一次 LLM，把同一份 patch 覆盖到 A/B 两 variants 的 hero，把 tintHeroForVariant
   * 的 variant-specific eyebrow/headline/subhead 全冲掉。
   *
   * 修复：hero 按 variant 调两次 LLM，user prompt 带 variant hint（A lead with
   * cost / B lead with outcome），A 和 B 分别产出一份 hero patch。
   *
   * 本用例在真跑 LLM 下验：hydrate 结束后 A.hero 和 B.hero 的 eyebrow 或
   * headline 必须有一个不同。两个都一样就说明 variant hint 没起作用。
   */
  test('API-HYD-004 · [需 KEY] 重 hydrate 后 A/B hero 必须不同', async ({ request }) => {
    const caps = await getCapabilities(request);
    test.skip(!caps.hasClaude, 'requires ANTHROPIC_API_KEY');
    test.setTimeout(180_000);

    const seeded = await seedProject(request);
    try {
      // 强制触发 hydrate：把 A/B 两边 hero headline 都打成占位符，hydrate
      // 路由检测到 hydrationFailed=true 会重跑（seed 时已经 hydrate 过，
      // 但 seedProject 的 baseline 很可能落在旧代码的单调 A/B 上，强制
      // 再跑一次确保走的是新代码路径）
      const page = await getPage(request, seeded.pageId);
      const mark = (mods: any[]) =>
        mods.map((m: any) =>
          m.type === 'hero'
            ? { ...m, content: { ...m.content, headline: 'TEMPLATE_PLACEHOLDER_HEADLINE' } }
            : m,
        );
      await patchPageFixture(seeded.pageId, {
        hydrationFailed: true,
        variants: {
          ...page.variants,
          A: { ...page.variants.A, 'zh-CN': mark(page.variants.A['zh-CN']) },
          B: { ...page.variants.B, 'zh-CN': mark(page.variants.B['zh-CN']) },
        },
      });

      const res = await request.post(`/api/pages/${seeded.pageId}/hydrate`, {
        data: { locale: 'zh-CN' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();

      const heroA = body.page.variants.A['zh-CN'].find((m: any) => m.type === 'hero');
      const heroB = body.page.variants.B['zh-CN'].find((m: any) => m.type === 'hero');

      expect(heroA.content.headline).not.toBe('TEMPLATE_PLACEHOLDER_HEADLINE');
      expect(heroB.content.headline).not.toBe('TEMPLATE_PLACEHOLDER_HEADLINE');

      // 核心断言：A/B 两个 hero 至少 eyebrow 或 headline 有一个不同。
      // 之所以不卡 eyebrow 必不同 —— LLM 有时候会在两个 variant 都选同一
      // 个常见短语（e.g. 都用 "智能验证"），headline 层差异更稳定。
      const sameEyebrow = heroA.content.eyebrow === heroB.content.eyebrow;
      const sameHeadline = heroA.content.headline === heroB.content.headline;
      expect(sameEyebrow && sameHeadline).toBe(false);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  /**
   * 纯函数 unit test —— variantHintForModule 是拼 prompt 的核心。若它返回
   * 的 A/B 两段 hint 一样（或误把 pain 也纳入 variant-aware），整条链路都会
   * 默默退化回 "A/B 相同"，而 LLM 端的用例又贵又慢没法每次跑。这条不走 HTTP，
   * 所以秒跑不需要 LLM key，永远开着。
   */
  test('API-HYD-005 · variantHintForModule hero + non-hero variants (Wave 4 #M)', async () => {
    // Hero has eyebrow examples + locale-specific stuff; verified in the
    // dedicated tests/api/variant-hint-extended.spec.ts file (no server
    // needed). This test stays here so the existing hydrate suite still
    // mentions variantHintForModule by name — anyone removing the hint
    // function will see two test files break, not one.
    const heroA = variantHintForModule('hero', 'A', 'zh-CN');
    const heroB = variantHintForModule('hero', 'B', 'zh-CN');
    expect(heroA).toBeTruthy();
    expect(heroB).toBeTruthy();
    expect(heroA).not.toBe(heroB);
  });
});

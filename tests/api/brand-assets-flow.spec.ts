/**
 * API-ASSET-FLOW-* · 验证"品牌资产编辑后是否真的进到生成页面"
 *
 * 飞书测试 #6 的代码级证实脚本：
 *   用户吐槽 `/[locale]/assets` 页面顶部说明白纸黑字写着
 *   "一次维护，所有项目复用。生成时 AI 会按痛点/市场自动匹配。"
 *   但实测"编辑完没办法加到页面"。
 *
 * 代码溯源发现**两份资产存储断点**：
 *   ① 全局 AssetLibrary（/api/assets, KEY_ASSETS）— 6 类：
 *      brand/testimonials/certifications/cases/press/media
 *   ② 产品级 Product.assets — 3 类：testimonials/cases/media
 *   生成路径（/api/pages/[id]/locales 里的 pickTopTestimonials）**只读** ②
 *   ② 在 POST /api/products 初始化时是空数组，且编辑器里没任何入口写它。
 *   → AssetLibrary 是孤儿，写什么都不会进页面。
 *
 * 本 spec 用 sentinel 字符串跑一遍最窄路径，让"断点"落到断言日志里。
 */
import { test, expect } from '@playwright/test';
import { loginAndEnsureTenant } from '../helpers/user-auth';
import { seedProject, cleanupProject } from '../helpers/seed';

test.describe('API-ASSET-FLOW · AssetLibrary → 页面生成', () => {

  test.beforeEach(async ({ request }) => {
    await loginAndEnsureTenant(request);
  });
  test('API-ASSET-FLOW-001 · 全局 AssetLibrary 里的 testimonial / logo / case 是否进新页面', async ({
    request,
  }) => {
    // 每条 sentinel 都是 time-based 唯一串，保证和历史数据不撞
    const stamp = Date.now();
    const sentinelTestimonial = `ASSET_LIB_SENT_TESTI_${stamp}`;
    const sentinelLogo = `https://example.test/ASSET_LIB_SENT_LOGO_${stamp}.png`;
    const sentinelCase = `ASSET_LIB_SENT_CASE_${stamp}`;

    // 备份当前 AssetLibrary 以便测试结束恢复
    const beforeRes = await request.get('/api/assets');
    expect(beforeRes.status()).toBe(200);
    const before = (await beforeRes.json()).assets;

    // 把 sentinel 种进 AssetLibrary
    const seeded = {
      ...before,
      testimonials: [
        {
          id: `t_${stamp}`,
          createdAt: stamp,
          author: 'SentinelAuthor',
          role: 'CTO',
          company: 'SentinelCo',
          quote: sentinelTestimonial,
          primaryLocale: 'zh-CN',
          tags: ['pain-cost', 'benefit-roi'],
          preferredMarkets: ['CN', 'GLOBAL'],
        },
        ...(before.testimonials ?? []),
      ],
      brand: {
        id: `b_${stamp}`,
        logos: [sentinelLogo],
        primaryColor: '#ff00aa',
      },
      cases: [
        {
          id: `c_${stamp}`,
          createdAt: stamp,
          customerName: sentinelCase,
          industry: 'SaaS',
          metric: '3.8× ROI',
          summary: 'sentinel case summary',
        },
        ...(before.cases ?? []),
      ],
    };
    const putRes = await request.put('/api/assets', { data: seeded });
    expect(putRes.status()).toBe(200);

    let productId: string | undefined;
    try {
      // 用标准 seed（POST /api/projects 走 compat path）创建产品 + 页面
      const proj = await seedProject(request, {
        name: `ASSET-FLOW-${stamp}`,
      });
      productId = proj.productId;

      // 拉出页面，把所有 variant / locale / 模块的 content 展平成一个大字符串
      const pageRes = await request.get(`/api/pages/${proj.pageId}`);
      expect(pageRes.status()).toBe(200);
      const { page } = await pageRes.json();

      const allContent = JSON.stringify(page);

      // 核心断言：sentinel 是否进到了页面。
      //  - 如果 AssetLibrary 被打通了，至少其中一条应当出现
      //  - 当前设计里三条都会缺席（全局库不进生成路径）
      const hasTestimonial = allContent.includes(sentinelTestimonial);
      const hasLogo = allContent.includes(sentinelLogo);
      const hasCase = allContent.includes(sentinelCase);

      // 打日志给人看（不是靠它通过，是靠它留痕）
      console.log('[ASSET-FLOW-001] sentinel presence in generated page:', {
        testimonial: hasTestimonial,
        logo: hasLogo,
        case: hasCase,
      });

      // 用"当前行为"做 baseline 断言。如果未来接通了 AssetLibrary，这
      // 断言会红，届时改成 toBe(true) 即是"修复确认"。
      expect(hasTestimonial).toBe(false);
      expect(hasLogo).toBe(false);
      expect(hasCase).toBe(false);

      // 另外验证 Product.assets 仍是空数组（核实 #6 根因的另一侧：
      // POST /api/products 初始化为空，生成路径读这个空数组）
      const prodRes = await request.get(`/api/products/${proj.productId}`);
      expect(prodRes.status()).toBe(200);
      const { product } = await prodRes.json();
      expect(product.assets).toEqual({ testimonials: [], cases: [], media: [] });
    } finally {
      // 恢复 AssetLibrary
      await request.put('/api/assets', { data: before }).catch(() => undefined);
      if (productId) await cleanupProject(request, productId);
    }
  });
});

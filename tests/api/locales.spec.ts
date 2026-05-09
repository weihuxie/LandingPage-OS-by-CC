/**
 * API-LOC-* · 多语言相关的读/写/删/预览/添加。
 * 对应用例文档:docs/testcases/api-testcases.md API-LOC 行。
 *
 * 其中 LOC-006(带双 key 添加日语)是 [需 KEY] 用例,用 test.skip 守护。
 */
import { test, expect } from '@playwright/test';
import { loginAndEnsureTenant } from '../helpers/user-auth';
import {
  cleanupProject,
  seedProject,
  seedMultiLocaleProject,
  getPage,
  patchPageFixture,
} from '../helpers/seed';
import { getCapabilities } from '../helpers/capabilities';

test.describe('API-LOC · Locales', () => {

  test.beforeEach(async ({ request }) => {
    await loginAndEnsureTenant(request);
  });
  test('API-LOC-001 · 跨 locale 单元格写入隔离', async ({ request }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      const before = await getPage(request, seeded.pageId);
      const zhA = JSON.stringify(before.variants.A['zh-CN']);
      const zhB = JSON.stringify(before.variants.B['zh-CN']);
      const jaB = JSON.stringify(before.variants.B.ja);

      const res = await request.patch(`/api/pages/${seeded.pageId}/modules`, {
        data: {
          variant: 'A',
          locale: 'ja',
          modules: [
            {
              id: 'm_ja',
              type: 'hero',
              content: { headline: '日本語のヘッドライン' },
            },
          ],
        },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.page.variants.A.ja.length).toBe(1);
      expect(body.page.variants.A.ja[0].content.headline).toBe('日本語のヘッドライン');

      // 其他单元格不被波及
      expect(JSON.stringify(body.page.variants.A['zh-CN'])).toBe(zhA);
      expect(JSON.stringify(body.page.variants.B['zh-CN'])).toBe(zhB);
      expect(JSON.stringify(body.page.variants.B.ja)).toBe(jaB);

      // 落库隔离
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.variants.A.ja[0].content.headline).toBe('日本語のヘッドライン');
      expect(JSON.stringify(fresh.variants.A['zh-CN'])).toBe(zhA);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-002 · 切换 defaultLocale', async ({ request }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      // A · 合法
      const okRes = await request.patch(`/api/pages/${seeded.pageId}`, {
        data: { defaultLocale: 'ja' },
      });
      expect(okRes.status()).toBe(200);
      expect((await okRes.json()).page.defaultLocale).toBe('ja');

      // B · 非法 (en 未加到 availableLocales) → 静默忽略,保留上一次值
      const badRes = await request.patch(`/api/pages/${seeded.pageId}`, {
        data: { defaultLocale: 'en' },
      });
      expect(badRes.status()).toBe(200);
      expect((await badRes.json()).page.defaultLocale).toBe('ja');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-003 · 删除非默认语言', async ({ request }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      const res = await request.delete(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'ja' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.page.availableLocales).toEqual(['zh-CN']);
      expect(body.page.variants.A.ja).toBeUndefined();
      expect(body.page.variants.B.ja).toBeUndefined();
      expect(body.page.defaultLocale).toBe('zh-CN');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-004 · 拒绝删除默认语言(仍有其他 locale 时)', async ({ request }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      const res = await request.delete(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'zh-CN' },
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('cannot remove default locale');

      // availableLocales 未变
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.availableLocales.sort()).toEqual(['ja', 'zh-CN']);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-005 · 预览本地化策略(无需 key)', async ({ request }) => {
    const seeded = await seedProject(request);
    try {
      const res = await request.post(`/api/pages/${seeded.pageId}/locales/preview`, {
        data: { locale: 'ja' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.strategy).toBeTruthy();
      expect(body.strategy.targetLocale).toBe('ja');
      expect(body.strategy.targetMarket).toBe('JP');
      expect(body.strategy.recommendedStyle).toBeDefined();
      expect(Array.isArray(body.strategy.recommendedModuleOrder)).toBe(true);
      expect(body.strategy.formChanges).toBeDefined();

      // availableLocales 未变(preview 只读)
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.availableLocales).toEqual(['zh-CN']);

      // 带自定义 market 再发一次
      const res2 = await request.post(`/api/pages/${seeded.pageId}/locales/preview`, {
        data: { locale: 'ja', market: 'US' },
      });
      const body2 = await res2.json();
      expect(body2.strategy.targetMarket).toBe('US');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-006 · [需 KEY] 添加一门新语言', async ({ request }) => {
    const caps = await getCapabilities(request);
    test.skip(!caps.ready.addLocale, 'requires ANTHROPIC_API_KEY + OPENAI_API_KEY');
    test.setTimeout(120_000);

    const seeded = await seedProject(request);
    try {
      // 先拿策略
      const prev = await request.post(`/api/pages/${seeded.pageId}/locales/preview`, {
        data: { locale: 'ja' },
      });
      const { strategy } = await prev.json();

      const res = await request.post(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'ja', strategy },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.page.availableLocales).toContain('ja');
      expect(Array.isArray(body.page.variants.A.ja)).toBe(true);
      expect(body.page.variants.A.ja.length).toBeGreaterThan(0);
      const heroA = body.page.variants.A.ja.find((m: any) => m.type === 'hero');
      const heroZh = body.page.variants.A['zh-CN'].find((m: any) => m.type === 'hero');
      expect(heroA.content.headline).toBeTruthy();
      expect(heroA.content.headline).not.toBe(heroZh.content.headline);

      // 落库
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.availableLocales).toContain('ja');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-007 · [无 KEY] 添加语言走 LLM_REQUIRED', async ({ request }) => {
    const caps = await getCapabilities(request);
    test.skip(caps.ready.addLocale, 'requires MISSING ANTHROPIC_API_KEY or OPENAI_API_KEY');

    const seeded = await seedProject(request);
    try {
      // 先拿策略(preview 无需 key)
      const prev = await request.post(`/api/pages/${seeded.pageId}/locales/preview`, {
        data: { locale: 'ja' },
      });
      const { strategy } = await prev.json();

      const res = await request.post(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'ja', strategy },
      });
      expect(res.status()).toBe(503);
      const body = await res.json();
      expect(body.code).toBe('LLM_REQUIRED');
      // Locale-add involves copy (deepseek default) → localize (openai
      // default). First-fail reports whichever scenario's chain[0] key
      // is missing; accept any of the involved provider keys.
      expect(body.missing).toMatch(/ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|OPENAI_API_KEY/);

      // 落库未污染
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.availableLocales).toEqual(['zh-CN']);
      expect(fresh.variants.A.ja).toBeUndefined();
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-008 · 重复添加已存在的 locale(幂等)', async ({ request }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      const res = await request.post(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'ja' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.note).toBe('locale already exists');
      expect(body.page.availableLocales.sort()).toEqual(['ja', 'zh-CN']);

      // 不触发 LLM — 验证方式:即便无 key 也能返回 200(上面的 expect 已覆盖)
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  /**
   * Feishu #15 · inheritance 完整版 —— 当 POST body 带 sourceLocale 且该
   * locale 已 hydrate 时,新 locale 必须克隆源 locale 的模块结构(order /
   * id / disabled / form.fieldSchemas / media refs),只翻译文案。
   *
   * 这条用例是本 feature 唯一"静默错配"风险点 —— 真正的回归表现是"日语
   * tab 有内容但模块少了两个"或"表单字段回到默认那五项",肉眼 QA 很难
   * 发现。必须钉死。
   *
   * 策略上:在 seed 出的 zh-CN 版本里手动改出一组"可识别"的结构特征
   * (改顺序 / disable 一个 / 自定义 form.fieldSchemas),然后添加 en 继承,
   * 用这些特征断言继承确实发生了 + 文案确实翻译了。
   */
  test('API-LOC-009 · [需 KEY] sourceLocale 继承保留结构并翻译文案', async ({ request }) => {
    const caps = await getCapabilities(request);
    test.skip(!caps.ready.addLocale, 'requires ANTHROPIC_API_KEY + OPENAI_API_KEY');
    test.setTimeout(120_000);

    const seeded = await seedProject(request);
    try {
      // 1. 先把 zh-CN 的结构改得"可识别": reorder + disable 一个 + form 自定义
      const page0 = await getPage(request, seeded.pageId);
      const zhMods: any[] = [...page0.variants.A['zh-CN']];

      // 把 benefits disable,用一个"只此 locale 有"的 flag 验证继承
      const benefitsIdx = zhMods.findIndex((m) => m.type === 'benefits');
      if (benefitsIdx !== -1) {
        zhMods[benefitsIdx] = { ...zhMods[benefitsIdx], disabled: true };
      }

      // form 模块改成自定义 fieldSchemas —— 用一组和默认不同的 key 顺序
      // + 自定义 label,继承后这些应该原样出现在 en 里。
      const formIdx = zhMods.findIndex((m) => m.type === 'form');
      if (formIdx !== -1) {
        zhMods[formIdx] = {
          ...zhMods[formIdx],
          content: {
            ...zhMods[formIdx].content,
            fieldSchemas: [
              { key: 'email', required: true, label: '工作邮箱(自定义)' },
              { key: 'name', required: true, label: '姓名(自定义)' },
              { key: 'message', label: '你想了解什么?' },
            ],
          },
        };
      }

      // 把最后一个模块挪到最前面,制造一个"非默认顺序"的 fingerprint
      const zhModsReordered = [zhMods[zhMods.length - 1], ...zhMods.slice(0, -1)];
      const expectedTypeOrder = zhModsReordered.map((m) => m.type);
      const expectedIds = zhModsReordered.map((m) => m.id);

      await patchPageFixture(seeded.pageId, {
        variants: {
          A: { 'zh-CN': zhModsReordered },
          B: page0.variants.B,
        },
      });

      // 2. 加 en,指定 sourceLocale=zh-CN
      const prev = await request.post(`/api/pages/${seeded.pageId}/locales/preview`, {
        data: { locale: 'en' },
      });
      const { strategy } = await prev.json();

      const res = await request.post(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'en', strategy, sourceLocale: 'zh-CN' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();

      // 响应里必须标记 inheritedFrom,方便前端显示"本地化自 zh-CN"提示
      expect(body.inheritedFrom).toBe('zh-CN');
      expect(body.page.availableLocales).toContain('en');

      const enModsA = body.page.variants.A.en as any[];
      expect(enModsA).toBeDefined();
      expect(enModsA.length).toBe(zhModsReordered.length);

      // a. 顺序 / 类型必须完全一致
      expect(enModsA.map((m) => m.type)).toEqual(expectedTypeOrder);
      // b. IDs 必须保留(跨 locale 相同 id,方便跨语言 track 同一模块)
      expect(enModsA.map((m) => m.id)).toEqual(expectedIds);
      // c. disabled flag 必须跟着继承
      const enBenefits = enModsA.find((m) => m.type === 'benefits');
      if (enBenefits) expect(enBenefits.disabled).toBe(true);
      // d. form.fieldSchemas 必须原样继承(key + 顺序 + 自定义 label)
      const enForm = enModsA.find((m) => m.type === 'form');
      if (enForm) {
        const schemas = enForm.content.fieldSchemas as any[];
        expect(schemas?.map((s) => s.key)).toEqual(['email', 'name', 'message']);
        // label 本身会被翻译,只断言 required/顺序不丢(label 是文案,翻了就翻了)
        expect(schemas?.[0].required).toBe(true);
        expect(schemas?.[1].required).toBe(true);
      }

      // e. 文案确实翻译了 —— hero headline 应该变了(from Chinese to English)
      const zhHero = zhModsReordered.find((m) => m.type === 'hero');
      const enHero = enModsA.find((m) => m.type === 'hero');
      if (zhHero && enHero) {
        expect(enHero.content.headline).toBeTruthy();
        expect(enHero.content.headline).not.toBe(zhHero.content.headline);
      }

      // 落库验证
      const fresh = await getPage(request, seeded.pageId);
      expect(fresh.variants.A.en.map((m: any) => m.type)).toEqual(expectedTypeOrder);
      expect(fresh.variants.A.en.map((m: any) => m.id)).toEqual(expectedIds);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  /**
   * resolveFormFields 是前端渲染 + 后端 lead 校验共用的 schema resolver。
   * 回归风险在两处:老页面只有 legacy fields[],新页面可能同时有 fields[]
   * 和 fieldSchemas[] —— resolver 必须在有 fieldSchemas 时优先用它(否则
   * 自定义 label / 顺序会被悄悄吃掉),在没有时 fall back。
   *
   * 纯函数,不走 HTTP,永远跑,CI 上零成本。
   */
  test('API-LOC-010 · resolveFormFields · fieldSchemas 优先 + fields fallback', () => {
    // 动态 import 放到测试里避免影响其他文件的 import graph
    const { resolveFormFields } = require('../../src/lib/types');

    // Case A · 只有 legacy fields[] → fallback 按顺序产出 spec
    const legacy = {
      title: 't',
      subtitle: 's',
      submitLabel: 'x',
      fields: ['name', 'email', 'company'],
    };
    const a = resolveFormFields(legacy);
    expect(a.map((s: any) => s.key)).toEqual(['name', 'email', 'company']);
    // fallback spec 只有 key,没有 label / required 等额外属性
    expect(a.every((s: any) => Object.keys(s).length === 1)).toBe(true);

    // Case B · 同时有 fieldSchemas + fields → fieldSchemas 胜出
    const mixed = {
      ...legacy,
      fieldSchemas: [
        { key: 'email', required: true, label: 'Work Email' },
        { key: 'phone', required: false },
      ],
    };
    const b = resolveFormFields(mixed);
    expect(b.map((s: any) => s.key)).toEqual(['email', 'phone']);
    expect(b[0].label).toBe('Work Email');
    expect(b[0].required).toBe(true);
    // fields[] 的旧顺序必须被忽略(防止 legacy 吃掉新自定义)
    expect(b.map((s: any) => s.key)).not.toContain('name');

    // Case C · fieldSchemas 为空数组 → 走 fallback
    const emptySchemas = { ...legacy, fieldSchemas: [] };
    const c = resolveFormFields(emptySchemas);
    expect(c.map((s: any) => s.key)).toEqual(['name', 'email', 'company']);
  });
});

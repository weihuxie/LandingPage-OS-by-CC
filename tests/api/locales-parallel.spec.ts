/**
 * API-LOC-P · 平行-locale sibling CRUD (P4 of 方案 B · 2026-04 refactor).
 *
 * 每个 (slug, locale) 是独立 KV 行,通过 localeGroupId 挂在同一个 group。
 * 这些用例只在 MULTI_LOCALE_AS_INSTANCES=1 + ADMIN_PASSWORD 同时存在时跑 ——
 * 关闭 flag 下的行为由已有的 LOC-001..LOC-009 覆盖,不重复。
 *
 * 关键约定(见 CLAUDE.md 四.五 + project_parallel_locale_refactor 记忆):
 *   - 首次 localize 一次性继承源 sibling 的模块结构 + GPT-4o 翻译
 *   - 新 sibling 永远以 published=false / publishedAt=undefined / deploy=null 开局
 *   - 之后每个 sibling 独立,DELETE 删整行,最后一个 sibling 不能删
 *
 * webServer 也必须带同样的 env 启动,否则 flag 在 server 侧不生效,
 * 测试会看到"POST 走的是 legacy 分支"的错配。
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  cleanupProject,
  seedProject,
  seedMultiLocaleProject,
  getPage,
} from '../helpers/seed';
import { getCapabilities } from '../helpers/capabilities';
import { getAdminPassword, loginAdminViaRequest } from '../helpers/admin';

/**
 * 把 seedMultiLocaleProject 产出的 legacy 双 locale 行拆成平行 siblings。
 * 返回 ja sibling 的新 id —— primary (zh-CN) 保留原 pageId。
 */
async function migrateToParallel(
  request: APIRequestContext,
  pageId: string,
): Promise<{ jaSiblingId: string; groupId: string }> {
  const cookie = await loginAdminViaRequest(request);
  const res = await request.post(
    `/api/admin/migrate-locales?pageId=${pageId}`,
    { headers: { cookie } },
  );
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.applied).toHaveLength(1);
  const entry = body.applied[0];
  expect(entry.pageId).toBe(pageId);
  expect(entry.newSiblingIds.length).toBeGreaterThan(0);
  return {
    jaSiblingId: entry.newSiblingIds[0],
    groupId: entry.groupId,
  };
}

test.describe('API-LOC-P · Parallel locale siblings', () => {
  test.skip(
    !process.env.MULTI_LOCALE_AS_INSTANCES,
    'requires MULTI_LOCALE_AS_INSTANCES=1 (dev server must also boot with it)',
  );
  test.skip(
    !getAdminPassword(),
    'requires ADMIN_PASSWORD for /api/admin/migrate-locales',
  );

  test('API-LOC-P001 · 重复添加已存在 locale(幂等 · 不触发 LLM)', async ({ request }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      const { jaSiblingId } = await migrateToParallel(request, seeded.pageId);

      // 在 primary 行上 POST ja —— server 应识别 sibling 已存在,
      // 直接短路返回现有 sibling,不会调 OpenAI。
      const res = await request.post(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'ja' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.note).toBe('locale already exists');
      // 返回的是 ja sibling 本身,不是 primary。
      expect(body.page.id).toBe(jaSiblingId);
      expect(body.page.locale).toBe('ja');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-P002 · 平行 DELETE 删整行 sibling', async ({ request }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      const { jaSiblingId } = await migrateToParallel(request, seeded.pageId);

      const res = await request.delete(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'ja' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.deletedSiblingId).toBe(jaSiblingId);
      expect(body.locale).toBe('ja');
      expect(body.remainingSiblings).toBe(1);

      // ja sibling 整行应被删除。
      const gone = await request.get(`/api/pages/${jaSiblingId}`);
      expect(gone.ok()).toBe(false);

      // Primary 还在,且仍归属 zh-CN。
      const primary = await getPage(request, seeded.pageId);
      expect(primary.id).toBe(seeded.pageId);
      expect(primary.locale ?? primary.defaultLocale).toBe('zh-CN');
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-P003 · 平行 DELETE 最后一个 sibling 被拒', async ({ request }) => {
    const seeded = await seedMultiLocaleProject(request);
    try {
      await migrateToParallel(request, seeded.pageId);

      // 先把 ja 删掉 —— 只剩 zh-CN primary 一个 sibling。
      const dropJa = await request.delete(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'ja' },
      });
      expect(dropJa.status()).toBe(200);

      // 再删 zh-CN —— 最后一个了,必须拒。
      const res = await request.delete(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'zh-CN' },
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/last sibling/i);

      // Primary 仍可读。
      const primary = await getPage(request, seeded.pageId);
      expect(primary.id).toBe(seeded.pageId);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });

  test('API-LOC-P004 · [需 OPENAI_API_KEY] 平行 POST 创建新 sibling · published=false', async ({
    request,
  }) => {
    const caps = await getCapabilities(request);
    test.skip(!caps.hasOpenAI, 'requires OPENAI_API_KEY (localizeModulesViaGpt)');
    test.setTimeout(120_000);

    // 用 legacy 单 locale seed —— POST handler 会在内部做 on-demand migration。
    const seeded = await seedProject(request);
    try {
      const before = await getPage(request, seeded.pageId);
      expect(before.defaultLocale).toBe('zh-CN');
      // 用 before 校验 primary 初始没有 group —— 断言迁移确实是 on-demand 触发的,
      // 不是老数据残留的 group id。
      expect(before.localeGroupId).toBeFalsy();

      const res = await request.post(`/api/pages/${seeded.pageId}/locales`, {
        data: { locale: 'ja' },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();

      // Sibling 创建流必须显式标 siblingCreated,前端靠这个字段区分平行创建
      // 和 legacy"往同一行塞新 locale"两条路径。
      expect(body.siblingCreated).toBe(true);
      expect(body.inheritedFrom).toBe('zh-CN');
      expect(body.localeGroupId).toBeTruthy();
      expect(body.localizeProviderUsed).toBe('openai');

      // 方案 B lock:新 sibling 永远暗跑,不继承 primary 发布态。
      expect(body.page.published).toBe(false);
      expect(body.page.publishedAt).toBeFalsy();
      expect(body.page.deploy).toBeNull();

      // Id 必须是新的,locale/defaultLocale/availableLocales 都应该只有 ja。
      expect(body.page.id).not.toBe(seeded.pageId);
      expect(body.page.localeGroupId).toBe(body.localeGroupId);
      expect(body.page.locale).toBe('ja');
      expect(body.page.defaultLocale).toBe('ja');
      expect(body.page.availableLocales).toEqual(['ja']);

      // A/B 两份 ja modules 都要在,且非空(才能证明真翻译了)。
      expect(Array.isArray(body.page.variants.A.ja)).toBe(true);
      expect(body.page.variants.A.ja.length).toBeGreaterThan(0);
      expect(Array.isArray(body.page.variants.B.ja)).toBe(true);
      expect(body.page.variants.B.ja.length).toBeGreaterThan(0);

      // Primary 在 POST 过程中被 in-place 迁移 —— 现在应该带 group id。
      const afterPrimary = await getPage(request, seeded.pageId);
      expect(afterPrimary.localeGroupId).toBe(body.localeGroupId);
      expect(afterPrimary.locale ?? afterPrimary.defaultLocale).toBe('zh-CN');

      // Sibling 行可独立 GET。
      const fresh = await getPage(request, body.page.id);
      expect(fresh.id).toBe(body.page.id);
      expect(fresh.locale).toBe('ja');
      expect(fresh.localeGroupId).toBe(body.localeGroupId);
      expect(fresh.published).toBe(false);
    } finally {
      await cleanupProject(request, seeded.productId);
    }
  });
});

/**
 * E2E-LEAD-001 · 公网落地页提交线索,成功反馈 + Dashboard 计数增加。
 * 对应用例文档:docs/testcases/e2e-testcases.md E2E-LEAD 行。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedProject, getPage, patchPageFixture } from '../helpers/seed';

test.describe('E2E-LEAD · Lead submission', () => {
  test('E2E-LEAD-001 · 公网落地页提交线索 → 成功反馈 + 计数 +1', async ({ page, request }) => {
    const seeded = await seedProject(page.context().request);
    try {
      // 种子默认 published=false,/p/[slug] 会显示 "not published yet"。
      // 无 key 环境下 deploy 走不通(见 E2E-PUB-001),所以直接改磁盘发布位。
      await patchPageFixture(seeded.pageId, { published: true });

      const before = await getPage(page.context().request, seeded.pageId);
      const n0 = before.stats?.leads ?? 0;

      await page.goto(`/p/${seeded.slug}`);

      // 滚到表单区(#contact 锚点)
      await page.locator('#contact').scrollIntoViewIfNeeded();

      // 填姓名、邮箱(必填字段)— 用 placeholder 定位,兼容 i18n
      const name = page.locator('#contact input[placeholder="姓名"]').first();
      const email = page.locator('#contact input[placeholder="工作邮箱"]').first();
      if (await name.count()) await name.fill('E2E 张三');
      await email.fill(`e2e-lead-${Date.now()}@test.com`);

      // 勾选同意 checkbox(LeadFormClient.tsx:77 — !consent 会阻止 submit)
      const consent = page.locator('#contact input[type="checkbox"]').first();
      if (await consent.count()) await consent.check();

      // 提交
      await page
        .locator('#contact button[type="submit"], #contact button:has-text("预约演示")')
        .first()
        .click();

      // 成功卡片(LeadFormClient.tsx:101-107)
      await expect(page.locator('#contact').getByText(/已收到|Got it|受け付け/)).toBeVisible({
        timeout: 10_000,
      });

      // Dashboard 的 leads 计数 +1
      await page.goto('/zh-CN/dashboard');
      // 卡片里有 "X leads" 文本;匹配 (n0+1) leads
      await expect(
        page.locator(`text=/${n0 + 1} leads/`).first(),
      ).toBeVisible({ timeout: 5_000 });

      // API 验证
      const after = await getPage(page.context().request, seeded.pageId);
      expect(after.stats.leads).toBe(n0 + 1);
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });
});

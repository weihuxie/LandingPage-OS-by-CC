/**
 * E2E-SET-* · 编辑器 Settings 弹窗的六种字段保存。
 * 对应用例文档:docs/testcases/e2e-testcases.md E2E-SET 行。
 */
import { test, expect } from '@playwright/test';
import { cleanupProject, seedProject, getPage, getProduct } from '../helpers/seed';

/** 打开 Editor 内的 Settings 弹窗(通过 ⋮ 菜单 → ⚙ 设置) */
async function openSettings(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('button', { name: /设置.+风格.+语气.+主色/ }).click();
  // 等待弹窗出现
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('E2E-SET · Settings modal', () => {
  test('E2E-SET-001 · 改产品名 → 关闭弹窗后 Dashboard 卡片跟着变', async ({ page, request }) => {
    const seeded = await seedProject(page.context().request, { name: `E2E-SET-001-orig-${Date.now()}` });
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await openSettings(page);

      // label + input 是兄弟节点(不是父子),所以用 + 相邻兄弟选择器
      const nameInput = page.locator('label:has-text("产品名") + input').first();
      const newName = `RenamedProduct-${Date.now()}`;
      await nameInput.fill(newName);
      await nameInput.blur();

      // 弹窗内徽章
      await expect(page.locator('text=已保存 ✓')).toBeVisible({ timeout: 5_000 });

      // 关弹窗,去 Dashboard 断言
      await page.keyboard.press('Escape');
      await page.goto('/zh-CN/dashboard');
      await expect(page.getByText(newName)).toBeVisible();
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });

  test('E2E-SET-002 · 改 Tagline → API 验证新值', async ({ page, request }) => {
    const seeded = await seedProject(page.context().request);
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await openSettings(page);

      const taglineInput = page.locator('label:has-text("Tagline") + input').first();
      const newTag = 'E2E new tagline';
      await taglineInput.fill(newTag);
      await taglineInput.blur();

      await expect(page.locator('text=已保存 ✓')).toBeVisible({ timeout: 5_000 });

      const product = await getProduct(page.context().request, seeded.productId);
      expect(product.tagline).toBe(newTag);
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });

  test('E2E-SET-003 · 改产品 Value(核心价值)', async ({ page, request }) => {
    const seeded = await seedProject(page.context().request, { value: 'seed value' });
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await openSettings(page);

      const valueArea = page.locator('label:has-text("核心价值") + textarea').first();
      const newValue = 'E2E-SET-003 新价值';
      await valueArea.fill(newValue);
      await valueArea.blur();
      await expect(page.locator('text=已保存 ✓')).toBeVisible({ timeout: 5_000 });

      // 关弹窗再开,验证本地状态已刷新
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await openSettings(page);
      const reopened = page.locator('label:has-text("核心价值") + textarea').first();
      await expect(reopened).toHaveValue(newValue);
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });

  test('E2E-SET-004 · 切换风格预设(PATCH /api/projects/[id] { newStyleId })', async ({
    page,
    request,
  }) => {
    const seeded = await seedProject(page.context().request);
    try {
      const before = await getPage(page.context().request, seeded.pageId);
      const currentStyleId = before.theme.styleId;

      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await openSettings(page);

      // 风格 section 下所有卡片按钮 — 选一个非当前选中的
      const styleSection = page
        .getByRole('dialog')
        .locator('div:has(> .label:has-text("风格")), div:has(> div.label:has-text("风格"))')
        .first();
      const styleCards = styleSection.locator('button');
      const count = await styleCards.count();
      let targetIdx = -1;
      for (let i = 0; i < count; i++) {
        const cls = await styleCards.nth(i).getAttribute('class');
        if (cls && !cls.includes('border-brand-300')) {
          targetIdx = i;
          break;
        }
      }
      expect(targetIdx).toBeGreaterThanOrEqual(0);
      await styleCards.nth(targetIdx).click();

      // 验证选中态移动了(目标卡片现在有 border-brand-300)
      await expect(styleCards.nth(targetIdx)).toHaveClass(/border-brand-300/);

      // 关弹窗,服务端落库验证
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const after = await getPage(page.context().request, seeded.pageId);
      expect(after.theme.styleId).not.toBe(currentStyleId);
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });

  test('E2E-SET-005 · 切换 Tone 走自动保存', async ({ page, request }) => {
    const seeded = await seedProject(page.context().request);
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await openSettings(page);

      const toneSelect = page
        .getByRole('dialog')
        .locator('select')
        .first();
      // 读当前值,选一个不同的
      const current = await toneSelect.inputValue();
      const target = current === 'professional' ? 'executive' : 'professional';
      await toneSelect.selectOption(target);

      // 关弹窗触发自动保存 + 防抖
      await page.keyboard.press('Escape');
      // 等防抖 400ms + 网络
      await page.waitForTimeout(1_500);

      // 顶部工具栏保存徽章应该曾出现(SaveStateBadge 状态机)
      // 验证策略:刷新页面,重开弹窗,select value 应该是 target
      await page.reload();
      await openSettings(page);
      const toneAfter = page.getByRole('dialog').locator('select').first();
      await expect(toneAfter).toHaveValue(target);

      const fresh = await getPage(page.context().request, seeded.pageId);
      expect(fresh.tone).toBe(target);
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });

  test('E2E-SET-006 · 改主色 → Hex 输入框 + preview 响应', async ({ page, request }) => {
    const seeded = await seedProject(page.context().request);
    try {
      await page.goto(`/zh-CN/projects/${seeded.pageId}`);
      await openSettings(page);

      // 主色的标题是 <div class="label">主色</div>(不是 <label>),
      // 下方第二个 input 是 hex 文本框(第一个是 type="color" 吸管)。
      const colorRow = page
        .getByRole('dialog')
        .locator('div:has(> div.label:has-text("主色"))')
        .first();
      const hexInput = colorRow.locator('input').nth(1);
      await hexInput.fill('#ff00aa');
      await hexInput.blur();
      await page.waitForTimeout(1_500); // 400ms 防抖 + 网络

      // 刷新再读 hex 值仍存在
      await page.reload();
      await openSettings(page);
      const colorRowAfter = page
        .getByRole('dialog')
        .locator('div:has(> div.label:has-text("主色"))')
        .first();
      const hexAfter = colorRowAfter.locator('input').nth(1);
      await expect(hexAfter).toHaveValue('#ff00aa');

      const fresh = await getPage(page.context().request, seeded.pageId);
      expect(fresh.theme.primary?.toLowerCase()).toBe('#ff00aa');
    } finally {
      await cleanupProject(page.context().request, seeded.productId);
    }
  });
});

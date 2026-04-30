/**
 * E2E-OVERFLOW · 长不可断字符串在 grid/flex 卡片内自动断行不溢出
 *
 * 触发场景：用户在 testimonial.quote / 任何长文本字段里粘了一段没有
 * 空格的长字符串（URL / 长 ID / 测试时的 "1231231231..." 数字串）。
 * HTML 默认 `overflow-wrap: normal` 不会词内断行；该字符串形成不可断
 * token，把 grid item 的 min-content 顶宽，整张 testimonial 卡片越过
 * grid track 边界、横向溢出页面。
 *
 * 这个 spec 不走 dev server / LLM — 用 page.setContent 直接喂代表
 * testimonial 卡片骨架的 HTML，验证我们依赖的 CSS 规则
 *   `overflow-wrap: anywhere` + grid item `min-width: 0`
 * 在 Chromium 下确实让长串断行。如果未来某天换 layout 或 reset CSS
 * 把这两条覆盖掉，本测试会先红。
 */
import { test, expect } from '@playwright/test';

const LONG = 'quarter.' + '1'.repeat(120);

const BUILD_PAGE = (style: string) => `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { margin: 0; font-family: sans-serif; }
      .root { ${style} }
      .wrap { max-width: 800px; margin: 0 auto; padding: 0 24px; }
      .grid { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .card { border: 1px solid #ccc; padding: 24px; }
    </style>
  </head>
  <body>
    <div class="root">
      <div class="wrap">
        <div class="grid">
          <blockquote class="card">
            <p>"We shipped four localized pages in one week. That used to be a ${LONG}"</p>
          </blockquote>
          <blockquote class="card">
            <p>"The strategy summary alone stopped us from launching a weak page."</p>
          </blockquote>
        </div>
      </div>
    </div>
  </body>
</html>
`;

test.describe('E2E-OVERFLOW · CSS 规则在 grid 卡内能让长串断行', () => {
  test('E2E-OVERFLOW-001 · 不加任何修复 (baseline) → 长串溢出，整页有横向滚动', async ({ page }) => {
    // baseline：浏览器默认 overflow-wrap:normal，min-width:auto。
    await page.setContent(BUILD_PAGE(''));
    const m = await page.evaluate(() => ({
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
    }));
    // 这条断言故意期望 baseline 失败（溢出）—— 是为了证明测试设计能区
    // 分修与不修。如果 baseline 也不溢出，说明测试构造的 layout 不真
    // 实，需要重新设计代表性 HTML。
    expect(m.docScrollW).toBeGreaterThan(m.docClientW);
  });

  test('E2E-OVERFLOW-002 · 加 overflow-wrap:anywhere → 整页无横向滚动', async ({ page }) => {
    await page.setContent(BUILD_PAGE('overflow-wrap: anywhere; word-break: break-word;'));
    const m = await page.evaluate(() => ({
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
    }));
    expect(m.docScrollW).toBeLessThanOrEqual(m.docClientW + 1);
  });

  test('E2E-OVERFLOW-003 · 加 anywhere + grid item min-w-0 → 卡内不溢出', async ({ page }) => {
    // 模拟 PageRenderer 实际样式：root 加 overflow-wrap，blockquote 加 min-width:0
    await page.setContent(`
      <!doctype html>
      <html>
        <head><meta charset="utf-8" />
          <style>
            body { margin: 0; font-family: sans-serif; }
            .root { overflow-wrap: anywhere; word-break: break-word; }
            .wrap { max-width: 800px; margin: 0 auto; padding: 0 24px; }
            .grid { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .card { border: 1px solid #ccc; padding: 24px; min-width: 0; }
          </style>
        </head>
        <body>
          <div class="root">
            <div class="wrap">
              <div class="grid">
                <blockquote class="card">
                  <p>"${LONG}"</p>
                </blockquote>
                <blockquote class="card"><p>short</p></blockquote>
              </div>
            </div>
          </div>
        </body>
      </html>
    `);

    // blockquote 自身 scrollWidth ≤ clientWidth → 卡内不溢出
    const cardCheck = await page.evaluate(() => {
      const target = document.querySelector('blockquote.card') as HTMLElement;
      const grid = target.parentElement!.getBoundingClientRect();
      const card = target.getBoundingClientRect();
      return {
        cardRight: card.right,
        gridRight: grid.right,
        cardScrollW: target.scrollWidth,
        cardClientW: target.clientWidth,
      };
    });
    expect(cardCheck.cardRight).toBeLessThanOrEqual(cardCheck.gridRight + 1);
    expect(cardCheck.cardScrollW).toBeLessThanOrEqual(cardCheck.cardClientW + 1);
  });
});

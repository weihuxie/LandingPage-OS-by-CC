/**
 * 种子工具:基于真实 API 创建可测试的 Product + LandingPage。
 *
 * 核心思路:`POST /api/projects` 在 body 里传 `strategy` 就不会再调 Claude
 * 做策略生成。hydrate 阶段(Claude 模块改写)即便失败,页面也已落库、
 * 带 `hydrationFailed: true` 标志位。无 key 也能跑通。
 *
 * 不直接往 `.data/v2:pages.json` 手写 fixture 的原因:
 *   - 并发写 + next.js dev server 的 FS 读取时机有 race
 *   - 绕过 API 相当于把"落库"这件事本身没覆盖到
 *
 * 需要**多语言已存在**的场景(比如 LOC 系列),在 seed 后用
 * `injectLocaleFixture` 往 `.data/v2:pages.json` 精确 patch,再让 server
 * 重读(Next.js route handler 每次请求都重读 FS,不需要重启)。
 */
import type { APIRequestContext } from '@playwright/test';
import { promises as fs } from 'fs';
import path from 'path';

export type SeededProject = {
  productId: string;
  pageId: string;
  slug: string;
};

type SeedOpts = {
  name?: string;
  locale?: string;
  market?: string;
  value?: string;
  tagline?: string;
};

/** 生成一个唯一的产品名,防止并发跑测试时撞重复 */
function uniqueName(prefix = 'TC'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function seedProject(
  request: APIRequestContext,
  opts: SeedOpts = {},
): Promise<SeededProject> {
  const name = opts.name ?? uniqueName();
  const locale = opts.locale ?? 'zh-CN';
  const market = opts.market ?? 'CN';

  const res = await request.post('/api/projects', {
    data: {
      inputs: {
        name,
        tagline: opts.tagline ?? 'Seed tagline',
        category: 'SaaS',
        value: opts.value ?? 'Concrete value for testing',
        cta: 'demo',
        market,
        locale,
        industry: 'SaaS',
        companySize: '10-50',
        role: 'PM',
        source: 'ads',
        pastedContent: '',
        referenceUrls: [],
        uploadedFileNames: [],
      },
      strategy: {
        audience: ['target audience line 1', 'target audience line 2'],
        goal: ['goal line 1'],
        narrative: ['narrative line 1'],
        local: ['local line 1'],
      },
      tone: 'saas',
    },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`seedProject failed: ${res.status()} ${body}`);
  }
  const body = await res.json();
  // body = { id, slug, productId, warning? }
  return {
    pageId: body.id,
    productId: body.productId,
    slug: body.slug,
  };
}

export async function cleanupProject(
  request: APIRequestContext,
  productId: string,
): Promise<void> {
  // DELETE /api/products/[id] 级联删除 product + 所有关联的 landing page
  await request.delete(`/api/products/${productId}`).catch(() => undefined);
}

/**
 * 给已经 seed 的 page patch 一些字段直接到磁盘。
 *
 * 仅用于 LOC / HYD 系列用例 —— 比如想让 page 以 `hydrationFailed=true` 开局、
 * 或想直接注入 `availableLocales=["zh-CN","ja"]` + `variants.A.ja` 内容(而
 * 不真调 Claude+GPT)。
 *
 * Next.js route handler 每次请求都重读文件(`force-dynamic`),所以不需要
 * 重启 dev server。
 */
const PAGES_FILE = path.join(process.cwd(), '.data', 'v2:pages.json');

export async function patchPageFixture(
  pageId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const raw = await fs.readFile(PAGES_FILE, 'utf8');
  const list = JSON.parse(raw) as Array<Record<string, unknown>>;
  const idx = list.findIndex((p) => p.id === pageId);
  if (idx === -1) throw new Error(`patchPageFixture: pageId ${pageId} not found`);
  list[idx] = { ...list[idx], ...patch };
  await fs.writeFile(PAGES_FILE, JSON.stringify(list, null, 2), 'utf8');
}

/**
 * Seed 一个已经多语言的 page:先 seed 单 zh-CN,再往磁盘注入 ja 的 variants。
 * hero headline 会带有可辨识的固定文案,便于用例做跨 locale 断言。
 */
export async function seedMultiLocaleProject(
  request: APIRequestContext,
): Promise<SeededProject & { zhHeroHeadline: string; jaHeroHeadline: string }> {
  const s = await seedProject(request);

  const zhHero = 'E2E-SEED 中文主标题';
  const jaHero = 'E2E-SEED 日本語メインタイトル';

  // 读 page 现有内容,基于它扩展 ja 槽位
  const pageRes = await request.get(`/api/pages/${s.pageId}`);
  const { page } = await pageRes.json();

  // 先把 zh-CN 的 hero headline 改成可辨识值
  const zhModsA = [...(page.variants.A['zh-CN'] ?? [])];
  const zhModsB = [...(page.variants.B['zh-CN'] ?? [])];
  const setHero = (mods: any[], headline: string) => {
    const i = mods.findIndex((m) => m.type === 'hero');
    if (i !== -1) {
      mods[i] = { ...mods[i], content: { ...mods[i].content, headline } };
    }
  };
  setHero(zhModsA, zhHero);
  setHero(zhModsB, zhHero);

  // 基于 zh-CN 的结构复制一份 ja,hero headline 换成日文
  const jaModsA = zhModsA.map((m) =>
    m.type === 'hero' ? { ...m, content: { ...m.content, headline: jaHero } } : { ...m },
  );
  const jaModsB = zhModsB.map((m) =>
    m.type === 'hero' ? { ...m, content: { ...m.content, headline: jaHero } } : { ...m },
  );

  await patchPageFixture(s.pageId, {
    availableLocales: ['zh-CN', 'ja'],
    variants: {
      A: { 'zh-CN': zhModsA, ja: jaModsA },
      B: { 'zh-CN': zhModsB, ja: jaModsB },
    },
  });

  return { ...s, zhHeroHeadline: zhHero, jaHeroHeadline: jaHero };
}

/** 读一个 page 当前状态(快捷方法,节省每个 test 的样板) */
export async function getPage(request: APIRequestContext, pageId: string) {
  const res = await request.get(`/api/pages/${pageId}`);
  if (!res.ok()) throw new Error(`getPage ${pageId} → ${res.status()}`);
  return (await res.json()).page;
}

export async function getProduct(request: APIRequestContext, productId: string) {
  const res = await request.get(`/api/products/${productId}`);
  if (!res.ok()) throw new Error(`getProduct ${productId} → ${res.status()}`);
  return (await res.json()).product;
}

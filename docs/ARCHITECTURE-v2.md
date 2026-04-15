# LandingPage OS v2 · 架构设计文档

> 本文是**重构提案**，待 review 后实施。
> 目标：一次性解决 Q1（资产库分层）/ Q2（Project→Product 命名）/ Q3（页内多语言切换）。

---

## 0 · 驱动场景

**场景 A · 峰会展位**（核心驱动场景）
东京 B2B 峰会展位扫码落地页。现场人群混合：日本本地人 / 港资华人 / 美国客户。一张海报一个 QR。**每个人看到自己的语言**。

**场景 B · CEO 管多产品**
一家公司卖 One-Flow + WinPilot 两条产品线。公司 Logo / SOC 2 / TechCrunch 报道**复用**；各产品的证言和案例**隔离**。

**场景 C · 多市场营销运营**
WinPilot 同时跑"日本企业版主站"、"美国 Q4 Webinar 活动页"、"黑五促销页"三个页面。数据要分开看，但都属于 WinPilot 这个产品。

---

## 1 · 数据模型

### 1.1 三层结构

```
User
 └── Product (品牌视觉 + 产品级资产)
       └── LandingPage (一张活动页 / 一个市场)
             └── LocalizedContent × N (每种语言一套模块)
```

### 1.2 TypeScript 类型

```ts
// ===== Product 层 =====
interface Product {
  id: string;
  ownerId: string;              // RLS 用
  createdAt: number;
  updatedAt: number;

  name: string;                 // "WinPilot"
  tagline: string;              // 产品一句话定位（跨语言跨市场不变的核心）
  category: string;             // "Sales Enablement"
  website?: string;             // 官网 URL（用于品牌色抓取）

  // 品牌视觉 (产品级独立，也可从 Brand 继承)
  theme: {
    primary: string;
    styleId: StyleId;
    fontStack?: string;
    logoUrl?: string;
  };

  // 产品级资产（归属此产品，不跨产品复用）
  assets: {
    testimonials: TestimonialAsset[];  // "XX 用 WinPilot 省了 11 小时"
    cases: CaseStudyAsset[];           // "帮 Acme 做到 3.8× ROI"
    heroMedia?: string[];              // 产品截图、产品视频封面
  };

  // 关联的 LandingPage 列表（在 UI 上展示，不在 Product 内嵌）
  landingPageIds: string[];
}

// ===== 品牌层 (Brand — 用户全局共享) =====
interface Brand {
  ownerId: string;               // 一个用户一个 Brand
  companyName: string;
  logos: string[];               // 多版本
  primaryColor: string;
  secondaryColor?: string;
  fontStack?: string;

  // 跨产品共享的资产
  certifications: CertificationAsset[];  // SOC 2 / ISO / ISMS
  press: PressAsset[];                    // 媒体背书
  sharedCases: CaseStudyAsset[];          // 公司级标杆客户
}

// ===== LandingPage 层 =====
interface LandingPage {
  id: string;
  productId: string;             // 归属哪个产品
  slug: string;                  // URL 用
  createdAt: number;
  updatedAt: number;

  purpose: 'main' | 'campaign' | 'event' | 'ab-experiment';
  name: string;                  // "主站" / "Q4 Webinar 活动页"
  targetMarket: MarketCode;      // 主要市场，决定默认风格

  defaultLocale: PageLocale;     // 没检测到访客语言时的兜底
  availableLocales: PageLocale[];// 该页支持哪些语言（只有生成过的才进来）

  variants: {
    A: LocalizedContent;         // 方案 A · 痛点叙事（跨语言）
    B: LocalizedContent;         // 方案 B · 收益叙事（跨语言）
  };

  activeVariant: 'A' | 'B';
  publishMode: 'single' | 'ab-split';

  published: boolean;
  publishedAt?: number;
  deploy?: DeployRecord;

  stats: {
    views: number;
    leads: number;
    byLocale: Record<PageLocale, { views: number; leads: number }>;
    abStats: { A: {...}, B: {...} };
  };
}

interface LocalizedContent {
  [locale: PageLocale]: PageModule[] | undefined;
  // e.g. { 'ja': [hero, pain, ...], 'en': [hero, pain, ...], 'zh-CN': undefined }
}

type PageLocale = 'zh-CN' | 'zh-TW' | 'ja' | 'en';
type MarketCode = 'CN' | 'TW' | 'JP' | 'US' | 'EU' | 'GLOBAL';
```

### 1.3 数据关系图

```
User ──1:1── Brand (全局)
  │
  └──1:N── Product
              └──1:N── LandingPage
                          └──1:N── LocalizedContent[A|B][locale]
```

---

## 2 · 本地化核心逻辑

### 2.1 访客语言检测（public page 加载时）

优先级从高到低：

```ts
function detectLocale(req, project): PageLocale {
  // 1. 显式 query param
  const fromUrl = req.query.lang?.toLowerCase();
  if (project.availableLocales.includes(fromUrl)) return fromUrl;

  // 2. sticky cookie (返回访客)
  const fromCookie = req.cookies.lp_lang;
  if (project.availableLocales.includes(fromCookie)) return fromCookie;

  // 3. Accept-Language 头（浏览器设置）
  const acceptLang = parseAcceptLanguage(req.headers['accept-language']);
  for (const { locale } of acceptLang) {
    const match = bestMatch(locale, project.availableLocales);
    if (match) return match;
  }

  // 4. IP 国家映射（Vercel 提供 cf-ipcountry 头）
  const country = req.headers['cf-ipcountry'] ?? req.headers['x-vercel-ip-country'];
  const countryDefault = countryToLocale(country); // JP→ja, CN→zh-CN, TW→zh-TW, US→en, ...
  if (project.availableLocales.includes(countryDefault)) return countryDefault;

  // 5. 项目 defaultLocale
  return project.defaultLocale;
}
```

### 2.2 语言切换器 UX（public page 底部 sticky）

```
┌───────────────────────────────────────────────────────┐
│                                                       │
│               ... 页面内容 ...                         │
│                                                       │
│   ┌─────────────────────────────────────────────┐    │
│   │  🌐  日本語  ·  中文  ·  English   │ 灰  ◉  │    │← 固定底部
│   │       (当前)                (可切)      未生成 │    │
│   └─────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────┘
```

- 高亮当前语言
- 点击切换 → 更新 URL `?lang=xx` + 写 cookie `lp_lang` + **客户端重渲染**（不用刷新）
- 未生成的语言**灰化 + 不可点**（或完全隐藏）
- 小图标 🌐 + 语言母语名字（"日本語" 不是 "Japanese"）

### 2.3 页面结构 · 客户端 hydration

```tsx
// Server component
export default async function PublicPage({ params, searchParams }) {
  const page = await getLandingPage(params.slug);
  const locale = detectLocale(req, page);
  const variant = detectVariant(req, page);

  // 读当前语言内容，以及所有可用语言（给 switcher）
  const content = page.variants[variant][locale];

  return (
    <>
      <HrefLangHead page={page} />
      <TrackView slug={page.slug} locale={locale} variant={variant} />

      {/* 所有语言的模块都预渲染成 data-attr，切换不用网络 */}
      <LocaleBundle page={page} initialLocale={locale} initialVariant={variant} />

      <LanguageSwitcher
        slug={page.slug}
        current={locale}
        available={page.availableLocales}
      />
    </>
  );
}
```

**核心优化**：首次渲染用服务端检测的 locale（SEO 友好），同时把所有已生成语言的模块 JSON 塞到 HTML 里（`<script type="application/json">`）。切换器点击时**不发请求**，直接从内存换内容。

### 2.4 "本地化 ≠ 翻译" 的强化

每种语言的模块生成走独立模板（现有 [ai.ts](../src/lib/ai.ts) 的 `L.en / L.ja / L.zh-CN / L.zh-TW`）。**切换语言时视觉也切**：

| 语言 | 风格默认 | 字体栈 | 表单字段 |
|---|---|---|---|
| ja | minimal-trust | Noto Sans JP | 含 phone |
| en | bold-roi | Inter 800 | 不含 phone |
| zh-CN | saas-modern | Inter + Noto Sans SC | 不含 phone |
| zh-TW | enterprise-clean | Source Han Sans TC | 不含 phone |

也就是说切换到日文 ≠ 换字符串，而是整套 CSS 变量 + 模块组都替换。

---

## 3 · SEO · hreflang

每个 LandingPage 的 `<head>` 注入：

```html
<link rel="canonical" href="https://.../p/winpilot" />
<link rel="alternate" hreflang="ja" href="https://.../p/winpilot?lang=ja" />
<link rel="alternate" hreflang="zh-Hans" href="https://.../p/winpilot?lang=zh-CN" />
<link rel="alternate" hreflang="zh-Hant" href="https://.../p/winpilot?lang=zh-TW" />
<link rel="alternate" hreflang="en" href="https://.../p/winpilot?lang=en" />
<link rel="alternate" hreflang="x-default" href="https://.../p/winpilot" />
```

`canonical` 指向**无 lang 参数**的主 URL，Google 视为同一页面的多语言版本而非重复内容。

---

## 4 · API 面

### 4.1 新增端点

```
GET  /api/products                     列出当前用户所有产品
POST /api/products                     新建产品
GET  /api/products/:id                 产品详情（含资产 + 关联 page 列表）
PATCH /api/products/:id                更新产品
DELETE /api/products/:id                删除产品（级联删 pages）

GET  /api/products/:id/pages           列出某产品下的页面
POST /api/products/:id/pages           新建页面（需提供主要语言）

GET  /api/pages/:id                    页面详情（所有已生成语言的 content）
PATCH /api/pages/:id                   更新页面
DELETE /api/pages/:id                  删除页面

POST /api/pages/:id/locales            给页面添加一个新语言（生成 LocalizedContent）
DELETE /api/pages/:id/locales/:locale  删除一个语言版本

GET  /api/brand                        当前用户全局品牌信息
PUT  /api/brand                        更新品牌
```

### 4.2 保留（向后兼容一段时间）

```
GET  /api/projects           → 内部转 /api/products 列表（flatten 到 LandingPage）
POST /api/projects           → 内部隐式建 Product（如果用户没有）+ LandingPage
```

旧链接继续工作，避免用户现存分享链接失效。

### 4.3 事件上报 · 多语言维度

```
POST /api/events
body: { slug, type, variant, locale, ... }
```

`locale` 字段原来就有，但现在 slug 解析后会找到 LandingPage 而非项目；事件存储时同时更新：
- `LandingPage.stats.views++`
- `LandingPage.stats.byLocale[locale].views++`
- `LandingPage.stats.abStats[variant].views++`

### 4.4 看板升级 · 多语言下钻

`GET /api/analytics` 响应增加：

```json
{
  "kpi": { ...全局 },
  "perProduct": [
    {
      "id": "winpilot",
      "name": "WinPilot",
      "totalViews": 5400,
      "totalLeads": 148,
      "cvr": 0.0274,
      "pages": [
        {
          "id": "page-main",
          "name": "主站",
          "byLocale": {
            "ja": { "views": 1200, "leads": 50, "cvr": 0.0417 },
            "en": { "views": 3400, "leads": 95, "cvr": 0.0279 },
            "zh-CN": { "views": 800, "leads": 3, "cvr": 0.0038 }
          }
        }
      ]
    }
  ],
  "suggestions": [ ... ]
}
```

看板 UI：展开一个产品 → 看各 LandingPage → 再展开 → 看各语言 CVR。

---

## 5 · UI 动线

### 5.1 导航调整

```
顶部：  Dashboard · 资产库 · 增长看板 · 新建产品
                                             ↑
                                    不是 "新建项目" 了
```

### 5.2 Dashboard 改成"产品卡片"

```
┌─────────────────────────┐  ┌─────────────────────────┐
│  WinPilot               │  │  One-Flow               │
│  Sales Enablement       │  │  Ops Automation         │
│                         │  │                         │
│  📄 3 landing pages     │  │  📄 1 landing page      │
│  🌐 ja · en · zh-CN     │  │  🌐 zh-CN                │
│  📊 5400 UV · 148 leads │  │  📊 1200 UV · 48 leads  │
│                         │  │                         │
│  [打开产品 →]           │  │  [打开产品 →]           │
└─────────────────────────┘  └─────────────────────────┘
```

### 5.3 产品详情页

```
┌───────────────────────────────────────────────────┐
│  WinPilot                                          │
│  Sales Enablement · winpilot.com                   │
├───────────────────────────────────────────────────┤
│  [ 页面 ] [ 证言 ] [ 案例 ] [ 品牌 ]               │
├───────────────────────────────────────────────────┤
│                                                    │
│  Landing Pages                    [+ 新建页面]    │
│  ┌────────────────────────────────────────────┐  │
│  │ 主站 · 日本/北美                            │  │
│  │ 🌐 ja · en · zh-CN                   已发布 │  │
│  │ 5,400 UV · 148 leads · 2.74% CVR            │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │ Q4 Webinar                                 │  │
│  │ 🌐 en                                 草稿   │  │
│  └────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

### 5.4 编辑器增加"语言 tab"

原来的编辑器 3 列不变，**中间预览区域顶部加一行语言 tab**：

```
┌───────────────────────────────────────────────────┐
│  [日本語*] [English] [简中+] [繁中+]              │
│                                                    │
│  [方案A·痛点] [方案B·收益]   [桌面][手机]  [发布] │
│                                                    │
│  ... 预览 ...                                     │
└───────────────────────────────────────────────────┘
```

- `*` 表示当前正在编辑
- `+` 表示未生成，点击会触发"基于当前 strategy + inputs 用 {语言} 模板生成一套"
- 切换 tab 即时加载对应 LocalizedContent

### 5.5 新建 LandingPage 向导微调

步骤不变，但 step 2 的"语言"选择加一个说明：

```
落地页主要语言：  [日本語 ▼]
                  ↑
  其他语言版本可在页面创建完成后按需添加
```

---

## 6 · 迁移路径（从当前 schema 到 v2）

### 6.1 数据迁移

```
旧: Project { inputs: { locale, market, ... }, variants, ... }
新: Product + LandingPage[]
```

迁移函数：
```ts
async function migrateV1ToV2(oldProject): { product, landingPage } {
  // 1. 找/建 default Product for this user
  let product = await findOrCreateDefaultProduct(oldProject.ownerId, {
    name: oldProject.inputs.name,
    tagline: oldProject.inputs.tagline,
    category: oldProject.inputs.category,
  });

  // 2. Old project → 一个 LandingPage，承载一个语言
  const page: LandingPage = {
    id: oldProject.id,          // ID 保留，旧链接不失效
    productId: product.id,
    slug: oldProject.slug,      // URL 保留
    name: '主站',
    purpose: 'main',
    targetMarket: oldProject.inputs.market,
    defaultLocale: oldProject.inputs.locale,
    availableLocales: [oldProject.inputs.locale],
    variants: {
      A: { [oldProject.inputs.locale]: oldProject.variants.A },
      B: { [oldProject.inputs.locale]: oldProject.variants.B },
    },
    // ... 其他字段直接 copy
  };
  return { product, landingPage: page };
}
```

在 `storage.ts` 的 `readProjects()` / `getProject()` 里做**懒迁移**：读到旧 schema 自动转 + 写回。

### 6.2 API 向后兼容

旧 `/api/projects*` 端点保留，内部重定向到新 API。90 天后下线，公告 30 天。

### 6.3 发布 URL

旧：`/p/<slug>` → 继续工作（slug 保留）
新：同上 URL，但后端找的是 LandingPage 而非 Project。**访客无感知**。

---

## 7 · 实施阶段

### Phase A (2h) · 数据层
- 新 types: `Product` / `Brand` / `LandingPage` / `LocalizedContent`
- `storage.ts` 扩展：`getProduct` / `getLandingPage` / `getBrand` + 懒迁移函数
- 旧 API 保留

### Phase B (1.5h) · 多语言同页
- Public page `/p/[slug]` 加 `detectLocale()` + `LanguageSwitcher` + hreflang
- 事件上报带 locale
- 浏览器切换不刷新（client-side 数据已全部预加载）
- **Q3 问题本 phase 结束就解了** — 独立发布节点

### Phase C (1.5h) · 产品层 UI
- 新页面 `/zh-CN/products/[id]` 产品详情
- Dashboard 改卡片（产品优先）
- 产品详情页的 LandingPage 列表
- 资产 Tab（迁移旧资产库的 UI 到这）

### Phase D (30min) · "加语言" 按钮
- 编辑器语言 tab
- 点 `+` 调 `POST /api/pages/:id/locales` 生成新语言版本

### Phase E (30min) · 看板下钻
- `/api/analytics` 分产品 + 分页面 + 分语言聚合
- UI 展开产品 → 展开 page → 看 locale CVR

**总计 ~6h，按 Phase A-E 顺序可分多次 commit/push。**

---

## 8 · 测试计划

**场景 1 · 峰会 QR 测试**（Q3 核心）
1. 创建 WinPilot 产品
2. 新建"主站" LandingPage，主语言 ja
3. 在编辑器里点 `[+English]` 生成 en 版本
4. 发布
5. 用浏览器 `Accept-Language: ja` 访问 → 看到日文版
6. 切换浏览器 `Accept-Language: en-US` 访问 → 看到英文版
7. 切到 ja 浏览器 + URL 带 `?lang=en` → 看到英文版（显式覆盖）
8. 点切换器切到 zh-CN → "未生成" 灰态，不可点

**场景 2 · 多产品资产隔离**（Q1）
1. 新建 WinPilot 产品 + 加证言 "WinPilot 让我..."
2. 新建 One-Flow 产品 + 加证言 "One-Flow 让我..."
3. 各自的落地页只看到自己的证言
4. 但品牌 Logo / SOC 2 认证两边都能用

**场景 3 · 多 LandingPage 独立跑**（Q2）
1. WinPilot 下建 "主站" 和 "Q4 Webinar" 两个页面
2. 发布后各自独立统计 UV / Leads
3. 看板展开 WinPilot → 两个页面独立一行

**场景 4 · 旧数据不破坏**
1. v2 部署前的老项目 slug 仍然可访问
2. 进入老项目编辑器仍能操作

---

## 9 · 风险与缓解

| 风险 | 缓解 |
|---|---|
| 懒迁移遇到 schema 异常旧项目会崩 | 迁移前先快照全部 KV，失败兜底到 default |
| LocalizedContent 数据量变 4 倍 | KV 对象大小可能触发限制；改成按语言分 key 存储：`page:<id>:locale:<xx>` |
| 语言切换器导致 CLS | 高度固定 + skeleton，切换时不动布局 |
| Accept-Language 检测不准 | 对 `zh-TW` / `zh-Hant` / `zh-HK` 都要映射到 zh-TW；对 `en-US` / `en-GB` 归一到 en |
| SEO 误判重复内容 | hreflang 覆盖所有语言 + canonical 指向主 URL |
| AI 生成其他语言质量参差 | 默认只生成主语言；加语言是用户显式动作，可预览确认后提交 |

---

## 10 · 开放问题（请 review 时回答）

1. **Brand 层是否支持多品牌**？即用户代理白标多个客户做页面。当前设计是一个用户一个 Brand——如果需要，需要加 `BrandSet` 层。
2. **Product 导入外部数据**？比如把 WinPilot 官网直接"喂"给 AI 提取 → 自动建好 Product + 第一个 LandingPage。当前靠用户手工填 Product 信息。
3. **AB test 跨语言如何统计显著性**？同一页 ja 的 variant A vs B，和 en 的 variant A vs B，是两条独立实验还是合并？推荐独立——不同语言访客群体不一样。
4. **"加一种语言"时是否自动沿用当前 strategy**？还是重新生成 strategy？倾向沿用——因为 strategy 是"产品-市场"层的，不是语言层的。

---

## 11 · 文件变更清单（实施时对照）

### 新增
- `src/lib/types.ts` — Product / Brand / LandingPage / LocalizedContent 类型
- `src/lib/i18n-detect.ts` — 语言检测逻辑
- `src/lib/migrate.ts` — v1 → v2 懒迁移
- `src/app/api/products/**` — 产品 CRUD
- `src/app/api/pages/**` — LandingPage CRUD + locale 操作
- `src/app/api/brand/route.ts` — 品牌 CRUD（当前 /api/brand 是抓色用的，重命名到 /api/brand/extract）
- `src/app/[locale]/products/[id]/page.tsx` — 产品详情页
- `src/components/LanguageSwitcher.tsx` — public page 底部切换器
- `src/components/HrefLangHead.tsx` — SEO tag 注入

### 修改
- `src/lib/storage.ts` — 加 products / pages / brand 读写 + 懒迁移包装
- `src/app/p/[slug]/page.tsx` — detectLocale / 多语言 bundle / switcher
- `src/components/Editor.tsx` — 语言 tab + 多语言切换
- `src/components/Wizard.tsx` — step 1 先选/建 Product；step 2 主语言
- `src/app/[locale]/dashboard/page.tsx` — 卡片改产品卡
- `src/app/api/analytics/route.ts` — 多语言下钻聚合

### 保留但内部重定向
- `src/app/api/projects/**` — 接收旧请求，内部调新 API

---

**review 点请直接在文档下方回复或在 PR 上标注。**

# API 测试用例 · LandingPage

> 范围:基于 `src/app/api/` 下**实际存在**的 route handler,覆盖核心 CRUD。非正常路径(鉴权、并发、超限等)不在本轮范围。
> ID 规则:`API-<模块>-<序号>`。每个用例 ID 与未来的测试脚本 `test('API-XXX-NNN …')` 1:1 对应。
> 请在"**脚本状态**"列更新 `未写` / `已写 · <脚本相对路径>`。

---

## 0. 环境与前置

| 项 | 值 |
|---|---|
| 基准 URL | `http://localhost:3000` |
| 启动命令 | `npm run dev`(Next.js,端口 3000) |
| 存储后端 | 本地 `LandingPage/.data/*.json`(`VERCEL !== '1'` 自动落盘) |
| 是否需要 LLM Key | **默认不需要**。大多数用例通过 **`POST /api/projects` + `body.strategy`** 或 fixture 预置,不触发 LLM。**带 `[需 KEY]` 标记的用例仅当对应 key 存在时执行**(脚本层用 `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` 这类守卫) |
| 数据重置 | 每个 describe 块跑前清空或快照还原 `.data/v2:products.json`、`.data/v2:pages.json` |
| 判断依据 | 仅看 HTTP status + JSON body 字段,不读 `.data/` 文件(防止把文件结构当契约) |

**样例种子 payload**(给 `POST /api/projects`,可绕开 Claude 密钥):

```json
{
  "inputs": {
    "name": "TestProduct",
    "tagline": "A tagline",
    "category": "SaaS",
    "value": "Concrete value sentence",
    "cta": "demo",
    "market": "CN",
    "locale": "zh-CN",
    "industry": "SaaS",
    "companySize": "10-50",
    "role": "PM",
    "source": "ads",
    "pastedContent": "",
    "referenceUrls": [],
    "uploadedFileNames": []
  },
  "strategy": {
    "audience": ["受众 1", "受众 2"],
    "goal": ["目标 1"],
    "narrative": ["叙事 1"],
    "local": ["本地化 1"]
  },
  "tone": "saas"
}
```

---

## 1. 用例清单

| ID | 模块 | 接口 | 场景 | 脚本状态 |
|---|---|---|---|---|
| API-PROD-001 | Product | `POST /api/products` | 创建产品(最小必填) | 已写 · `tests/api/products.spec.ts` |
| API-PROD-002 | Product | `GET /api/products` | 列出所有产品 | 已写 · `tests/api/products.spec.ts` |
| API-PROD-003 | Product | `GET /api/products/[id]` | 读单个产品 + 其名下所有 page | 已写 · `tests/api/products.spec.ts` |
| API-PROD-004 | Product | `PATCH /api/products/[id]` | 修改产品 name / tagline / value | 已写 · `tests/api/products.spec.ts` |
| API-PROD-005 | Product | `DELETE /api/products/[id]` | 删除产品并级联删除其所有 page | 已写 · `tests/api/products.spec.ts` |
| API-PAGE-001 | Page | `POST /api/projects` + strategy | 通过 compat 入口创建 Product+Page 种子 | 已写 · `tests/api/pages.spec.ts` |
| API-PAGE-002 | Page | `GET /api/pages/[id]` | 读单个 LandingPage 及其 Product | 已写 · `tests/api/pages.spec.ts` |
| API-PAGE-003 | Page | `PATCH /api/pages/[id]/modules` | 写入 (variant, locale) 单元格的 modules | 已写 · `tests/api/pages.spec.ts` |
| API-PAGE-004 | Page | `PATCH /api/pages/[id]` | 更新 tone / theme | 已写 · `tests/api/pages.spec.ts` |
| API-PAGE-005 | Page | `PATCH /api/pages/[id]` | 切换 published 标志 | 已写 · `tests/api/pages.spec.ts` |
| API-PAGE-006 | Page | `PATCH /api/pages/[id]` | 切换 activeVariant(A↔B) | 已写 · `tests/api/pages.spec.ts` |
| API-PAGE-007 | Page | `DELETE /api/pages/[id]` | 删除单个 LandingPage | 已写 · `tests/api/pages.spec.ts` |
| API-PROJ-001 | Projects compat | `GET /api/projects` | 列出所有项目的 compat 视图 | 已写 · `tests/api/projects-compat.spec.ts` |
| API-PROJ-002 | Projects compat | `GET /api/projects/[id]` | 读项目 compat 视图 | 已写 · `tests/api/projects-compat.spec.ts` |
| API-PROJ-003 | Projects compat | `PATCH /api/projects/[id]` | 更新 modules(当前 locale 槽位) | 已写 · `tests/api/projects-compat.spec.ts` |
| API-PROJ-004 | Projects compat | `PATCH /api/projects/[id]` | 更换 styleId(设置弹窗里的风格预设走这个接口) | 已写 · `tests/api/projects-compat.spec.ts` |
| API-LEAD-001 | Lead | `POST /api/leads` | 从公网 slug 提交一条线索 + 服务端同时更新 page.stats | 已写 · `tests/api/leads.spec.ts` |
| API-LEAD-002 | Lead | `GET /api/leads?projectId=...` | 按 pageId 过滤列出线索 | 已写 · `tests/api/leads.spec.ts` |
| API-LEAD-003 | Lead | `POST /api/leads` | slug 不存在 → 404;缺 slug → 400(唯一的非正常路径,因为它直接决定数据是否落库) | 已写 · `tests/api/leads.spec.ts` |
| API-LOC-001 | Locale | `PATCH /api/pages/[id]/modules` | 写单元格 (A, "ja") 不影响 (A, "zh-CN") 和 (B, *) | 已写 · `tests/api/locales.spec.ts` |
| API-LOC-002 | Locale | `PATCH /api/pages/[id]` | 切换 defaultLocale 到已存在的 locale | 已写 · `tests/api/locales.spec.ts` |
| API-LOC-003 | Locale | `DELETE /api/pages/[id]/locales` | 删除非默认语言 | 已写 · `tests/api/locales.spec.ts` |
| API-LOC-004 | Locale | `DELETE /api/pages/[id]/locales` | 拒绝删除默认语言(当还有其他 locale 时) | 已写 · `tests/api/locales.spec.ts` |
| API-LOC-005 | Locale | `POST /api/pages/[id]/locales/preview` | 拿本地化策略建议(纯函数,不需要 key) | 已写 · `tests/api/locales.spec.ts` |
| API-LOC-006 | Locale | `POST /api/pages/[id]/locales` | [需 KEY · Claude+OpenAI] 添加一门新语言并成功生成模块 | 已写 · `tests/api/locales.spec.ts` |
| API-LOC-007 | Locale | `POST /api/pages/[id]/locales` | [无 KEY] 返回 503 + `LLM_REQUIRED`,page 未被改动 | 已写 · `tests/api/locales.spec.ts` |
| API-LOC-008 | Locale | `POST /api/pages/[id]/locales` | 提交已存在的 locale → 200 + `note: "locale already exists"`,page 不变 | 已写 · `tests/api/locales.spec.ts` |
| API-HYD-001 | Hydrate | `POST /api/pages/[id]/hydrate` | [需 KEY · Claude] 重跑 Claude 改写当前 locale | 已写 · `tests/api/hydrate.spec.ts` |
| API-HYD-002 | Hydrate | `POST /api/pages/[id]/hydrate` | [无 KEY] 返回 503 + `LLM_REQUIRED`,page 未被改动 | 已写 · `tests/api/hydrate.spec.ts` |
| API-HYD-003 | Hydrate | `POST /api/pages/[id]/hydrate` | locale 不在 availableLocales → 400 + `UNKNOWN_LOCALE` | 已写 · `tests/api/hydrate.spec.ts` |

---

## 2. 详细用例

### API-PROD-001 · 创建产品

- **前置**:服务运行;`.data/v2:products.json` 为空或任意已知快照。
- **输入**:
  - `POST /api/products`
  - Body: `{ "name": "TestProduct", "tagline": "hello", "category": "SaaS", "value": "value-x" }`
- **步骤**:
  1. 发送请求。
- **预期结果**:
  - status `200`
  - body.product 存在,且 `product.id` 以 `p_` 开头
  - body.product.name === `"TestProduct"`
  - body.product.theme.primary === `"#4861ff"`(未传时的默认)
  - body.product.assets = `{ testimonials: [], cases: [], media: [] }`
  - body.product.landingPageIds = `[]`
- **边界**:不传 `name` → status `400`、`error === "name required"`。

### API-PROD-002 · 列出产品

- **前置**:已至少通过 API-PROD-001 创建 1 个产品。
- **输入**:`GET /api/products`
- **步骤**:
  1. 发送请求。
- **预期**:
  - status `200`
  - body.products 为数组,长度 ≥ 1
  - 包含 API-PROD-001 创建的产品(按 id 匹配)

### API-PROD-003 · 读产品及其页面列表

- **前置**:存在 productId=`P`,并在其名下存在至少 0 个 page(本用例允许 0)。
- **输入**:`GET /api/products/P`
- **预期**:
  - status `200`
  - body.product.id === `P`
  - body.pages 为数组

### API-PROD-004 · 修改产品信息

- **前置**:存在 productId=`P`。
- **输入**:
  - `PATCH /api/products/P`
  - Body: `{ "name": "NewName", "tagline": "NewTag", "value": "NewValue" }`
- **预期**:
  - status `200`
  - body.product.name === `"NewName"`
  - body.product.tagline === `"NewTag"`
  - body.product.value === `"NewValue"`
  - 立即 `GET /api/products/P` 返回值与上一致(验证真落库)
- **关键点(对应"前端不渲染"bug)**:响应 body 必须是**完整的 product 对象**,不是 partial — 前端修复方案会依赖这一点。

### API-PROD-005 · 删除产品级联

- **前置**:存在 productId=`P`,其下至少 1 个 page `L`。
- **输入**:`DELETE /api/products/P`
- **预期**:
  - status `200`,body `{ "ok": true }`
  - `GET /api/products/P` 返回 `404`
  - `GET /api/pages/L` 返回 `404`(级联已删)

---

### API-PAGE-001 · 种子数据创建(via compat)

- **前置**:无。
- **输入**:
  - `POST /api/projects`
  - Body: 见第 0 节样例 payload
- **预期**:
  - status `200`
  - body.id 以 `lp_` 开头 → 作为 pageId
  - body.productId 以 `p_` 开头
  - body.slug 存在
  - 若无 `ANTHROPIC_API_KEY`,body 含 `warning` 字段且后续 `GET /api/pages/[id]` 的 page.hydrationFailed === `true`;有 key 时 `hydrationFailed === false` 且无 `warning`
- **用途**:本用例的 `pageId` / `productId` 供 API-PAGE-002~007 复用。

### API-PAGE-002 · 读单个 LandingPage

- **前置**:API-PAGE-001 已跑,pageId=`L`。
- **输入**:`GET /api/pages/L`
- **预期**:
  - status `200`
  - body.page.id === `L`
  - body.page.defaultLocale === `"zh-CN"`
  - body.page.availableLocales 包含 `"zh-CN"`
  - body.page.variants.A["zh-CN"] 是非空数组(模板模块)
  - body.product.id === body.page.productId

### API-PAGE-003 · 写单元格 modules

- **前置**:API-PAGE-001,pageId=`L`,先 GET 拿到当前 `variants.A["zh-CN"]`。
- **输入**:
  - `PATCH /api/pages/L/modules`
  - Body: `{ "variant": "A", "locale": "zh-CN", "modules": [{ "id": "m_edited", "type": "hero", "content": { "headline": "EDITED HEADLINE" } }] }`
- **预期**:
  - status `200`
  - body.page.variants.A["zh-CN"].length === `1`
  - body.page.variants.A["zh-CN"][0].content.headline === `"EDITED HEADLINE"`
  - body.page.variants.A["zh-CN"][0].id === `"m_edited"`
  - 立即 `GET /api/pages/L` 验证同上(真落库)
  - body.page.variants.B["zh-CN"] 未被触碰(与写入前相同)

### API-PAGE-004 · 更新 tone / theme

- **前置**:pageId=`L`。
- **输入**:
  - `PATCH /api/pages/L`
  - Body: `{ "tone": "executive", "theme": { "primary": "#ff0000" } }`
- **预期**:
  - status `200`
  - body.page.tone === `"executive"`
  - body.page.theme.primary === `"#ff0000"`
  - body.page.theme.styleId 未被清空(合并语义,非替换)

### API-PAGE-005 · 切换 published

- **前置**:pageId=`L`,初始 `published=false`。
- **输入**:
  - `PATCH /api/pages/L`
  - Body: `{ "published": true }`
- **预期**:
  - status `200`、body.page.published === `true`
- **回归**:再发送 `{ "published": false }`,body.page.published === `false`。

### API-PAGE-006 · 切换 activeVariant

- **前置**:pageId=`L`,初始 `activeVariant="A"`。
- **输入**:
  - `PATCH /api/pages/L`
  - Body: `{ "switchVariant": "B" }`
- **预期**:
  - status `200`、body.page.activeVariant === `"B"`
  - variants.A / variants.B 内容未被改写

### API-PAGE-007 · 删除 LandingPage

- **前置**:pageId=`L`。
- **输入**:`DELETE /api/pages/L`
- **预期**:
  - status `200`、body `{ "ok": true }`
  - `GET /api/pages/L` 返回 `404`

---

### API-PROJ-001 · 列出 compat 项目

- **前置**:至少 1 个 page 存在。
- **输入**:`GET /api/projects`
- **预期**:
  - status `200`
  - body.projects 是数组,长度 ≥ 1
  - 数组项含 `id`、`modules`(当前 activeVariant × defaultLocale 槽位)、`strategy` 等 compat 字段

### API-PROJ-002 · 读 compat 项目视图

- **前置**:pageId=`L`(也是 compat 项目 id)。
- **输入**:`GET /api/projects/L`
- **预期**:
  - status `200`、body.project.id === `L`
  - body.project.modules 指向 activeVariant × defaultLocale 槽位

### API-PROJ-003 · PATCH modules(compat 写入)

- **前置**:pageId=`L`,defaultLocale=`"zh-CN"`。
- **输入**:
  - `PATCH /api/projects/L`
  - Body: `{ "modules": [{ "id": "m1", "type": "hero", "content": { "headline": "Compat Path" } }], "locale": "zh-CN" }`
- **预期**:
  - status `200`
  - body.project 存在(compat 视图)
  - body.page 存在(v2 原生视图) — 与 compat 视图双返
  - body.page.variants.A["zh-CN"][0].content.headline === `"Compat Path"`
- **关键点**:compat PATCH 必须**同时**返回 `project` 和 `page`,否则前端多语言 tab 的缓存无法刷新(见 `Editor.tsx:594-600` 依赖)。

### API-PROJ-004 · 更换 styleId(设置弹窗里"风格"走的接口)

- **前置**:pageId=`L`,已知当前 `theme.styleId`(如 `"saas-refined"`)。
- **输入**:
  - `PATCH /api/projects/L`
  - Body: `{ "newStyleId": "jp-premium" }`
- **预期**:
  - status `200`
  - body.project 存在;body.page.theme.styleId === `"jp-premium"`
  - 立即 `GET /api/pages/L` 返回的 page.theme.styleId === `"jp-premium"`(持久化已生效)

---

### API-LEAD-001 · 公网提交一条线索

- **前置**:pageId=`L`,slug=`S`,读取提交前 page.stats.leads(记为 `n0`)、`stats.byLocale["zh-CN"]?.leads`(记为 `m0`)。
- **输入**:
  - `POST /api/leads`
  - Body: `{ "slug": "S", "name": "张三", "email": "z@test.com", "locale": "zh-CN", "variant": "A" }`
- **步骤**:
  1. 发送请求。
  2. `GET /api/pages/L` 获取更新后的 stats。
- **预期**:
  - 提交响应 status `200`、body `{ "ok": true }`
  - page.stats.leads === `n0 + 1`
  - page.stats.byLocale["zh-CN"].leads === `m0 + 1`
  - page.stats.abStats.A.leads 比前值 +1
  - `GET /api/leads?projectId=L` 返回的 leads 数组长度比前值 +1,且包含本次提交的 name/email

### API-LEAD-002 · 按 pageId 过滤读取线索

- **前置**:API-LEAD-001 已至少提交 1 条;另有不同 pageId=`L2` 提交过 1 条。
- **输入**:`GET /api/leads?projectId=L`
- **预期**:
  - status `200`
  - body.leads 全部 `lead.projectId === L`(不含 L2 的)

### API-LEAD-003 · 提交非法 slug / 缺参

- **前置**:slug=`"does-not-exist"` 不存在;pageId=`L` 正常。
- **输入**(两发):
  - A:`POST /api/leads` body `{ "slug": "does-not-exist", "name": "x" }`
  - B:`POST /api/leads` body `{ "name": "x" }`(缺 slug)
- **预期**:
  - A → status `404`、body.error === `"page not found"`
  - B → status `400`、body.error === `"slug required"`
- **说明**:这两条非正常路径**决定数据是否落库**,所以保留。其余异常路径(鉴权、重复提交等)本轮不测。

---

### API-LOC-001 · 跨 locale 单元格写入隔离

- **前置**:
  - 种子 page `L`,defaultLocale=`"zh-CN"`。
  - 通过种子脚本(或直接写 `.data/v2:pages.json`)预置 `availableLocales=["zh-CN","ja"]`、`variants.A.ja` / `variants.B.ja` 非空(因为真接 `POST /api/pages/[id]/locales` 需要 Claude+GPT key,本轮用 fixture 注入)。
  - GET 读取写入前的 `variants.A["zh-CN"]`、`variants.B["zh-CN"]`、`variants.B["ja"]`,作为基线。
- **输入**:
  - `PATCH /api/pages/L/modules`
  - Body: `{ "variant": "A", "locale": "ja", "modules": [{ "id": "m_ja", "type": "hero", "content": { "headline": "日本語のヘッドライン" } }] }`
- **预期**:
  - status `200`
  - body.page.variants.A["ja"] 长度为 1 且 headline 为新值
  - body.page.variants.A["zh-CN"]、variants.B["zh-CN"]、variants.B["ja"] 与基线**逐项深等**(未被改写)
  - 再 `GET /api/pages/L` 结果一致(落库隔离)
- **关键点**:这是前端"日文 tab 编辑不能污染中文 tab"的后端契约,必须测。

### API-LOC-002 · 切换默认语言

- **前置**:page `L`,availableLocales=`["zh-CN","ja"]`,defaultLocale=`"zh-CN"`。
- **输入 A**(合法):
  - `PATCH /api/pages/L`
  - Body: `{ "defaultLocale": "ja" }`
- **预期 A**:
  - status `200`、body.page.defaultLocale === `"ja"`
  - body.page.availableLocales 未变
- **输入 B**(非法 — 目标 locale 不在 availableLocales):
  - Body: `{ "defaultLocale": "en" }`(假设 en 未加)
- **预期 B**(源码 `pages/[id]/route.ts:30-32` 的实现是**静默忽略**,不报错):
  - status `200`、body.page.defaultLocale 仍为上一次的值(无 UI 入口触发这条分支,但契约如此,必须锁死行为避免未来改坏)

### API-LOC-003 · 删除非默认语言

- **前置**:同 API-LOC-002 起始状态(availableLocales=`["zh-CN","ja"]`,defaultLocale=`"zh-CN"`)。
- **输入**:
  - `DELETE /api/pages/L/locales`
  - Body: `{ "locale": "ja" }`
- **预期**:
  - status `200`
  - body.page.availableLocales === `["zh-CN"]`
  - body.page.variants.A 不再有 `"ja"` 键;variants.B 同理
  - body.page.defaultLocale 仍为 `"zh-CN"`

### API-LOC-004 · 拒绝删除默认语言(当仍有其他语言时)

- **前置**:page `L`,availableLocales=`["zh-CN","ja"]`,defaultLocale=`"zh-CN"`。
- **输入**:
  - `DELETE /api/pages/L/locales`
  - Body: `{ "locale": "zh-CN" }`
- **预期**:
  - status `400`
  - body.error === `"cannot remove default locale; switch default first"`
  - `GET /api/pages/L` 返回的 availableLocales 未变
- **边界补充**(可放一起断言):若 availableLocales 只剩 1 个(删最后一个 locale)且 locale 是默认语言,源码 `locales/route.ts:212-217` 的分支**不拦截**(会通过),这一条留作已知行为,不在本用例断言,以免把实现当契约。

### API-LOC-005 · 预览本地化策略(无需 key)

- **前置**:page `L`,availableLocales=`["zh-CN"]`。
- **输入**:
  - `POST /api/pages/L/locales/preview`
  - Body: `{ "locale": "ja" }`(不传 market,服务端会用 `defaultMarketForLocale` 推为 JP)
- **预期**:
  - status `200`
  - body.strategy.targetLocale === `"ja"`
  - body.strategy.targetMarket === `"JP"`
  - body.strategy 含 `recommendedStyle`、`recommendedModuleOrder`、`formChanges` 字段(结构来自 `proposeLocalization`,即便 LLM 未配置也返回)
  - `GET /api/pages/L` 的 availableLocales 未变(preview 只读,不落库)
- **补充**:同参数带 `"market": "US"` 再发一次 → body.strategy.targetMarket === `"US"`。

### API-LOC-006 · [需 KEY · Claude+OpenAI] 添加一门新语言

- **前置**:
  - 环境变量 `ANTHROPIC_API_KEY` 和 `OPENAI_API_KEY` 均存在;`GET /api/capabilities` 返回 `ready.addLocale === true`。
  - page `L`,availableLocales=`["zh-CN"]`。
  - 先调 API-LOC-005 拿到 strategy 作为 body。
- **输入**:
  - `POST /api/pages/L/locales`
  - Body: `{ "locale": "ja", "strategy": <API-LOC-005 的 strategy 或简化版> }`
  - 超时:60s(服务端 `maxDuration = 60`)
- **预期**:
  - status `200`
  - body.page.availableLocales === `["zh-CN", "ja"]`
  - body.page.variants.A["ja"] 和 variants.B["ja"] 是非空数组,hero headline 非空且与 zh-CN 不同
  - `GET /api/pages/L` 返回相同状态(已落库)
- **补充**:运行前用 `test.skipIf(!process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY)` 守卫。

### API-LOC-007 · [无 KEY] 添加语言失败路径

- **前置**:
  - 至少一个相关 key 缺失(建议测脚本显式 `delete process.env.ANTHROPIC_API_KEY` 或通过一个独立的 dev server 实例跑)
  - page `L`,availableLocales=`["zh-CN"]`。
- **输入**:
  - `POST /api/pages/L/locales`
  - Body: `{ "locale": "ja", "strategy": { ...minimal valid strategy } }`
- **预期**:
  - status `503`
  - body.code === `"LLM_REQUIRED"`、body.missing 指向缺失的 key(`"ANTHROPIC_API_KEY"` 或 `"OPENAI_API_KEY"`)
  - `GET /api/pages/L` 的 availableLocales 仍为 `["zh-CN"]`(落库未被污染)
  - `GET /api/pages/L` 的 variants.A 不含 `"ja"` 键
- **关键点**:这条是"后端失败必须先于前端 optimistic 更新"的契约锁,阻止"半个 locale 被 committed"。

### API-LOC-008 · 重复添加已存在的 locale

- **前置**:page `L`,availableLocales=`["zh-CN", "ja"]`(通过 fixture 预置)。
- **输入**:
  - `POST /api/pages/L/locales`
  - Body: `{ "locale": "ja" }`
- **预期**:
  - status `200`
  - body.note === `"locale already exists"`
  - body.page.availableLocales 仍为 `["zh-CN","ja"]`(未重复添加)
  - **不触发 LLM** — 用于保证无 key 环境下幂等重入也不会误调 Claude/OpenAI
- **关键点**:服务端 `locales/route.ts:55-57` 的早退,无 key 时也能通过。

---

### API-HYD-001 · [需 KEY · Claude] 重跑 Claude hydrate 当前 locale

- **前置**:
  - `ANTHROPIC_API_KEY` 存在;`GET /api/capabilities` 返回 `hasClaude === true`。
  - page `L`,defaultLocale=`"zh-CN"`,`hydrationFailed === true`,variants.A["zh-CN"] 的 hero headline 是模板占位(可用 fixture 注入)。
- **输入**:
  - `POST /api/pages/L/hydrate`
  - Body: `{ "locale": "zh-CN" }`
- **预期**:
  - status `200`
  - body.locales === `["zh-CN"]`
  - body.page.variants.A["zh-CN"][hero-index].content.headline 已不等于 fixture 里的模板占位值
  - body.hydrationFailed === `false`(被重新计算,模板残留检测已清零)
  - `GET /api/pages/L` 返回同样状态
- **补充**:断言 headline 不等比断言"包含产品名"更稳,因为 Claude 措辞不可预测。
- **skip 守卫**:`test.skipIf(!process.env.ANTHROPIC_API_KEY)`。

### API-HYD-002 · [无 KEY] Hydrate 失败路径

- **前置**:`ANTHROPIC_API_KEY` 缺失;page `L`,`hydrationFailed=true`(fixture)。
- **输入**:`POST /api/pages/L/hydrate` Body: `{ "locale": "zh-CN" }`
- **预期**:
  - status `503`
  - body.code === `"LLM_REQUIRED"`、body.missing === `"ANTHROPIC_API_KEY"`
  - `GET /api/pages/L` 的 hero headline 未被改动(落库未被破坏)
  - page.hydrationFailed 仍为 `true`

### API-HYD-003 · Hydrate 非法 locale

- **前置**:page `L`,availableLocales=`["zh-CN"]`。
- **输入**:`POST /api/pages/L/hydrate` Body: `{ "locale": "ja" }`(ja 未加)
- **预期**:
  - status `400`
  - body.code === `"UNKNOWN_LOCALE"`
  - body.error === `"unknown-locale"`
  - body.message 含 `"ja"` 和提示先调 `POST /api/pages/:id/locales`
- **关键点**:这条验证 hydrate 不会"偷偷创建"新 locale —— 写入只走 `POST /api/pages/[id]/locales`,职责分离。

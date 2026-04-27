# LandingPage OS by CC · 工程备忘

此文件给未来维护者（和 AI 协作者）看。记录踩过的坑、做过的关键决策、绕过的平台陷阱。

---

## 一、部署到 Vercel 踩过的五个坑

### 1. `VERCEL_*` 环境变量前缀被保留
**症状：** 在 Vercel Dashboard Import 页面填 `VERCEL_TOKEN`，提示 `"The value is not a valid System Environment name"`。

**根因：** `VERCEL_*` 前缀被 Vercel 自用作系统变量（`VERCEL_URL`、`VERCEL_ENV`、`VERCEL_GIT_*` 等），不允许用户自定义同前缀的变量。

**做法：** 平台自用 token 用 `VC_API_TOKEN` / `VC_TEAM_ID`。参见 [src/lib/deploy.ts](src/lib/deploy.ts)。

---

### 2. next-intl v3 服务端 API 强制动态渲染，Vercel build 时静态预渲染失败
**症状：** 本地 `next dev` 正常，`next build` 报：
```
Error: Usage of next-intl APIs in Server Components currently opts into
dynamic rendering. ... Dynamic server usage: Route /zh-CN couldn't be
rendered statically because it used `headers`.
```

**根因：** next-intl v3 的 `getTranslations()` / `getMessages()` 内部用 `headers()` 推断 locale，Next.js 14 视为动态 API，静态预渲染失败。

**做法：** 每个 `[locale]` 下的 page/layout 开头调 `unstable_setRequestLocale(locale)`，告诉 next-intl locale 从 param 来而非 header。参见 [src/app/[locale]/layout.tsx](src/app/[locale]/layout.tsx) 等。

---

### 3. `process.cwd()` 在 Vercel Serverless 是只读的
**症状：** 本地正常，Vercel 上 `fs.writeFile(path.join(process.cwd(), '.data/...'))` 500。

**根因：** Vercel Lambda 把代码挂在 `/var/task` 只读；可写的只有 `/tmp`（每次 invocation 独立）。

**做法：** 见 [src/lib/storage.ts](src/lib/storage.ts)：
```ts
const DATA_DIR = process.env.DATA_DIR
  ?? (process.env.VERCEL === '1' ? '/tmp/.data' : path.join(process.cwd(), '.data'));
```

注意：`/tmp` 是每 Lambda 独立的，**数据不跨函数持久**。**2026-04 起** `readFs` / `writeFs` 在 Vercel + 无 KV 时直接抛 `StorageRequiredError`，路由返回 503。原来"先写到 /tmp 看再说"的降级被删掉了 —— 那个路径让运维以为 KV 没配也能跑，结果两次 deploy 之间用户的半数记录消失。Dashboard 现在也会持续挂红色 banner 直到 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 都配置好。

---

### 4. Next.js 把 "没调用动态 API" 的 route handler 静态缓存了
**症状：** KV 里明明有 1 个项目，`GET /api/analytics` 永远返回 `totalProjects: 0`，直到重新部署。但 `GET /api/projects` 能看到。

**根因：** Next.js 14 对没调 `cookies()` / `headers()` / `request` 的 `GET` route handler 会静态预渲染（build 清单里标 `○`），每次请求返回 build 时的快照。

**做法：** 所有**读 KV / 文件系统**的 API route handler 顶部显式：
```ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;
```
已加在 `/api/analytics`、`/api/assets`、`/api/health`。

---

### 4.1 `dynamic = 'force-dynamic'` 只管渲染模式，不禁 fetch Data Cache（2026-04 新坑）
**症状：** 刚新建 7 个产品，`/api/products` 返回 18 条（正确），`/api/diag-products` 也返回 18 条，但 `/zh-CN/dashboard` SSR 出来只有 10 张产品卡 —— **且长期稳定**在 10。Vercel CDN `x-vercel-cache: MISS`，`cache-control: no-store`，每次请求都是真的到 lambda。

**根因：** `@vercel/kv` 基于 `@upstash/redis`，走 REST API，底层用 `fetch()`。Next.js 14 会把**所有 fetch 响应自动塞进 Data Cache**。`export const dynamic = 'force-dynamic'` 只影响路由本身的 *渲染模式*（不会预渲染、每次都过 handler），但**不会**让 Data Cache 失效 —— 所以 SCAN / GET 的响应被第一次 render 时的快照钉住，后续 SSR 一直看同一份旧数据，直到 cache TTL 到期或重新部署才更新。`/api/products` 和 `/api/diag-products` 没中招是因为它们显式声明了 `revalidate = 0`，page 少了这一行。

`pages` 数量也同样少（18 vs 25），同步证实是 Data Cache 层面的问题而不是某个字段过滤。

**做法：** 凡是 SSR 读 KV 的 page / route handler，**两个都要加**：
```ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;             // ← 关键，禁 Data Cache
```
并且在 server component 顶部显式调 `noStore()`（belt-and-suspenders）：
```ts
import { unstable_noStore as noStore } from 'next/cache';
export default async function Page() {
  noStore();
  const products = await readProducts(); // 现在保证打到真实 KV
  ...
}
```
已加在 dashboard / products/[id] / assets / projects/[id] / analytics 全套 SSR page。

**诊断套路**：怀疑这类问题时，临时造一个 `/api/diag-*` route 复刻同样的读调用并加 `revalidate = 0`，对比两个返回。如果 diag 结果正确而 page 错误 → 99% 是这个坑。别猜 —— 直接 instrument 一个 `<div data-diag>` 把 `products.length` 输出到 HTML，秒出真相。

---

### 4.5 图片上传：不能直接把 base64 写进 KV
**症状：** Phase A 之前，SocialProof logos 的"上传"是前端 `FileReader` → base64 塞进 module JSON。单个 2MB 的 logo 直接把整页 JSON 顶到 KV value 的上限（Upstash Redis 单 key 默认 1MB 左右），保存接口 500。MediaField（Hero / ProductShowcase / Benefits / VideoEmbed）干脆就没上传按钮，只能贴外链。Testimonial 完全没有头像字段 —— 信任感 gap。

**根因：** 没有统一的二进制资产出口。每个图片字段都是自己小作坊：logos 走 base64 内嵌；media 只接 URL；avatar 不存在。结果是"同一个放图片的手势在编辑器里有四种不同行为"。

**做法（Phase A 新增 upload 管线）：**
1. 新依赖 `@vercel/blob`；新增 env `BLOB_READ_WRITE_TOKEN`（Vercel → Storage → Blob 生成）
2. 新增 `POST /api/assets/upload`（见 [src/app/api/assets/upload/route.ts](src/app/api/assets/upload/route.ts)），5MB 上限、image/\* allowlist（png/jpeg/gif/webp/svg）
3. 共享组件 `<UploadButton>`（见 [src/components/UploadButton.tsx](src/components/UploadButton.tsx)），所有图片字段（`MediaField`、`LogosEditor`、`TestimonialEditor`）都走它
4. 三路行为矩阵（与 LLM / deploy / storage 的 fail-loud 对齐）：

| 场景 | 行为 |
|---|---|
| `BLOB_READ_WRITE_TOKEN` 已配（prod 或本地带 token） | `put()` 到 Vercel Blob，返回 CDN URL |
| 本地 dev 没 token（`VERCEL !== '1'`） | 上传内联成 `data:image/…;base64,…`，带 warning |
| prod 没 token（`VERCEL === '1'`） | 抛 `UploadRequiredError` → 503 |

base64 内联只保留给本地调试；prod 不配 Blob 就拒绝写入（而不是悄悄塞进 KV 撑爆）。新增 error 类 `UploadRequiredError` 在 [src/lib/errors.ts](src/lib/errors.ts)。

---

### 5. 存储冷切换时 in-flight 请求会分裂
**症状：** 用户在 Vercel 重新部署的 90s 窗口里点击"生成页面"，项目写进老 lambda 的 `/tmp/.data`，然后跳编辑器时新 lambda 已读 KV → 404。

**根因：** 切换存储后端时，老 lambda 还可能被 Vercel 复用几分钟（warm instance）。新旧存储看到的数据集合不一致。

**做法：**
1. 切换存储前先把旧数据**一次性迁移**到新存储
2. 部署窗口里显式"维护中"横幅（未实现，TODO）
3. 所有读取兼容 "KV 未返回时 fall back 查 `/tmp`" 的过渡逻辑（未实现，TODO）

---

## 二、关键架构决策

### 2.1 LLM 路由策略（PRD v5.1 §4.1，2026-04 修订）
多家互补，不是"挑一家"：
| 模型 | 职责 |
|---|---|
| Gemini 1.5 Pro | 长文档摄取（白皮书/手册）→ 抽核心价值 |
| Claude Opus 4 | 结构化 JSON 文案生成（JP locale 默认走这里）|
| **DeepSeek-V3** | 结构化 JSON 文案生成（非 JP locale 默认走这里，成本约为 Claude 的 1/30）|
| GPT-4o | 多语言语境转换、文化自检 |

代码抽象：[src/lib/llm-claude.ts](src/lib/llm-claude.ts) / [src/lib/llm-deepseek.ts](src/lib/llm-deepseek.ts) / [src/lib/llm-openai.ts](src/lib/llm-openai.ts) / [src/lib/llm-gemini.ts](src/lib/llm-gemini.ts)。

**Provider 路由层** [src/lib/llm-provider.ts](src/lib/llm-provider.ts)（2026-04 新增 · 下半年升级为 admin 可配置，见 §2.5）：
- `generateStrategy` / `regenerateModule` / `hydrateModulesViaClaude` 都先过 `providerFor(locale, scenario)` 再派发到具体 adapter。
- 默认路由（即 `DEFAULT_LLM_CONFIG`，也是 KV 未写入时的 fallback）：
  - `locale === 'ja'` → Claude（JP 市场对 AI 味的容忍度最低，值得贵一点拿稳质量）
  - 其他 locale → DeepSeek（OpenAI 兼容，prefix caching 自动打开，工具调用 JSON 格式严格）
  - 缺对应 key 时自动降级到另一家；两家都没 key 直接抛 `LLMRequiredError`（503）。
- 运维覆盖（优先级高于 admin 配置）：`LLM_PRIMARY=claude` / `LLM_PRIMARY=deepseek` 强制全 locale 走一家。仅在 A/B 调试或某家临时故障时使用。
- Admin 覆盖：从 `/admin/llm` 页面改 `scenarios.{strategy,copy}.{ja,default}` 即可不重新部署切路由，见 §2.5。
- 为什么不是 Kimi / GLM / Qwen：Kimi 的 tool_choice 语义与 OpenAI SDK 不完全兼容；GLM-4、Qwen-max 在同质量下比 DeepSeek 贵 2-3 倍，英语输出没差异。

**共享 prompt**：`STRATEGY_SYSTEM` 和 `MODULE_SYSTEM` 从 `llm-claude.ts` export，DeepSeek adapter 直接复用。单源真值，未来改 prompt 一次到位。

**错误策略（2026-04 修订，原"自动回退模板"已废弃）：**
- Key 缺失 → 抛 `LLMRequiredError`，路由返回 503 + 结构化 body `{ code: 'LLM_REQUIRED', missing: 'ANTHROPIC_API_KEY', ... }`
- API 调用失败 / 响应格式错 → 抛 `LLMCallError`，路由返回 502
- 前端读 `code` 字段，在编辑器顶部渲染红色 banner；按钮通过 `/api/capabilities` 提前 disable

原来那套"静默降级模板"（CLAUDE.md §四 反复警告的 silent degradation）是用户报告"重新生成日文 tab 返回中文"的根因。现在没有任何 hot path 会把模板当 AI 输出返回给用户。

仅 `generateStrategyTemplated` / `regenerateModuleTemplated` / `generateModules` 保留为**显式**的模板构造工具（用于初次 save 前铺骨架 + 测试种子），不在错误路径自动调用。

### 2.2 本地化不等于翻译
每种语言**独立模板**，见 [src/lib/ai.ts](src/lib/ai.ts) 的 `L` 对象。同一个"周省 11 小时"概念，JP / US / CN / TW 各用母语惯用句式。禁止机翻。

市场 → 风格/语气/表单字段/模块顺序差异化：见 [src/lib/styles.ts](src/lib/styles.ts) 的 `defaultStyleForMarket()` 和 [src/lib/ai.ts](src/lib/ai.ts) 的 `marketStrategyText()`。

### 2.3 A/B 双叙事（PRD v5.1 §4.3）
每个项目生成时同时产出两套：
- **方案 A · Pain-Agitate-Solve**：eyebrow=THE HIDDEN COST, hero=损失数字
- **方案 B · Benefit-Focused**：eyebrow=OUTCOME FIRST, hero=ROI 数字

模块顺序也不同：
```
A: hero → socialProof → pain → solution → benefits → useCase → testimonial → faq → cta → form
B: hero → socialProof → benefits → useCase → solution → testimonial → faq → cta → form
```

发布模式 `ab-split`：访客按 cookie `lp_v` 粘性分流，看板按样本 + lift 自动推荐胜出者。

**Hero 的 variant-aware 生成（2026-04 补丁）**：之前 `hydrateModulesViaClaude` 按 module type 并行调 5 次 LLM（hero / pain / benefits / solution / cta），每个 type 的 patch 同时覆盖到 A/B 两份 variants。问题：`tintHeroForVariant` 在模板阶段按 A/B 写入了不同的 eyebrow/headline/subhead，hydrate 一来 Claude 的 hero patch 把这三个字段同时冲掉 A 和 B —— 编辑器顶部 "方案 A · 痛点" / "方案 B · 收益" 切换看着一模一样。2026-04 用户实测报告。

修复：`hydrateModulesViaClaude` 对 hero 调**两次** LLM（一次 variant='A'，一次 variant='B'），prompt tail 带不同的 variant hint（`variantHintForModule` in llm-claude.ts，A 强调 "lead with cost"、B 强调 "lead with outcome"）。pain / benefits / solution / cta 保持单次调用 —— pain 只在 A 出现，其他三个由模块顺序承担 A/B 差异。成本从 5 次涨到 6 次 LLM call（只 hero 多一次）。`regenerateModuleViaProvider / regenerateModuleViaClaude / regenerateModuleViaDeepseek` 都新增了 optional `variant?: NarrativeVariant` 参数；user 点单模块 "重新生成" 按钮时（`/api/projects/[id]` 的 regenerateModuleId 分支）也透传 `page.activeVariant`，这样 hero 手动重生成也尊重当前 tab 的 A/B 立场。

**已有的用户数据不会自动 heal**：KV 里在补丁前创建的页面，A/B hero 依旧是同一份。用户要么重建该页面、要么在 hero 行点 "重新生成"（现在就会按当前 variant 产出差异化 copy）。编辑器里已有的 "立即 hydrate（当前语言）" 按钮只在 `hydrationFailed=true` 时显示，对已 hydrate 的旧页不可见。如果后续有批量 heal 需求，写个 one-off 脚本过一遍所有 page，把每个的 A/B hero 强制 mark `TEMPLATE_PLACEHOLDER_HEADLINE` 再调 `/api/pages/[id]/hydrate` 就行。

**测试覆盖**：`tests/api/hydrate.spec.ts` 新增两条 —— API-HYD-004 跑真 LLM 断言 `A.hero.eyebrow !== B.hero.eyebrow || A.hero.headline !== B.hero.headline`（有 ANTHROPIC_API_KEY 才跑）；API-HYD-005 纯函数测 `variantHintForModule`，验 A/B 两段 hint 内容不同、仅对 hero 返回非 null、locale 切换时 eyebrow 例子跟着变。

### 2.4 策略 → 模块生成管线（PRD v5.1 §4.3 延伸）
早期 bug：`generateModules(inputs, tone)` 不读 strategy，用户编辑策略没用。

修复：`generateVariants(inputs, tone, strategy)` + `applyStrategyToModules(modules, strategy)`：
- strategy.goal 里检测"表单 3-4 字段" → 自动缩表单
- strategy.audience 里提取问句 → 注入到 FAQ 顶部

策略是"生成 prompt 的结构化约束"，不是展示。

### 2.5 管理员 LLM 配置（2026-04 新增 · 触发场景：某家 quota 爆了整条线挂住）

**触发事件：** 用户在添加日文 locale 时撞到 `gpt failed during localize-gpt: 429 You exceeded your current quota`，要求两个能力：(1) 不要因为一家挂了整套管线就挂住；(2) 后台配置场景→模型，不要硬编码。

**落地：** 新增 `/admin/llm` 页面 + `lp:v2:llm-config` KV key + `src/lib/llm-fallback.ts` 回退编排器。

**配置面**（存在 `lp:v2:llm-config`，admin 改完不用 redeploy）：
| 字段 | 作用 |
|---|---|
| `providers.{claude,deepseek,openai,gemini}.model` | 每家 SDK 调用时用的 model ID。各 adapter 在 `resolveModel()` 里读。Default 见 `DEFAULT_LLM_CONFIG`（Gemini 默认 `gemini-3.0-pro`，若该 ID 还没开放 API 会 404，admin 从 UI 切到 2.5-pro 即可）。 |
| `scenarios.strategy.{ja,default}` / `scenarios.copy.{ja,default}` | JP 和其他 locale 分开路由。`providerFor(locale, scenario)` 读这四格。 |
| `scenarios.localize` / `scenarios.extract` | 单格（本地化和长文档摄取不跟 locale 挂钩）。 |
| `fallback.enabled` | 总开关。默认 OFF — 静默切 provider 对运维是惊喜行为，admin 必须显式打开。 |
| `fallback.triggers` | 哪几类错误触发回退：`429-quota`（配额用光，重试同家没意义）/ `429-rate`（瞬时限流）/ `5xx`（基础设施）。`4xx-auth` 和 `4xx-other` 永不回退 —— key 错或 prompt 错，换一家照样错。 |
| `fallback.chain` | 回退顺序。首家是 primary，失败后按序尝试。没配 API key 的 provider 自动跳过。 |

**认证层**：`ADMIN_PASSWORD` 环境变量 + HMAC-SHA256 签名的 httpOnly cookie（30 天）。没配 `ADMIN_COOKIE_SECRET` 时从密码派生（见 `src/lib/admin-auth.ts`）。Middleware 在 `/admin/*` 和 `/api/admin/*` 上拦截。生产环境必须配 `ADMIN_PASSWORD`，否则进 `/admin/*` 会跳到 `/admin/setup-required`。

**路由优先级**（`src/lib/llm-provider.ts` 的 `providerFor()` 和 `coerceToPrimary()`）：
1. `LLM_PRIMARY=claude|deepseek` 环境变量覆盖（调试用的最高优先级杠杆）
2. Admin KV 配置里的 `scenarios[scenario][ja|default]`，前提是该 provider 有 key + 有对应场景的 adapter 实现
3. 硬编码兜底（JP → claude，其他 → deepseek），且只选有 key 的那家

Admin 在 UI 里把 `copy.default` 设成 `openai` 之类**没 strategy/copy adapter** 的 provider，不会抛错 —— `coerceToPrimary()` 会悄悄降级到兜底阶梯，dashboard 的 routing status 也会反映实际用的哪家。这是"配置是提示，不是硬约束"的立场：admin 填错不该阻塞生产流量。

**回退执行**（`executeWithFallback(scenario, primary, executor)`）：
- Primary 成功 → 直接返回（happy path 零开销）。
- Primary 失败 + `LLMRequiredError` → 透传（key 缺失是配置问题，不该被回退掩盖）。
- Primary 失败 + 错误类不在触发列表 / fallback 关闭 → 原样抛出。
- Primary 失败 + 触发命中 → 按 chain 顺序尝试，跳过 primary 自己 + 没 key 的 provider。任一成功则返回；全失败则抛原始错误（route handler 映射的 HTTP status 不变），hop 详情打到服务器日志。
- 成功回退时，响应体带 `fallback: { scenario, primary, used, hops: [...] }` 字段，前端可渲染黄色 banner "GPT 本地化回退到 Claude（429-quota）"。
- **定点场景：** `localize` 的回退特殊 —— 只有 OpenAI 一家有 adapter，但 hydrate 阶段 Claude 已经产出过 locale-native 输出，回退实现是**用 hydrate 的 Claude 产物跳过 polish pass**。这是有意识的"优雅降级"而不是模板 fig-leaf：输出还是 LLM 写的母语文案，只是少一轮 GPT 跨文化润色。

**接入进度**（2026-04 第二轮修订）：今天 `executeWithFallback` 已经挂到 `copy` + `strategy` + `localize` 三个场景。Hydrate 不是独立 scenario —— 它内部 6 次并行调用全部走 `regenerateModuleViaProvider`（即 `copy` 通道），所以 copy 接了 fallback 就等于 hydrate 也接了，每个 hero-A / hero-B / pain / benefits / solution / cta 都独立参与 chain（happy path 零开销；某一路 quota 爆时只那一路换 provider，其他路照旧用 primary）。
- `localize`（/api/pages/[id]/locales POST）：OpenAI 是唯一有 adapter 的 primary，回退只是跳过润色。
- `copy`（module-regen，走 /api/projects/[id] PATCH 的 regenerateModuleId 分支 + hydrate 里的 per-module 重写）：Claude / DeepSeek 两家都有 adapter，回退是真的换 provider 重新跑一次。
- `strategy`（/api/projects POST 创建页面第一步 + /api/projects/[id] PATCH 的 `regenerateStrategyAll` / `regenerateStrategyBlock` / `regenerateStrategyLine`）：Claude / DeepSeek 两家都有 adapter，primary 挂了换到另一家。
- `extract`（长文档摄取，Gemini 唯一）：没接 —— 单一 adapter，回退没意义。Gemini 挂了这条功能就短暂不可用，不会影响其他生成路径。

**用户 2026-04 撞到 Anthropic 400 "credit balance too low" 后的最终 posture**：只要 admin 把 `fallback.enabled` 打开 + 把 DeepSeek 放进 chain，从"创建新页面"到"重新生成单模块"到"hydrate 整页"全链路都能在 Claude 空钱包时自动顶住。业务侧看不到 502，只在服务器日志看到 `[llm-fallback] {scenario} fell back claude → deepseek after 1 failed hop(s)`。

**分类器修订**（2026-04 · 拦住了用户直接撞到的那条错误路径）：原 `classifyProviderError` 对 Anthropic 的 `400 invalid_request_error` + body "Your credit balance is too low..." 会返 `4xx-other`（永不回退），因为 Anthropic 选了 400 而不是 429 来表达 quota 耗尽。外加 adapter 层的 `LLMCallError(provider, feature, cause)` wrapper 本身没有 `status` 字段，分类器直接拿 wrapper 看永远走 `!status → 'network'` 分支，仅对 5xx-类触发 happen-to-work。两个坑一起修：
- `classifyProviderError` 先剥 `err.cause` 再读 status / message，保证拿到的是 SDK 原始错误。
- 400-499 响应 body 含 `credit balance` / `insufficient_quota` / `purchase credits` / `plans & billing` / `billing` 关键词 → 提升为 `429-quota`。
- `code === 'insufficient_quota'`（某些 OpenAI 兼容 SDK 版本把 code 放在顶层字段上） → 提升为 `429-quota`。
- HTTP 402 Payment Required → 一律 `429-quota`（有些网关用这个 code，比关键词稳）。
- 400 不含 billing 关键词（"prompt too long"之类） → 仍是 `4xx-other`，防过度修补拖着别家陪跑。

测试：`tests/api/admin-llm-config.spec.ts` API-ADMIN-LLM-101..106 六条纯函数用例，不需要 ADMIN_PASSWORD / LLM key 永远跑。

**运维提示：撞到 Anthropic credit 空了怎么快速脱身**：
1. 最快 —— admin UI `/admin/llm` 把 `fallback.enabled` 打开，`fallback.triggers` 至少勾上 `429-quota`，`fallback.chain` 里确保 DeepSeek 排在 Claude 后面。保存后 **copy / strategy / hydrate 全链路** 都能在 Claude 挂时自动切到 DeepSeek 继续出稿，业务侧不再 502，只在服务器日志看到 hop 记录。
2. 不想走 fallback（例如 JP tab 对 DeepSeek 的日文质量不放心）—— 充值 Anthropic，或者临时把 `scenarios.copy.ja` / `scenarios.strategy.ja` 从 claude 改成 deepseek，保存后立刻生效不用 redeploy。
3. 创建新页面的完整链路（strategy → hydrate 6 个 call）今天也接 fallback 了，Anthropic 空时不用再靠手动改 scenarios 逃生。想稳妥的话 chain 里除了 deepseek 还可以再往后加一家（预留多一层保险）—— 但 openai / gemini 目前没 strategy / copy adapter，chain 到它们会报"no adapter"快速跳过，不会帮上忙，也不会卡住。

**已知的 adapter 不兼容模型**（2026-04 用户踩坑后添加）：
- `deepseek-reasoner` (DeepSeek R1)：不支持 `tool_choice`，而 strategy/module-regen 两条路径都用 `tool_choice` 强制结构化 JSON。dropdown 里已移除；若 admin 从 "自定义" 字段输入或 KV 里遗留了该值，`llm-deepseek.ts` 的 `resolveModel()` 会在 server 端 warn 并自动回退到 `deepseek-chat`，保证生产链路不挂。admin UI 检测到该值也会显示黄色兼容性警示。要真正支持 reasoner 得单独做一条 `response_format: json_object` + prompt 层 JSON 约束的代码路径，未排期。
- `deepseek-v4-pro` / `deepseek-v4-flash`（DeepSeek V4 系列，2026-04 上市）：DeepSeek 文档宣传 V4 替代 V3 chat + reasoner 两家。但 **V4 当前不支持 tool 调用**，无论是 `/v1` 端点的 OpenAI `tool_choice` 还是 `/anthropic` 端点的 Anthropic `tool_use` 协议——两条都返 `400 deepseek-reasoner does not support this tool_choice`（错误体里写的是 reasoner 但请求送的是 v4-pro，DeepSeek 内部 V4 路由到 reasoner backend 后撞同一限制）。已用 `scripts/probe-deepseek-anthropic.ts` 实测确认 V3 ✅ V4 ❌。
  - 默认仍用 `deepseek-chat` (V3)，弃用日 2026-07-24 前还有约 3 个月寿命
  - dropdown 里 V3 排第一并标 "推荐 · tool_choice 稳定"，V4 在列保留但加 ⚠️ "当前 tool_choice 不可用" 警示——admin 偶尔可重测
  - DeepSeek 接好 V4 tool 调用前重跑探针即可判断："`DEEPSEEK_API_KEY=sk-... npx tsx scripts/probe-deepseek-anthropic.ts`"，三个 model pass/fail 一目了然
  - 真要支持 V4 之前 DeepSeek 接好，就走 `response_format: json_object` 改造（CLAUDE.md 这条上面也提过），未排期

**持久化（2026-04 第二轮修订）**：和 `storage.ts` 的 Projects / Products CRUD 走同一套三路决策 —— `KV_REST_API_*` 配置好走 KV；没配且 `VERCEL === '1'` 抛 `StorageRequiredError`（admin form 拿到 503，显示 "KV 未配置" 红条）；没配且在本地 dev，fs 存到 `.data/v2-llm-config.json`。第一版曾经只在 no-KV 时 `console.warn` 然后 silently return —— admin 改完点保存，PUT 返回 200，刷新又看到默认值，完全看不出哪里出了问题。现在统一按 storage.ts 的规则来，本地 dev 改的东西也能持久化（到重启 dev server 都还在）；同时 Playwright 测试能在本地完成 round-trip 验证而不需要连 Upstash。

**自定义模型 UX（2026-04 第三轮修订）**：最初 `ModelRow` 有两个按钮 "自定义 / 返回下拉"，切到自定义后输入框独立展示，状态两份（customMode useState + model 值），保存后有时不同步。用户吐槽 "我改了自定义模型去哪里保存" 之后改成下拉末尾一个 "✏️ 自定义…" sentinel option（value=`__custom__`），选中后行下出现带边框的输入框。状态单一来源（`isPreset = options.includes(model)`），刷新 / KV round-trip 也不会错位。同一轮把 action-bar 状态升级成 pill（✓ 已保存 / ● 未保存 / ✗ 错误），并在 PUT 成功后自动再 GET 一次核对 —— 捕捉 "PUT 200 但 KV 里的值对不上" 的代理 / 中间件吞包场景。

**第四种 pill（2026-04 增补）**：上一轮 pill 只管三种 "发生过事" 的状态，"什么都没发生" 时 pill 区域空白。用户截图报 "自定义 mog-3，保存按钮灰，pill 空白" 以为是 bug —— 实际是 mog-3 之前已经存进 KV，加载后 config === baseline → dirty=false → 按钮 disabled（正确行为）。但空白的 pill 区域看起来和 "保存坏了" 没区别。补了第四种 slate 色 neutral pill `· 无改动（与服务器一致）` 填空档，并把四个状态改成显式 `error → dirty → savedAt → neutral` 的 if-else 链（之前是三个 `&&` 并列，理论上可能同时渲染两枚 pill）。E2E 也加了 "刷新后按钮应 disabled + 无改动 pill 可见" 的断言，防回归。

**测试覆盖**：`tests/api/admin-llm-config.spec.ts`（4 条，round-trip / 校验 / scenario 路由 / 未授权）+ `tests/e2e/admin-llm-save.spec.ts`（2 条，UI 保存 + 刷新还在 / preset 切换）。两组都用 `tests/helpers/admin.ts` 的 `ADMIN_PASSWORD` env 守护 —— 没配就 skip，和 LLM key 守护的老测试风格一致。本地跑：
```bash
ADMIN_PASSWORD=<任意值> npx playwright test --grep ADMIN-LLM
```
跑完 `.data/v2-llm-config.json` 可能有测试残留，`rm -f .data/v2-llm-config.json` 清掉。

**相关文件**：
- [src/lib/llm-config.ts](src/lib/llm-config.ts) — Schema / defaults / 读写 / 错误分类器
- [src/lib/llm-fallback.ts](src/lib/llm-fallback.ts) — 回退编排器
- [src/lib/admin-auth.ts](src/lib/admin-auth.ts) — HMAC cookie 工具
- [src/app/admin/llm/](src/app/admin/llm/) — Server page + client form
- [src/app/api/admin/llm-config/route.ts](src/app/api/admin/llm-config/route.ts) — GET/PUT API
- [src/middleware.ts](src/middleware.ts) — admin gate + next-intl 合并入口
- [tests/helpers/admin.ts](tests/helpers/admin.ts) — 管理员登录测试辅助
- [tests/api/admin-llm-config.spec.ts](tests/api/admin-llm-config.spec.ts) · [tests/e2e/admin-llm-save.spec.ts](tests/e2e/admin-llm-save.spec.ts) — 测试

---

## 三、当前存储后端（可热切换）

启动时根据环境变量自动选择：
1. `KV_REST_API_URL` + `KV_REST_API_TOKEN` 存在 → Vercel KV（Upstash Redis）
2. 否则 → 文件系统（本地 `.data/` / Vercel `/tmp/.data`）

检测入口：`GET /api/health` 返回 `storage: "kv" | "fs"`。

切到 Supabase 只需新增 `storage-supabase.ts` 实现同一接口，在 `storage.ts` 按 `SUPABASE_URL` 存在性路由。

---

## 四、TODO / 已知债务

优先级从高到低：

1. **单一产品多语言 / 多市场**：当前 1 项目 = 1 语言。应改成 Product（产品主体）+ LandingPage（每语言/每市场一张）两层模型。
2. **信任资产库分层**：当前全局一份。应拆成 **品牌级 global**（Logo、公司证书、媒体）+ **产品级 scoped**（该产品的证言、案例）。
3. **真 LLM 接入**：三家 adapter 的 TODO 位置接 SDK；Claude 路径启用 prompt caching。
4. **`/p/[slug]` 静态化风险**：和 "四" 同类，应显式 `dynamic = 'force-dynamic'` 防万一。
5. **Supabase 迁移**：PRD v5.1 §2 的路径，替换 KV，带 Auth + RLS 多租户隔离。
6. **地理热力图**：A9 Dashboard Phase 2。
7. **A/B 统计显著性**：Beta 分布计算，替换当前的 ±5% lift 启发式。
8. **部署状态轮询**：当前部署后 status=building 但不自动刷新；应 SSE 或轮询到 READY。

### 四点五、2026-06 Summit 多租户权限改造（进行中）

**背景**：6 月首场 Summit 前要把 LandingPage OS 从"单人工具"升级到"产品方客户能登录 + 多租户隔离"。2026-04-21 跟 weih.xie 拍了一版设计，按四步走。

| Sprint | 内容 | 状态 |
|---|---|---|
| **S1 · 认证地基** | users / tenants / tenant_members / invites 四张表 + magic link + `/invite/[token]` 接受页 + `/app` 工作空间列表 | 2026-04-21 完成 |
| **S2 · 权限 enforce** | `/api/projects/*` `/api/pages/*` `/api/upload/*` 全量加 tenant 范围检查 | 2026-04-25 完成（5 commit） |
| **S3 · OAuth** | Google + Microsoft 绑定（magic link 继续保留作 fallback） | 未开始 |
| **S4 · 管理页** | tenant owner 成员管理（踢人 + 停用邀请 UI）、super admin 概览 | 未开始 |

**S2 落地说明（2026-04-25）**:
- types: `Product` / `Brand` `ownerId` 重命名为 `tenantId`；`LandingPage` / `Lead` 新增 `tenantId`
- storage: `LEGACY_TENANT_ID = 'default'`，coerceTenant() 读时把老 KV blob 的 `ownerId` fallback 成 `tenantId`，老数据不需要迁移就能跑
- storage 新增 scoped reader 选项：`readProducts({tenantId})` / `readLandingPages({tenantId, productId})` / `readLeads({tenantId, projectId})` / `readBrand({tenantId})`
- server-auth.ts: `requireUserAndTenant()`（SSR redirect），`requireUserApi()`（API 401/409）。两者拿 `lp_user` cookie 解 user → 选 tenant（`lp_tenant` cookie 优先，否则取首个）
- SSR 7 个业务页全部接 gate；业务 API 18 个 handler 全接（公开的 leads POST / events POST / `/p/[slug]` 不动）
- 跨 tenant 资源访问统一 404（不 leak 资源是否存在）
- 编辑器 / 创建落地页时 `tenantId` 从 session 推导，不接 body 输入（防止越权重写）
- claim 模式（`claimLegacyData`）：第一位用户在 /app 创建首个 tenant 时自动把所有 `tenantId='default'` 的数据划归该 tenant；二位起见空 dashboard
- header 加 `<HeaderAuthBadge>` 显示当前 tenant + 切换 / 退出
- 测试 helper: `tests/helpers/user-auth.ts loginAndEnsureTenant(request)` 在 e2e/api 测试前完成 magic-link 登录 + 建 tenant，`seedProject` 自动调用

**S1 决策**（2026-04-21 lock，改动前先翻回这条看为什么）：

- 产品方用户入口 = **邀请链接 + magic link**。平台层（weih.xie 自己）走 `/admin/*` 的 ADMIN_PASSWORD 那一套，跟产品方用户隔离（cookie 名 `lp_admin` vs `lp_user`）
- 邀请链接 **不 lock email** —— 发出去随便转发，谁点谁进。泄露风险靠 owner 的停用开关（`invites.disabled`）兜底
- 一个 Gmail **可归属多个 tenant** —— `tenant_members` 是纯多对多 join 表，session 里带当前 tenant 切换器
- 邀请 token **多次可用** —— 不是一次性券。不存 `usedBy/usedAt`，要查谁通过某链接进来查 `tenant_members.invitedVia`
- 邀请 TTL **14 天**，magic link TTL **15 分**
- 首次点邀请链接 **显示确认页**（"加入 XXX 工作空间？"），已是成员则静默跳 `/app`
- owner 可 `PATCH /api/tenants/[id]/invites/[token]` 停用邀请（软停，不删，保审计）

**S1 关键路径（已落地，Summit 前可用）**：

```
/login                      - magic link 登录入口
/invite/[token]             - 邀请接受页（支持未登录 / 已登录 / 已是成员三态）
/app                        - 登录后工作空间列表 + 创建新工作空间

/api/auth/magic-link        POST  {email, returnTo?} → devLink(dev only)
/api/auth/verify            GET   ?token=xxx → 302 回 returnTo 或 /app，set cookie
/api/auth/session           GET   → {user, tenants[]}
/api/auth/logout            POST  → clear cookie

/api/tenants                POST {name} / GET
/api/tenants/[id]/invites   POST {role?} / GET   (owner only)
/api/tenants/[id]/invites/[token]  PATCH {disabled?}   (owner only)

/api/invites/[token]        GET (public peek — 不需要登录)
/api/invites/[token]/accept POST (幂等 — 二次调用返回 alreadyMember=true)
```

**坑位提醒**：
- 本地 dev 没设 `USER_COOKIE_SECRET` 会用一个固定 dev fallback secret，启动时 console 打一条警告。Vercel 上（`VERCEL=1`）没 secret 时拒绝 fallback，直接 500 loud fail。**Summit 前要在 Vercel env 里设 `USER_COOKIE_SECRET` = 32+ 随机字符**
- Magic link 邮件发送走 Resend（`src/lib/email.ts`）。prod 上必须设 `RESEND_API_KEY`，不设时 `POST /api/auth/magic-link` 回 `503 EMAIL_NOT_CONFIGURED`。可选 env：`MAGIC_LINK_FROM_EMAIL`（默认 `onboarding@resend.dev`，Summit 前建议换成已 verify 的自有域名）、`MAGIC_LINK_FROM_NAME`（默认 `LandingPage OS`）
- dev 上无 Resend key 时 magic-link 路由返回 `devLink` 字段让你直接点；Resend 配了之后 dev 也会真发邮件（且仍返回 devLink 方便调试）；prod 永远不返回 devLink
- S2 未完成前，`/api/projects/*` 一切权限控制没生效 —— 任何登录用户还是能看 / 改所有人的页面。S1 只是"能登录"，不是"能隔离"

---

## 五、本地开发

```bash
cd "/Applications/claude code/LandingPage"
npm install
npm run dev         # → http://localhost:3000/zh-CN
npm run build       # 验证 Vercel 部署前会否 build 失败
```

本地（`VERCEL !== '1'`）存储退到 `.data/` 文件系统。LLM 和部署**不再有 mock 回退**：

- 不配任何主 LLM key（`ANTHROPIC_API_KEY` 或 `DEEPSEEK_API_KEY`）→ 创建产品 / 重新生成文案 / 添加语言 都会返回 503，dashboard 顶部挂红色 banner。**只要配任意一个**，生成就能跑（路由层 §2.1 会自动选）。
- 只配 `DEEPSEEK_API_KEY`，没配 `ANTHROPIC_API_KEY` → JP locale 也会 fall back 到 DeepSeek；输出可用但对日文语感要求高的业务建议把 Claude 补上。
- 只配 `ANTHROPIC_API_KEY`，没配 `DEEPSEEK_API_KEY` → 所有 locale 都走 Claude，成本高 30×，但功能完整。
- 两个都配 → 默认 JP→Claude / 其他→DeepSeek。想全站压到一家测试质量差异：加 `LLM_PRIMARY=claude` 或 `LLM_PRIMARY=deepseek`。
- 不配 `OPENAI_API_KEY` → 添加新语言会失败（GPT-4o 本地化 pass 抛错）。
- 不配 `VC_API_TOKEN` → 点"发布"会返回 503，提示 `DEPLOY_REQUIRED`。
- 不配 `BLOB_READ_WRITE_TOKEN` → 本地 OK（图片以 base64 内联，控制台有黄字提醒）；部署到 Vercel 后上传会返回 503，提示 `UPLOAD_REQUIRED`。
- 不配 `ADMIN_PASSWORD` → `/admin/*` 和 `/api/admin/*` 都会跳到 `/admin/setup-required`（页面）或返回 503（API）。LLM 生产流量不受影响 —— admin 界面只是改配置的入口，`DEFAULT_LLM_CONFIG` 继续兜底（见 §2.5）。
- 可选 `ADMIN_COOKIE_SECRET` → 不配的话从 `ADMIN_PASSWORD` 派生，单机跑没差。多实例且要做轮转时才显式配。
- 可选 `OPENAI_BASE_URL` → 把 OpenAI SDK 的请求导向兼容 OpenAI Chat Completions 协议的代理网关（如金山云 kspmas、Azure OpenAI shim、内部 gateway）。不配则走 `https://api.openai.com/v1`。**注意**：`OPENAI_API_KEY` 同时会被发给代理，key 必须是代理认的那把（通常是代理厂商自己的 key，不是 openai.com 的）。

**DeepSeek 申请路径**：https://platform.deepseek.com → API Keys → Create。充值最低 $2。填到 Vercel Project Settings → Environment Variables → `DEEPSEEK_API_KEY` → Redeploy。

想在本地跑通完整流程：把自己的 API key 填到 `.env.local`。想只做 UI 调试：打开 dashboard，看 `/api/capabilities` 返回什么，按红色 banner 指引缺哪补哪。

原来"无 key 也能跑"的设计是隐式鼓励把 mock 输出当真 AI 结果发出去 —— 被用户点出来是 "遮羞布" 之后全部砍掉了（见 §四）。

---

## 六、生产域名

- 前台：https://landingpage.aiverygen.ai/zh-CN
- 仓库：https://github.com/weihuxie/LandingPage-OS-by-CC
- LLM health check：https://landingpage.aiverygen.ai/api/health
- 管理员配置：https://landingpage.aiverygen.ai/admin/llm（需要 `ADMIN_PASSWORD`，见 §2.5）

**协作约定（2026-04 起）**：每次 `git push` 之后，AI 协作者必须在回复里明确给出：
1. 稳定生产 URL（上面那个）
2. 这次推的 commit hash
3. 部署 live 的确认方式 —— 优先用 `curl -s https://landingpage.aiverygen.ai/api/health`，它返回里有 `deployedAt` 字段就是当前部署的 commit short SHA。比调 Vercel API 省事，无需 token。

理由：用户收到"已推送"时想做的第一件事是打开页面验证。把 URL 直接放出来省掉一步复制；commit hash 让他能和 GitHub log 对齐确认没推错分支；health check 命令让他能自己复查 deploy 真的到位了而不是还在 building。

---

## 七、工程规范

### 7.1 新实体的 CRUD 完整性检查单

**为什么有这张清单**：v2-phaseA 那次重构（commit `03fffaa`）后端把 Product / LandingPage 的 CRUD 五件套一次性写全了，连 `deleteProductAndPages` 的级联都考虑到。但前端 UI 是跟着用户任务的 happy path 迭代的 —— **创建 → 编辑 → 本地化 → 发布 → 分析**，每一步都有人催，删除/重命名/导出这类"用户不会主动要"的操作全部漏接。直到 2026-04 用户自己点破才发现："想删一个测试产品得 `curl -X DELETE`"。

根因不是谁粗心，是**没有人在新实体落地时系统性过一遍 CRUD 矩阵**。这张清单就是为了把那次事故制度化，让同类盲区下次触发的时候有一道卡点。

**每个持久化实体上线前必须填满下表**：

| 操作 | 后端 | 前端 | 额外要求 |
|---|---|---|---|
| **Create** | `POST /api/x` | 新建页面 / 按钮 | 去重（slug / id 唯一） |
| **Read (单)** | `GET /api/x/[id]` | 详情页 | 404 处理，loading 态 |
| **List** | `GET /api/x` | 列表页 | 空态文案、排序规则明确 |
| **Update** | `PATCH /api/x/[id]` | 编辑器 | 字段级 validation，autosave 或显式保存 |
| **Delete** | `DELETE /api/x/[id]` | **UI 入口**（见下） | 二次确认 + **级联明细** |

"Delete 的 UI 入口"至少满足**一项**（多数实体两项都值得做）：
- 列表卡片上：kebab menu (`⋯`) 展开 → 红字"删除"
- 详情页顶部：`text-red-600` 文字按钮
- 编辑器 Danger Zone：底部单独一块红边区域

**破坏性操作的 UX 约定**（看 [src/components/DeleteButton.tsx](src/components/DeleteButton.tsx) 的现行实现）：
1. 统一用原生 `window.confirm()`，和 Editor.tsx 里 `deleteLocale` 的现有风格对齐。**不要**给删除单独造一个 modal —— 三套删除弹窗是 UX 碎片化的开端。
2. Confirm 文案固定格式：
   ```
   删除 X「{name}」？
   
   {cascade 明细：列出会连带删的对象名称和数量}
   
   此操作不可撤销。
   ```
3. 级联细节要 **列对象名称**（"会连同以下 3 张落地页一起删除：· CRM 主站 (zh-CN, ja) · ..."），不要只说 "and related data"。用户脑子里能预演 blast radius 才会点下 OK。
4. 非 2xx 响应 → `alert()`。**不要静默失败**，也不要假装成功（fail-loud 原则，见 §四）。
5. 删除成功后跳"上一层"：删 page → product detail；删 product → dashboard。不要留用户在一个刚被删掉的资源详情页。
6. 按钮在 `<Link>` cover 内部时必须 `e.stopPropagation() + e.preventDefault()`，否则会同时触发删除 + 导航到刚删掉的资源。

**可以豁免 Delete 的情况**（**必须主动确认**，不是默认豁免）：
- **单例实体**：例如 Brand。upsert 覆盖即可清空，没有 DELETE API 也行。
- **只读 / audit log 类**：例如 Lead、PageEvent。业务上用户不应该删自己的留资和埋点，但**必须**有 export + archive 路径作为替代。
- **兼容层**：例如 legacy Project。既然要淘汰，不给新 UI 合理。

只要一个实体不在以上三类里，Delete UI 就**必须**存在。

**新实体落地 PR 的自检 checklist**（复制到 PR description 逐项打勾）：

- [ ] storage.ts 的 5 个 CRUD 函数都有（`readX` / `getX` / `saveX` / `deleteX` / `listX`）
- [ ] 5 个 API 路由都有，除非被本节"豁免"条款覆盖
- [ ] 每个读 KV 的 handler / page 都有 `export const dynamic = 'force-dynamic'; export const revalidate = 0;` 并在 server component 里调 `noStore()`（§一.4 + §一.4.1 两个坑合起来才完整）
- [ ] 列表页、详情页、新建页都存在，空态有专门文案
- [ ] Delete UI 至少有一个入口（列表 kebab / 详情页按钮 / Editor Danger Zone）
- [ ] Confirm 文案遵循本节格式，级联明细已列出
- [ ] 关联实体能独立删除（不仅是级联被动删），且级联关系写进了 `deleteX` 而不是散在 UI 层
- [ ] 如果走了豁免，PR 描述里写清楚走的是哪条豁免

**历史包袱**（2026-04 盘点，尚未全部清完）：
- Lead：只读但**没有 export / 详情页** — 违反"只读实体必须有 archive 路径"条款。见 §四 TODO。
- Product rename：API `PATCH /api/products/[id]` 已支持，UI 仅在 Editor > Settings 里 —— 不算违规，但"改名要绕两层"是 UX 割裂。
- Editor 里删当前 page：要退回 ProductPagesList 才能删。不违反规范（ProductPagesList 已有入口），但 Danger Zone 加上会更顺手。

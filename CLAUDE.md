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

### 2.1 LLM 路由策略（PRD v5.1 §4.1）
三家互补，不是"挑一家"：
| 模型 | 职责 |
|---|---|
| Gemini 1.5 Pro | 长文档摄取（白皮书/手册）→ 抽核心价值 |
| Claude 3.5 Sonnet | 结构化 JSON 文案生成，叙事稳定性 |
| GPT-4o | 多语言语境转换、文化自检 |

代码抽象：[src/lib/llm-claude.ts](src/lib/llm-claude.ts) / [src/lib/llm-openai.ts](src/lib/llm-openai.ts) / [src/lib/llm-gemini.ts](src/lib/llm-gemini.ts)。

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

### 2.4 策略 → 模块生成管线（PRD v5.1 §4.3 延伸）
早期 bug：`generateModules(inputs, tone)` 不读 strategy，用户编辑策略没用。

修复：`generateVariants(inputs, tone, strategy)` + `applyStrategyToModules(modules, strategy)`：
- strategy.goal 里检测"表单 3-4 字段" → 自动缩表单
- strategy.audience 里提取问句 → 注入到 FAQ 顶部

策略是"生成 prompt 的结构化约束"，不是展示。

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

---

## 五、本地开发

```bash
cd "/Applications/claude code/LandingPage"
npm install
npm run dev         # → http://localhost:3000/zh-CN
npm run build       # 验证 Vercel 部署前会否 build 失败
```

本地（`VERCEL !== '1'`）存储退到 `.data/` 文件系统。LLM 和部署**不再有 mock 回退**：

- 不配 `ANTHROPIC_API_KEY` → 创建产品 / 重新生成文案 / 添加语言 这些按钮都会返回 503，编辑器顶部挂红色 banner。
- 不配 `OPENAI_API_KEY` → 添加新语言会失败（GPT-4o 本地化 pass 抛错）。
- 不配 `VC_API_TOKEN` → 点"发布"会返回 503，提示 `DEPLOY_REQUIRED`。
- 不配 `BLOB_READ_WRITE_TOKEN` → 本地 OK（图片以 base64 内联，控制台有黄字提醒）；部署到 Vercel 后上传会返回 503，提示 `UPLOAD_REQUIRED`。

想在本地跑通完整流程：把自己的 API key 填到 `.env.local`。想只做 UI 调试：打开 dashboard，看 `/api/capabilities` 返回什么，按红色 banner 指引缺哪补哪。

原来"无 key 也能跑"的设计是隐式鼓励把 mock 输出当真 AI 结果发出去 —— 被用户点出来是 "遮羞布" 之后全部砍掉了（见 §四）。

---

## 六、生产域名

- 前台：https://landing-page-os-by-cc-liart.vercel.app/zh-CN
- 仓库：https://github.com/weihuxie/LandingPage-OS-by-CC
- LLM health check：https://landing-page-os-by-cc-liart.vercel.app/api/health

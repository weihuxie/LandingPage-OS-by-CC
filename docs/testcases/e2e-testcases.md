# E2E 测试用例 · LandingPage(Playwright)

> 范围:基于 Editor / Wizard / Dashboard 中**实际存在**的 UI 交互,覆盖"保存后前端必须渲染出结果"的核心路径。
> ID 规则:`E2E-<模块>-<序号>`。每个用例 ID 与未来的 Playwright `test('E2E-XXX-NNN …', ...)` 1:1 对应。
> 脚本状态列格式:`未写` / `已写 · <脚本相对路径>`。

---

## 0. 环境与前置

| 项 | 值 |
|---|---|
| 被测站点 | `http://localhost:3000/zh-CN` |
| 启动 | `npm run dev`(Playwright 配置 `webServer` 自动拉起) |
| 存储 | 本地 `.data/*.json`(测试期间用 fixture 文件覆盖/还原) |
| LLM 依赖 | **默认不需要**。绝大多数用例通过 fixture 种子跑通。带 `[需 KEY]` 标记的用例仅当对应 key 存在时执行(Playwright `test.skip(!process.env.ANTHROPIC_API_KEY, ...)`) |
| Fixture 种子方式 | 用 `request` fixture 直接 `POST /api/projects`(带 `body.strategy`)在每个 test 的 beforeEach 生成一个 Product+Page,记下 `pageId` / `productId` / `slug` |
| 清理 | afterEach 调 `DELETE /api/products/[productId]` 级联清理 |
| 浏览器 | chromium;viewport 1280×800;中文 locale |
| 断言来源 | **必须用可见的 UI 文本/属性**作为结果依据(不直接读 JSON)。网络响应仅用作 flow 卡点,不用作结果断言。|

---

## 1. 用例清单

| ID | 场景 | 核心验证点 | 脚本状态 |
|---|---|---|---|
| E2E-EDT-001 | 编辑 Hero 标题,400ms 后自动保存 | 徽章 `✓ 已保存`;刷新后编辑器仍显示新标题 | 已写 · `tests/e2e/editor-autosave.spec.ts` |
| E2E-EDT-002 | 编辑 Hero 标题,实时预览同步刷新 | 右侧 PageRenderer 实时显示新标题(无需刷新) | 已写 · `tests/e2e/editor-autosave.spec.ts` |
| E2E-SET-001 | 设置弹窗修改产品名 → 编辑器状态跟着刷新 | 弹窗内 `已保存 ✓`;关闭弹窗后编辑器左侧产品名 / 或刷新后 Dashboard 卡片标题跟着变 | 已写 · `tests/e2e/settings.spec.ts` |
| E2E-SET-002 | 设置弹窗修改产品 Tagline | 弹窗显示 `已保存 ✓`;`GET /api/products/[id]` 返回新 tagline | 已写 · `tests/e2e/settings.spec.ts` |
| E2E-SET-003 | 设置弹窗修改产品 Value(核心价值) | 弹窗显示 `已保存 ✓`;再次打开弹窗输入框仍是新值 | 已写 · `tests/e2e/settings.spec.ts` |
| E2E-SET-004 | 设置弹窗切换风格预设 | 右侧 PageRenderer 视觉风格切换;刷新后选中态保留 | 已写 · `tests/e2e/settings.spec.ts` |
| E2E-SET-005 | 设置弹窗切换 Tone(语气) | 走自动保存徽章 `保存中…` → `已保存 ✓`;刷新后 select 仍为新值 | 已写 · `tests/e2e/settings.spec.ts` |
| E2E-SET-006 | 设置弹窗改主色 | 右侧 PageRenderer 主色实时变化;防抖保存徽章 `已保存 ✓`;刷新后保持 | 已写 · `tests/e2e/settings.spec.ts` |
| E2E-LEAD-001 | 公网落地页提交线索 | 表单从可见 → 成功反馈 `✓ 已收到,我们会尽快联系你。`;Dashboard / ProductPagesList 的 leads 计数 +1 | 已写 · `tests/e2e/leads-submit.spec.ts` |
| E2E-LOC-001 | 切 locale tab 后,左侧模块列表 + 右侧 PageRenderer 切到目标语言内容 | tab 高亮移动;模块文本语言切换;默认 tab 带 ★ 徽章 | 已写 · `tests/e2e/locale-switch.spec.ts` |
| E2E-LOC-002 | 在日文 tab 编辑标题 → 切中文 → 切回日文,跨 tab 编辑隔离 | 中文 tab 内容未被波及;回日文 tab 仍看到刚编辑的新标题;两边都持久化 | 已写 · `tests/e2e/locale-switch.spec.ts` |
| E2E-LOC-003 | [需 KEY · Claude+OpenAI] 点 `+ 加语言` → 选日语 → 审批 → 新 tab 出现且内容为日文 | LocalizationPreviewModal 出现 → 审批后 `+ 加语言` 变 `生成中…` → 新 `日本語` tab 自动成为 active;Hero 文本是日文 | 已写 · `tests/e2e/locale-add.spec.ts` |
| E2E-LOC-004 | [无 KEY] 点 `+ 加语言` 失败路径 | Preview modal 正常出现 + 审批 → modal 关闭 + 顶部红 banner `需要配置 LLM API Key`;日文 tab 未被加入 | 已写 · `tests/e2e/locale-add.spec.ts` |
| E2E-HYD-001 | [需 KEY · Claude] 初始 `hydrationFailed=true` 的页面,点 `立即 hydrate` | 红 banner 出现 + 按钮可点 → 点后变 `生成中…` → 完成后 banner 消失 + Hero 文本被改写 | 已写 · `tests/e2e/hydrate.spec.ts` |
| E2E-HYD-002 | [无 KEY] 初始 `hydrationFailed=true` 的页面,`立即 hydrate` 按钮状态 | 红 banner 出现;按钮 disabled + tooltip `需要 ANTHROPIC_API_KEY 才能让 Claude hydrate。`;中间 Hero 区域顶部单独一条 `Hero 文案可能仍是模板占位符` 警告 | 已写 · `tests/e2e/hydrate.spec.ts` |
| E2E-VAR-001 | 切换 A/B Variant,右侧 preview 切换 | 点击 `方案 B` 后 PageRenderer 渲染 B 的模块顺序(第一个模块变 benefits) | 已写 · `tests/e2e/variant-publish.spec.ts` |
| E2E-PUB-001 | 乐观切换 published 标记(跳过 Vercel 部署) | 按钮文案从 `发布` → `发布中…`;若未配 VC_API_TOKEN 则出现红 banner 且按钮回滚到 `发布`(与实际发布失败一致) | 已写 · `tests/e2e/variant-publish.spec.ts` |
| E2E-DASH-001 | Dashboard 列出已存在产品 | 看到种子产品卡片,标题 / markets / 已发布徽章渲染正确 | 已写 · `tests/e2e/dashboard.spec.ts` |
| E2E-PAGE-001 | 删除 Locale Tab,UI 立即消失 | 被删除的 locale 徽章消失;刷新后仍不存在 | 已写 · `tests/e2e/locale-delete.spec.ts` |

> 说明:以下场景因没有 UI 入口,**不**做 E2E:产品删除、页面删除、deploy-to-Vercel(依赖外部凭据)。这些走 API 用例。
> 重新生成 / 添加语言 需要 Claude/GPT key,暂不列入"核心场景"。

---

## 2. 详细用例

### E2E-EDT-001 · 编辑 Hero 标题后自动保存并持久化

- **前置**:
  1. beforeEach 通过 API 种子创建 Product+Page,取到 `pageId`。
  2. Page 的 variants.A["zh-CN"] 中至少有 1 个 `type="hero"` 模块。
- **步骤**:
  1. `page.goto('/zh-CN/projects/' + pageId)`。
  2. 等待 Editor 渲染完成(等待 `role="toolbar"` 或 `发布` 按钮出现)。
  3. 左侧点中 Hero 模块(使 ModuleEditor 显示在右侧)。
  4. 定位 Hero `headline` 输入框,`fill("E2E-EDT-001 新标题")`。
  5. 等待保存徽章出现 `已保存 ✓`(观察窗口 2 s)。
- **预期**:
  - 保存徽章曾闪现 `保存中…`,最终停留为 `已保存 ✓` 或 `● 已保存 · HH:MM:SS`。
  - 刷新页面(`page.reload()`)后,Hero headline 输入框 value 仍为 `"E2E-EDT-001 新标题"`。
  - 右侧 PageRenderer 中对应 Hero 模块文本包含 `"E2E-EDT-001 新标题"`。
- **对应 bug**:如果 `setPage(data.page)` 与 `project.modules` 未双向同步,刷新后可能回退到旧值 — 这条用例正是要抓住它。

### E2E-EDT-002 · 编辑实时同步到右侧预览

- **前置**:同 E2E-EDT-001。
- **步骤**:
  1. 进入编辑器。
  2. 选中 Hero 模块。
  3. 输入新 headline `"E2E-EDT-002 实时同步"`。
  4. 等 50ms(不等防抖 400ms),读取右侧 PageRenderer 的 Hero 文本。
- **预期**:
  - PageRenderer 在输入即刻(防抖结束前)就反映新文本 — 说明 preview 走 `project.modules` 受控,而非等 server 响应。

### E2E-SET-001 · 设置弹窗改产品名 → 全局刷新

- **前置**:种子 product 的初始 name=`"TestProduct"`。
- **步骤**:
  1. 进入编辑器。
  2. 点击右上角 `⋮` 打开溢出菜单 → 点击 `⚙ 设置(风格 · 语气 · 主色)`。
  3. 在"产品名"输入框清空并输入 `"RenamedProduct"`。
  4. 将焦点移出输入框(触发 onBlur)。
  5. 等待徽章 `已保存 ✓` 出现。
  6. 关闭设置弹窗,导航到 `/zh-CN/dashboard`。
- **预期**:
  - 设置弹窗内先后出现 `保存中…` → `已保存 ✓`。
  - 导航至 Dashboard 后,产品卡片标题为 `"RenamedProduct"`。
- **对应 bug**:当前 `onProductInfoChange(patch)` 仅合并 `project.inputs`,**没有**用响应里的完整 product 覆盖本地 product 状态;Dashboard 靠 `force-dynamic` 每次重取,但若 Editor 内某处还依赖旧 product 对象,会看到旧值 — 这条用例把"保存后是否渲染"落到了实际 DOM 文本上。

### E2E-SET-002 · 改 Tagline → 可读性验证

- **前置**:同 E2E-SET-001。
- **步骤**:
  1. 打开设置弹窗,Tagline 输入框填 `"E2E new tagline"`,onBlur。
  2. 等徽章 `已保存 ✓`。
  3. 通过 `request.get('/api/products/' + productId)` 拉一次对比。
- **预期**:
  - UI 徽章为 `已保存 ✓`。
  - API 返回的 `product.tagline === "E2E new tagline"`。

### E2E-SET-003 · 设置弹窗改产品 Value

- **前置**:种子 product.value=`"seed value"`。
- **步骤**:
  1. 进入编辑器 → 打开设置弹窗。
  2. "核心价值"textarea 清空并填入 `"E2E-SET-003 新价值"`。
  3. 焦点移出 textarea(触发 onBlur)。
  4. 等待徽章 `已保存 ✓`。
  5. 关闭弹窗,再重开一次。
- **预期**:
  - 徽章曾出现 `保存中…`,然后 `已保存 ✓`。
  - 重开弹窗后 textarea value 仍为新值(验证本地渲染已刷新,不需要刷新页面)。

### E2E-SET-004 · 切换风格预设

- **前置**:种子 page 当前 `theme.styleId` 已知(取 `STYLE_PRESETS` 里的另一个 id 作为目标,比如从 `saas-refined` 换到 `jp-premium`)。
- **步骤**:
  1. 进入编辑器 → 打开设置弹窗。
  2. 记录当前右侧 PageRenderer 某个可见的风格特征(如 hero 容器的 className 或 `data-style` 属性)。
  3. 在"风格"区块点击目标 preset 卡片(`border-brand-300 bg-brand-50` 高亮变化)。
  4. 关闭弹窗。
- **预期**:
  - 目标 preset 卡片呈现选中样式(`border-brand-300`)。
  - PageRenderer 对应风格特征已改变(类名或 data 属性断言,不强依赖视觉像素)。
  - 刷新后重开弹窗,目标 preset 仍是选中态。
- **对应 bug 意义**:风格走的是**直写式** PATCH `/api/projects/[id] { newStyleId }`(`Editor.tsx:636-643`),不走 `touch()` 防抖 — 是一种独立保存路径,必须单独测。

### E2E-SET-005 · 切换 Tone

- **前置**:种子 page tone=`"saas"`。
- **步骤**:
  1. 进入编辑器 → 打开设置弹窗。
  2. 定位 Tone select,选 `professional`(或其他不等于 `saas` 的值)。
  3. 等待顶部编辑器工具栏的保存徽章 `保存中…` → `已保存 ✓`(走主编辑器的自动保存路径,非弹窗内徽章)。
  4. 刷新页面。
- **预期**:
  - 保存徽章最终为 `已保存 ✓` / `● 已保存 · HH:MM:SS`。
  - 刷新后重开设置弹窗,Tone select value === `"professional"`。
- **说明**:Tone 走 `touch()` → 400ms 防抖 → PATCH `/api/pages/[id]`(`Editor.tsx:606-609` + 自动保存 effect)。

### E2E-SET-006 · 改主色

- **前置**:种子 page theme.primary=`"#4861ff"`(默认)。
- **步骤**:
  1. 进入编辑器 → 打开设置弹窗。
  2. 在"主色"hex 输入框直接填入 `"#ff00aa"`(比 color picker 更好断言)。
  3. 等防抖保存徽章 `已保存 ✓`。
  4. 检查右侧 PageRenderer 里带 brand 色的元素(如 CTA 按钮)背景色。
- **预期**:
  - 保存徽章最终为 `已保存 ✓`。
  - CTA 按钮(或 `--brand` CSS var 的元素)计算样式中包含 `#ff00aa`(或 `rgb(255, 0, 170)`)。
  - 刷新后 hex 输入框 value 仍为 `"#ff00aa"`。

### E2E-VAR-001 · 切换 A/B Variant

- **前置**:种子 page `activeVariant="A"`,variants.B["zh-CN"] 存在(种子时自动双生成)。
- **步骤**:
  1. 进入编辑器。
  2. 记录当前左侧模块列表第一个的 type(Variant A 应为 `hero`)。
  3. 点击 variant 切换控件 → 选 `方案 B`。
  4. 等待左侧列表刷新。
- **预期**:
  - 左侧模块列表第一个仍是 `hero`(两方案第一个都是 hero),但**第二个**模块从 `socialProof`(A)变为下一顺序(B 方案结构见 variants.B["zh-CN"] 种子内容) —— 用"第二个模块的 type"作断言以避开 A/B 共同头部。
  - 右侧 PageRenderer 反映新的模块顺序。

### E2E-PUB-001 · 点击发布(无部署凭据场景)

- **前置**:无 `VC_API_TOKEN` 环境变量(本地默认)。
- **步骤**:
  1. 进入编辑器。
  2. 点击右上角 `发布` 按钮。
  3. 观察状态变化 2 s 内。
- **预期**:
  - 按钮先变 `发布中…`。
  - 出现红色 banner,标题为 `需要配置部署凭据` 且文案含 `VC_API_TOKEN`。
  - 按钮回滚为 `发布`(乐观标记被退回)。
  - `request.get('/api/pages/' + pageId)` 返回的 `page.published === false`(回滚写入已发送)。
- **说明**:本条只验证**乐观更新 + 失败回滚**这条核心 UI 渲染链,不测实际 Vercel 部署。

### E2E-DASH-001 · Dashboard 渲染产品卡片

- **前置**:种子 product+page。
- **步骤**:
  1. `page.goto('/zh-CN/dashboard')`。
- **预期**:
  - 页面出现 `我的产品` 标题。
  - 找到一张卡片文本包含种子产品的 `name` 和 `tagline`。
  - 卡片含"草稿"或"已发布"徽章之一。

### E2E-LEAD-001 · 公网落地页提交一条线索

- **前置**:
  1. 种子 page,published 不强制(`/p/[slug]` 本身按 slug 查询,不卡发布状态);拿到 `slug=S`、`pageId=L`。
  2. 记录提交前 `GET /api/pages/L` 的 `page.stats.leads`(记为 `n0`)。
- **步骤**:
  1. `page.goto('/p/' + S)`。
  2. 滚动到表单区块(`id="contact"` 锚点)。
  3. 填姓名 `张三`、邮箱 `z@test.com`、必填项(根据 form.fields 动态判断,核心场景只测默认字段组合)。
  4. 勾选同意隐私政策 checkbox(不勾 submit 按钮不会响应,`LeadFormClient.tsx:77`)。
  5. 点击 submit。
  6. 等成功反馈出现。
- **预期**:
  - 表单区块被替换为成功卡片,文本包含 `✓ 已收到` 或 locale 对应的 `success` 文案(`LeadFormClient.tsx:101-107`)。
  - 导航到 `/zh-CN/dashboard`,找到对应 page 的卡片,leads 计数显示为 `n0 + 1`(文本含 `(n0+1) leads`)。
  - `request.get('/api/pages/' + L)` 返回的 `page.stats.leads === n0 + 1`。
- **核心价值**:这条覆盖"前端表单 → 后端落库 → 汇总计数 → 前端列表再渲染"这条端到端链,正是你提到的"保存了要能渲染出来"的典型场景。

### E2E-LOC-001 · 切换 locale tab 显示对应语言

- **前置**:
  - 通过 fixture(直接写 `.data/v2:pages.json`)预置 page `L`:
    - `availableLocales = ["zh-CN","ja"]`,`defaultLocale = "zh-CN"`
    - `variants.A["zh-CN"]` Hero headline = `"中文主标题"`
    - `variants.A["ja"]` Hero headline = `"日本語メインタイトル"`
    - B 方案同理注入可辨识文本
  - 说明:真走 `+ 加语言` 需 Claude+GPT 双 key,不在本轮范围;用 fixture 保持"已多语言"起始态。
- **步骤**:
  1. `page.goto('/zh-CN/projects/' + L)`。
  2. 确认默认 tab 是"简体中文 ★",PageRenderer 显示 `"中文主标题"`。
  3. 点击 `日本語` tab。
  4. 等 tab 高亮切换完成(`border-brand-600 bg-white font-medium`)。
- **预期**:
  - `日本語` tab 高亮(类名含 `border-brand-600`)、`简体中文` tab 失去高亮。
  - 默认 tab 仍然带 `★` 徽章(位于 `简体中文`,即便它不是当前 tab)。
  - 右侧 PageRenderer Hero 文本变为 `"日本語メインタイトル"`。
  - 左侧模块列表的 Hero 条目预览文本也是日语。
- **说明**:切 tab 在代码里不走网络,纯本地(`Editor.tsx:698-705` 从 `page.variants[v][targetLocale]` 取数据)。这条是"保存后能在 UI 看到"的前置 — 如果读路径有问题,后续的写入隔离测试等于空跑。

### E2E-LOC-002 · 跨 locale tab 编辑隔离

- **前置**:同 E2E-LOC-001 fixture 状态。
- **步骤**:
  1. 进入编辑器。
  2. 切到 `日本語` tab。
  3. 选中 Hero 模块 → headline 改为 `"E2E-LOC-002 日本語 edit"` → 失去焦点等 800ms(含 400ms 防抖)。
  4. 等保存徽章 `已保存 ✓`。
  5. 切回 `简体中文` tab。
  6. 记录当前 Hero headline(应仍为 fixture 原值 `"中文主标题"`)。
  7. 再切回 `日本語` tab。
  8. 记录当前 Hero headline(应为 `"E2E-LOC-002 日本語 edit"`)。
  9. `page.reload()`。
  10. 重复 5-8,验证跨刷新仍保持。
- **预期**:
  - 步骤 6:中文 Hero headline === `"中文主标题"`(**没被波及**)。
  - 步骤 8:日文 Hero headline === `"E2E-LOC-002 日本語 edit"`(回切后仍在)。
  - 刷新后仍成立(落库隔离,不是仅本地内存)。
  - `GET /api/pages/L` 返回的 `variants.A["zh-CN"][0].content.headline === "中文主标题"`,`variants.A["ja"][0].content.headline === "E2E-LOC-002 日本語 edit"`。
- **关键点**:这是本轮最容易暴露"后端保存了前端不渲染" / "串显示"类 bug 的用例 —— 前端 `project.modules` 与 `page.variants[v][locale]` 的双向同步、切 tab 的 eager flush、400ms 防抖 race 都压在这条路径上(`Editor.tsx:340-357`、`:656-706`、`:366-434`)。

### E2E-LOC-003 · [需 KEY] 端到端加日语

- **前置**:
  - Playwright 进程能读到 `ANTHROPIC_API_KEY` 和 `OPENAI_API_KEY`;在 dev server 启动前注入。
  - 种子 page `L`,availableLocales=`["zh-CN"]`。
  - `test.skip(!process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY, 'needs Claude+OpenAI')`。
  - 整条用例超时:**120 s**(服务端 maxDuration 60s + modal 打开 + 前端渲染)。
- **步骤**:
  1. `page.goto('/zh-CN/projects/' + L)`。
  2. 定位 `+ 加语言` details 元素 → click,展开下拉。
  3. 点击 `日本語` 选项。
  4. 等 LocalizationPreviewModal 出现(标题含"为添加 日本語 版本定制本地化策略")。
  5. 不修改 preview 内容,直接点 `审批` 按钮。
  6. 观察 `+ 加语言` 按钮文本变为 `生成中…`。
  7. 等待(≤ 90s)`日本語` tab 出现在 locale tab 列表,且成为当前激活 tab。
- **预期**:
  - Modal 已关闭、无错误 banner。
  - Locale tab 列表包含 `日本語`,高亮在 `日本語`。
  - 左侧模块列表第一个条目(Hero)的预览文本是日文(至少包含日文假名或汉字,断言可用正则 `/[ぁ-んァ-ヴ]|[一-龥]/`)。
  - `request.get('/api/pages/' + L)` 返回 availableLocales 含 `"ja"`,variants.A["ja"][0].content.headline 非空且不等于 zh-CN 的 headline。

### E2E-LOC-004 · [无 KEY] 加语言失败走 banner

- **前置**:
  - 确保 dev server 启动时 `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY` **至少有一项缺失**(CI 上可单独跑一个独立 dev server 实例;本地可用 `env -u ANTHROPIC_API_KEY npm run dev`)。
  - 种子 page `L`,availableLocales=`["zh-CN"]`。
- **步骤**:
  1. 进入编辑器。
  2. 展开 `+ 加语言` → 点 `日本語`。
  3. 等 LocalizationPreviewModal 出现(preview 本身不需要 key,正常打开)。
  4. 点 `审批`。
  5. 观察顶部 banner。
- **预期**:
  - Modal 关闭。
  - 顶部出现红色 NoticeBanner,标题 `需要配置 LLM API Key`,文案含 `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY`。
  - Locale tab 列表**仍只有** `简体中文`,没有 `日本語`。
  - `+ 加语言` 按钮文本已从 `生成中…` 回到 `+ 加语言`。
  - `request.get('/api/pages/' + L)` 的 availableLocales 仍为 `["zh-CN"]`(落库未污染)。
- **关键点**:验证前端"乐观添加 tab"**不存在**——加语言是真等服务端返回才写 UI,失败时 tab 不会鬼影一下再消失。

---

### E2E-HYD-001 · [需 KEY] 从 hydrationFailed 状态一键 hydrate

- **前置**:
  - `ANTHROPIC_API_KEY` 存在。
  - Fixture 种子 page `L`:`hydrationFailed=true`,variants.A["zh-CN"][hero].content.headline 是已知模板值 `"你好 {产品名}"`(或 fixture 里注入的任一可辨识值)。
  - `test.skip(!process.env.ANTHROPIC_API_KEY, 'needs Claude')`。
  - 超时:120 s。
- **步骤**:
  1. 进入编辑器。
  2. 顶部应立即出现红 banner:标题 `本页 Claude 初始化未成功`,带 `立即 hydrate（当前语言）` 按钮。
  3. 确认按钮不是 disabled(tooltip 不出现 key 相关提示)。
  4. 点按钮。
  5. 按钮文本变 `生成中…`,等待(≤ 90s)完成。
- **预期**:
  - 顶部 banner 消失(或被新 banner 替换为不含 HYDRATION_FAILED)。
  - 中间 PageRenderer 上方的"Hero 文案可能仍是模板占位符"黄色警告**不再出现**。
  - 左侧模块列表 Hero 条目的预览文本不再是 fixture 里的模板值。
  - `request.get('/api/pages/' + L)` 返回的 page.hydrationFailed === `false`,hero headline 变。

### E2E-HYD-002 · [无 KEY] Hydrate 按钮被正确 disabled

- **前置**:
  - `ANTHROPIC_API_KEY` 缺失(dev server 需要在此环境启动,或通过 `/api/capabilities` mock);`GET /api/capabilities` 返回 `hasClaude === false`。
  - Fixture 种子 page `L`:`hydrationFailed=true`。
- **步骤**:
  1. 进入编辑器。
  2. 顶部红 banner 自动出现。
  3. 把鼠标悬停在 `立即 hydrate（当前语言）` 按钮上。
- **预期**:
  - Banner 可见,文案同 E2E-HYD-001。
  - 按钮 `disabled` 属性为 true(或 class 含 disabled/opacity-50)。
  - Tooltip 文本 === `需要 ANTHROPIC_API_KEY 才能让 Claude hydrate。`
  - 中间 PageRenderer 上方**同时**存在另一条黄色 `Hero 文案可能仍是模板占位符` 警告(`Editor.tsx:1168-1180` 的独立分支)。
  - `request.get('/api/pages/' + L)` 的 page.hydrationFailed 仍为 `true`(没被误触的 POST 刷掉)。
- **关键点**:这条是**无 key 也能跑**的核心回归,抓的是 UI gating 是否正确阻止用户发起会 503 的请求。

### E2E-PAGE-001 · 删除 Locale Tab 后 UI 立即消失

- **前置**:种子 page 先通过 API 添加一个额外 locale(或种子本身 availableLocales ≥ 2)。若当前只有单 locale,本用例跳过并记录。
- **步骤**:
  1. 进入编辑器。
  2. 在 locale tab 列表中找到非默认语言的 tab。
  3. 点击 tab 上的 `×` 或 `删除 <语言> 版本` 按钮。
  4. 在 confirm 弹窗中确认。
- **预期**:
  - 被删除的 tab 徽章从 DOM 中消失。
  - 刷新页面后该 tab 仍然不存在。
  - `GET /api/pages/[id]`.page.availableLocales 不含被删 locale。

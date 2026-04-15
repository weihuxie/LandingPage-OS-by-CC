# LandingPage OS — PRD v5.1

> 混合 LLM 驱动的 B2B 多产品营销增长操作系统
> 平台托管 API Key · 对用户免费 · 数据物理隔离

---

## 1. 产品愿景

通过「AI 策略建议 + 结构化资产库 + 视觉红线审计」的闭环，让用户几分钟内产出符合全球（US / JP / CN / TW）商务习惯的工业级落地页。

## 2. 账号与数据安全

- **注册**：邮箱 + Magic Link
- **隔离**：Row Level Security，每用户资产库/项目/线索物理分离
- **LLM Key**：平台统一托管（ANTHROPIC / GOOGLE / OPENAI），用户免费，无感切换

## 3. 核心旅程

注册 → 资产预设 → 创建项目 → AI 透明化解析 → 策略调优 → 双方案输出 → 行内编辑 → 红线扫描 → 部署或打包 → 多产品监控

## 4. 关键模块

### 4.1 混合 LLM 协作（平台托管）
| 模型 | 职责 |
|---|---|
| Gemini 1.5 Pro | 长文档摄取（白皮书/手册）精准提取 |
| Claude 3.5 Sonnet | 结构化 JSON 文案，叙事稳定性 |
| GPT-4o | 多语言语境转换、文化自检 |

任意 Key 缺失 → 对应适配器自动回退到确定性模板。

### 4.2 结构化信任资产库 A2
- 企业品牌（Logo、主色、字体、视觉指南）
- 客户证言（按痛点/行业/标签）
- 认证合规（SOC 2 / ISO / GDPR，按市场）
- 标杆案例（行业 + 指标）
- 媒体背书（标题 + 金句 + 原文链接）

### 4.3 双方案输出引擎 B2
- **方案 A**：Pain-Agitate-Solve，损失厌恶导向
- **方案 B**：Benefit-Focused，ROI/结果导向
- 编辑器一键切换，发布时可双开 A/B 分流

## 5. 视觉与排版

### 5.1 区域预设
| 市场 | 风格默认 | 语气/字体 |
|---|---|---|
| JP | Minimal Trust | 克制、Noto Sans JP、行高 1.8 |
| TW/EU | Enterprise Clean | 稳健、衬线小标 |
| US | Bold ROI | 大号数字、强 CTA、Inter 800 |
| CN | SaaS Modern | 信息密度中等、渐变 |

### 5.2 红线清单（linter 实时扫描）
- 非英文市场禁全大写标题
- Hero 标题 > 60 字告警
- 表单字段 > 5 告警
- JP 市场缺信任模块 → error
- 主色对白底对比度 < 0.78 → warn
- 强 CTA 区块 > 2 个 → warn

## 6. A/B 与发布

- **部署**：托管路由 `/p/[slug]`，cookie 粘性分流，自动记 UV/Lead
- **打包**：`GET /api/projects/:id/export` 返回自包含 HTML 文件
- **A/B**：publishMode = `single | ab-split`，看板基于样本 + lift 推荐胜出

## 7. 多产品增长看板（A9）

详见 [A9-DASHBOARD-PRD.md](./A9-DASHBOARD-PRD.md)

顶部 KPI + 横向对比 + 语言分布 + AI 任务池。

## 8. 技术栈

- Frontend: Next.js 14 App Router, TypeScript, Tailwind, Shadcn/UI (Mobile First)
- Backend: Next.js Route Handlers (MVP) → Supabase RLS (Phase 2)
- Infra: Vercel + Cloudflare CDN
- Analytics: 自建 event 表（PoC）→ ClickHouse / PostHog（Phase 2）

## 9. 阶段里程碑

### Phase 1 (已落地)
- 四步向导 · 双方案生成 · A2 资产库 · 风格系统 · A/B 分流 · 红线 linter · HTML 导出 · A9 看板 · URL 品牌色抓取

### Phase 2
- Supabase Auth + RLS
- 真实 LLM 调用（替换三适配器）
- Vercel API 一键部署子域名
- 地理热力图

### Phase 3
- Team 权限、审计日志、告警推送
- Slack / 飞书集成
- Beta 分布 A/B 置信度

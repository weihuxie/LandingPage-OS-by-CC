# 部署手册 — LandingPage OS by CC

> 两层部署：
> 1. **部署本应用**到 Vercel（你自己的 SaaS 后台）
> 2. **启用「部署到 Vercel」产品能力**（让用户一键上线他们的落地页）

---

## 0. 开始前你需要

- GitHub 账号
- Vercel 账号（免费档够用，https://vercel.com/signup）
- 可选：自定义域名（aliyun / Cloudflare / Porkbun 都行）

---

## Part 1 · 部署本应用到 Vercel

### 1.1 把代码推到 GitHub

在 `LandingPage/` 目录下：

```bash
cd "/Applications/claude code/LandingPage"

git init
git add .
git commit -m "init: LandingPage OS by CC"

# 在 GitHub 新建一个仓库（比如 landingpage-os），不要勾初始化
git remote add origin git@github.com:<你的用户名>/landingpage-os.git
git branch -M main
git push -u origin main
```

> ⚠️ 先确认 `.gitignore` 里有 `node_modules` 和 `.data`，避免把你本地的测试数据一起提交。
> 如果没有，先建一个：

```bash
cat > .gitignore <<'EOF'
node_modules
.next
.data
.env
.env.local
.DS_Store
EOF
```

### 1.2 在 Vercel 上导入

1. 登录 https://vercel.com/dashboard
2. **Add New → Project**
3. 选择刚才推上去的 GitHub 仓库 → **Import**
4. **Framework Preset**：Vercel 会自动识别为 Next.js，保持默认
5. **Root Directory**：留空（项目就在根）
6. **Build Command / Output / Install**：都留默认
7. 先不点 Deploy —— 下一步配环境变量

### 1.3 配环境变量（Environment Variables）

在 Import 页面的「Environment Variables」区，按需粘贴。**全部都是可选的**：

| 变量名 | 作用 | 不配会怎样 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude 3.5 Sonnet — 文案生成 | 走确定性模板（功能不坏） |
| `GOOGLE_API_KEY` | Gemini 1.5 Pro — 长文档摄取 | 同上 |
| `OPENAI_API_KEY` | GPT-4o — 多语言本地化 | 同上 |
| `VC_API_TOKEN` | 产品功能「部署到 Vercel」用 | 返回 mock URL（可演示，不真上线） |
| `VC_TEAM_ID` | 部署到指定 Team 而不是个人 | 部署到你的个人 scope |

**拿 Vercel Token（关键）：**

1. Vercel 右上角头像 → **Account Settings**
2. 左侧 **Tokens** → **Create Token**
3. 名字随便，Scope 选 **Full Access**，过期时间自选
4. 生成后立刻复制（只显示一次）
5. 粘贴到上面那个 `VC_API_TOKEN` 字段

**（可选）Team ID：** 如果你想让用户的落地页部署到某个 Team：
- Team Settings → General → 页面最下面的 **Team ID**（`team_xxxxx`）

### 1.4 点击 Deploy

环境变量填好后，**Deploy** 按钮变亮，点它。
约 1-2 分钟后会拿到类似 `https://landingpage-os-xxx.vercel.app` 的地址。

### 1.5 绑自定义域名（可选）

Vercel 项目页面 → **Settings** → **Domains** → **Add**
- 输入你的域名（比如 `lp.yourcompany.com`）
- Vercel 会告诉你要加哪条 DNS 记录（通常是 CNAME 到 `cname.vercel-dns.com`）
- 去你的域名服务商那里加这条 DNS → 一般几分钟生效，SSL 自动配

---

## Part 2 · 启用「部署到 Vercel」产品能力

这一步是让**你的用户**在编辑器里点一下，就把他们的落地页部署到 Vercel。

### 2.1 确认 `VC_API_TOKEN` 已配

在 Vercel 项目的 **Settings → Environment Variables** 里检查：
- `VC_API_TOKEN`：有值 ✅

### 2.2 测试部署流程

1. 访问你的 LandingPage OS（比如 `https://landingpage-os-xxx.vercel.app/zh-CN`）
2. 新建项目 → 填完 4 步向导 → 进入编辑器
3. 右上角点 **「部署到 Vercel ▲」**
4. 成功后会出现一个 **「Vercel 地址 ↗」** 的小标签
5. 点进去就是你用户的落地页，已经托管在 `lp-{slug}-xxx.vercel.app`

### 2.3 部署逻辑说明（出问题时排查用）

调用链：
```
用户点按钮
 → POST /api/projects/:id/deploy
 → renderProjectHtml(project)  # 拼自包含 HTML
 → POST https://api.vercel.com/v13/deployments
       Authorization: Bearer $VC_API_TOKEN
       body: { name: 'lp-<slug>', files: [{file: 'index.html', data: html}] }
 → 回写 project.deploy = { url, deploymentId, status, ... }
 → 编辑器刷新出「Vercel 地址」按钮
```

### 2.4 常见错误

| 症状 | 原因 | 处理 |
|---|---|---|
| 返回 `mock-vercel.app` 地址 | `VC_API_TOKEN` 没配 | 在 Vercel 的环境变量里加上，**Redeploy** 后重试 |
| `401 Unauthorized` | Token 过期或权限不足 | 重新生成 Full Access Token |
| `403 Forbidden` | Token 绑了 Team，但 `VC_TEAM_ID` 没传 | 配上 `VC_TEAM_ID` |
| 按钮转圈不停 | 构建队列积压 | Vercel Dashboard 查 deployment 状态 |
| 部署成功但页面 404 | 静态文件没上传 | 看 Vercel deployment 详情里 Files 是否有 `index.html` |

---

## Part 3 · 改完代码怎么重新部署

**自动**（推荐）：
- Vercel 已和你的 GitHub 仓库联动
- `git push` 到 `main` 分支 → 自动触发新构建
- 每个 PR 也会有独立 Preview URL

**手动：**
- Vercel 项目 → **Deployments** → 找到一条 → **⋯ → Redeploy**

**改环境变量后：**
- 必须 Redeploy 才会生效（环境变量在构建时注入）

---

## Part 4 · 持久化数据怎么办

⚠️ 当前 MVP 用的是**文件系统存储**（`.data/*.json`）。
**Vercel 的 Serverless 文件系统是只读的**，所以直接部署后，创建项目 / 写资产库会报错。

上生产前必须换存储。几个选项，按推荐度排：

### 推荐：Supabase（Postgres + Auth + RLS 一站式）
PRD v5.1 §2 的规划就是这个。步骤：
1. https://supabase.com 新建项目
2. 在 SQL Editor 执行一份迁移 SQL（建 `projects` `leads` `assets` `events` 表 + `user_id` 列 + RLS policy）
3. 把 `src/lib/storage.ts` 的 `fs.readFile` / `fs.writeFile` 换成 `@supabase/supabase-js` 的 `from('projects').select()` / `insert()`
4. 加 `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 两个环境变量

### 快速替代：Vercel KV（Redis）
适合「快先跑起来、数据量不大」：
1. Vercel 项目 → **Storage → Create → KV**
2. 会自动注入 `KV_REST_API_URL` / `KV_REST_API_TOKEN`
3. `storage.ts` 改成 `@vercel/kv` 的 `kv.get()` / `kv.set()`

### 绝对不要
- 把 `.data/` 目录提交到 Git 当数据库（下次部署就盖了）
- 用 `process.cwd()` 写文件（Vercel 只读）

---

## Part 5 · 生产检查清单

部署前最后看一眼：

- [ ] `.gitignore` 有 `.env` `.data` `node_modules` `.next`
- [ ] `VC_API_TOKEN` 有配，且是 Full Access
- [ ] 数据存储从文件切到 Supabase / KV / 其他
- [ ] 至少一个 LLM Key（没有也能跑，但体验是模板的）
- [ ] 自定义域名 DNS 已生效（`dig lp.yourcompany.com` 能拿到 Vercel IP）
- [ ] Vercel 项目 **Settings → Functions** 区域检查默认 Region（建议 `hnd1` 东京 / `sin1` 新加坡 / `sfo1` 旧金山，按主要用户选）

---

## 附：最小可行命令序列

```bash
# 1. 初次部署
cd "/Applications/claude code/LandingPage"
git init && git add . && git commit -m "init"
git remote add origin git@github.com:you/landingpage-os.git
git push -u origin main
# → 打开 vercel.com → Import → 配环境变量 → Deploy

# 2. 后续更新
git add . && git commit -m "改动描述"
git push
# → Vercel 自动部署，约 90 秒

# 3. 回滚
# Vercel Dashboard → Deployments → 找到老版本 → Promote to Production
```

就这些。

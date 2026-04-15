'use client';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  Project,
  PageModule,
  ModuleType,
  ToneKey,
  Lead,
  StyleId,
  NarrativeVariant,
} from '@/lib/types';
import { STYLE_PRESETS } from '@/lib/styles';
import { auditProject } from '@/lib/linter';
import PageRenderer from './PageRenderer';
import ModuleEditor from './ModuleEditor';

type Props = { locale: string; initialProject: Project; initialLeads: Lead[] };

const TONES: ToneKey[] = [
  'professional',
  'executive',
  'sales',
  'friendly',
  'saas',
  'japanese',
];

const ALL_TYPES: ModuleType[] = [
  'hero',
  'socialProof',
  'pain',
  'solution',
  'benefits',
  'useCase',
  'testimonial',
  'faq',
  'cta',
  'form',
];

export default function Editor({ locale, initialProject, initialLeads }: Props) {
  const t = useTranslations();
  const [project, setProject] = useState<Project>(initialProject);
  const [leads] = useState<Lead[]>(initialLeads);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [tab, setTab] = useState<'content' | 'leads' | 'settings'>('content');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(
    project.modules[0]?.id ?? null,
  );
  const [copied, setCopied] = useState(false);

  const selected = useMemo(
    () => project.modules.find((m) => m.id === selectedModuleId) ?? null,
    [project.modules, selectedModuleId],
  );

  const findings = useMemo(() => auditProject(project), [project]);

  useEffect(() => {
    if (status !== 'saving') return;
    const timer = setTimeout(async () => {
      await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modules: project.modules,
          tone: project.tone,
          theme: project.theme,
        }),
      });
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 1200);
    }, 400);
    return () => clearTimeout(timer);
  }, [status, project]);

  const touch = () => setStatus('saving');

  const updateModule = (id: string, patch: Partial<PageModule>) => {
    setProject((p) => ({
      ...p,
      modules: p.modules.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
    touch();
  };

  const move = (id: string, dir: -1 | 1) => {
    setProject((p) => {
      const idx = p.modules.findIndex((m) => m.id === id);
      if (idx < 0) return p;
      const target = idx + dir;
      if (target < 0 || target >= p.modules.length) return p;
      const next = [...p.modules];
      const [m] = next.splice(idx, 1);
      next.splice(target, 0, m);
      return { ...p, modules: next };
    });
    touch();
  };

  const remove = (id: string) => {
    const mod = project.modules.find((m) => m.id === id);
    if (!mod) return;
    const role = t(`editor.moduleRoles.${mod.type}`);
    if (!confirm(t('editor.deleteConfirm', { role }))) return;
    setProject((p) => ({ ...p, modules: p.modules.filter((m) => m.id !== id) }));
    if (selectedModuleId === id) setSelectedModuleId(null);
    touch();
  };

  const addModule = async (type: ModuleType) => {
    const seed = await fetch('/api/seed-module', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: project.inputs, tone: project.tone, type }),
    });
    const data = await seed.json();
    if (data?.module) {
      setProject((p) => ({ ...p, modules: [...p.modules, data.module] }));
      setSelectedModuleId(data.module.id);
      touch();
    }
  };

  const regenerate = async (id: string) => {
    const res = await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ regenerateModuleId: id, newTone: project.tone }),
    });
    const data = await res.json();
    if (data?.project) setProject(data.project);
  };

  const changeTone = async (tone: ToneKey) => {
    setProject((p) => ({ ...p, tone }));
    touch();
  };

  const switchVariant = async (variant: NarrativeVariant) => {
    const res = await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ switchVariant: variant }),
    });
    const data = await res.json();
    if (data?.project) {
      setProject(data.project);
      setSelectedModuleId(data.project.modules[0]?.id ?? null);
    }
  };

  const changeStyle = async (styleId: StyleId) => {
    setProject((p) => ({ ...p, theme: { ...p.theme, styleId } }));
    await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newStyleId: styleId }),
    });
  };

  const togglePublish = async () => {
    const next = !project.published;
    setProject((p) => ({ ...p, published: next }));
    await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ published: next }),
    });
  };

  const [deploying, setDeploying] = useState(false);
  const deployToVercel = async () => {
    setDeploying(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/deploy`, { method: 'POST' });
      const data = await res.json();
      if (data?.project) setProject(data.project);
      if (data?.deploy?.status === 'error') {
        alert('Vercel 部署失败：' + (data.deploy.errorMessage ?? 'unknown'));
      }
    } finally {
      setDeploying(false);
    }
  };

  const publicUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/p/${project.slug}`
      : `/p/${project.slug}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  const unusedTypes = ALL_TYPES.filter((t) => !project.modules.some((m) => m.type === t));

  return (
    <div className="grid min-h-[calc(100vh-56px)] grid-cols-12 gap-0">
      {/* Left rail */}
      <aside className="col-span-12 border-r border-ink-100 bg-white p-4 md:col-span-3 lg:col-span-3">
        <div className="flex items-center gap-1 rounded-xl border border-ink-100 p-1 text-sm">
          <button
            className={`flex-1 rounded-lg px-2 py-1.5 ${tab === 'content' ? 'bg-brand-600 text-white' : 'text-ink-700'}`}
            onClick={() => setTab('content')}
          >
            {t('editor.contentTab')}
          </button>
          <button
            className={`flex-1 rounded-lg px-2 py-1.5 ${tab === 'leads' ? 'bg-brand-600 text-white' : 'text-ink-700'}`}
            onClick={() => setTab('leads')}
          >
            {t('editor.leadsTab')}
          </button>
          <button
            className={`flex-1 rounded-lg px-2 py-1.5 ${tab === 'settings' ? 'bg-brand-600 text-white' : 'text-ink-700'}`}
            onClick={() => setTab('settings')}
          >
            {t('editor.settingsTab')}
          </button>
        </div>

        {tab === 'content' && (
          <div className="mt-4">
            <div className="label mb-1.5">{t('editor.modules')}</div>
            <ul className="space-y-1">
              {project.modules.map((m, i) => (
                <li
                  key={m.id}
                  className={`group flex items-center gap-2 rounded-xl border p-2 text-sm ${
                    selectedModuleId === m.id
                      ? 'border-brand-300 bg-brand-50'
                      : 'border-ink-100 hover:bg-ink-100/40'
                  }`}
                >
                  <button
                    className="flex-1 text-left"
                    onClick={() => setSelectedModuleId(m.id)}
                  >
                    <span className="mr-1.5 inline-block h-5 w-5 rounded-md bg-brand-100 text-center text-[11px] leading-5 text-brand-700">
                      {i + 1}
                    </span>
                    {t(`editor.moduleTypes.${m.type}`)}
                  </button>
                  <button
                    title={t('editor.moveUp')}
                    onClick={() => move(m.id, -1)}
                    className="opacity-0 group-hover:opacity-100 text-ink-500 hover:text-ink-900"
                  >
                    ↑
                  </button>
                  <button
                    title={t('editor.moveDown')}
                    onClick={() => move(m.id, 1)}
                    className="opacity-0 group-hover:opacity-100 text-ink-500 hover:text-ink-900"
                  >
                    ↓
                  </button>
                  <button
                    title={t('editor.deleteModule')}
                    onClick={() => remove(m.id)}
                    className="opacity-0 group-hover:opacity-100 text-ink-500 hover:text-red-600"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>

            {unusedTypes.length > 0 && (
              <div className="mt-4">
                <div className="label mb-1.5">{t('editor.addModule')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {unusedTypes.map((type) => (
                    <button
                      key={type}
                      onClick={() => addModule(type)}
                      className="pill hover:bg-brand-50 hover:border-brand-200 hover:text-brand-700"
                    >
                      + {t(`editor.moduleTypes.${type}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {findings.length > 0 && (
              <div className="mt-5">
                <div className="label mb-1.5">视觉红线 · {findings.length} 条</div>
                <ul className="space-y-1.5">
                  {findings.map((f, i) => (
                    <li
                      key={i}
                      className={`rounded-xl border p-2.5 text-[11px] leading-relaxed ${
                        f.severity === 'error'
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : f.severity === 'warn'
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-ink-100 bg-ink-100/40 text-ink-700'
                      }`}
                    >
                      <span className="mr-1 font-mono">{f.rule}</span>
                      <span>{f.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === 'leads' && (
          <div className="mt-4">
            <div className="label mb-1.5">{t('leads.title')}</div>
            {leads.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-100 p-4 text-xs text-ink-500">
                {t('leads.empty')}
              </div>
            ) : (
              <ul className="space-y-2">
                {leads.map((l) => (
                  <li key={l.id} className="rounded-xl border border-ink-100 p-3 text-xs">
                    <div className="font-medium">{l.name || '—'}</div>
                    <div className="text-ink-500">{l.email || '—'}</div>
                    {l.company && <div className="text-ink-500">{l.company}</div>}
                    {l.message && (
                      <div className="mt-1 text-ink-700">“{l.message}”</div>
                    )}
                    <div className="mt-1 text-[11px] text-ink-300">
                      {new Date(l.createdAt).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'settings' && (
          <div className="mt-4 space-y-4">
            <div>
              <div className="label mb-1.5">风格</div>
              <div className="grid grid-cols-1 gap-1.5">
                {Object.values(STYLE_PRESETS).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => changeStyle(s.id)}
                    className={`rounded-xl border p-2.5 text-left text-xs ${
                      project.theme.styleId === s.id
                        ? 'border-brand-300 bg-brand-50'
                        : 'border-ink-100 hover:bg-ink-100/40'
                    }`}
                  >
                    <div className="text-sm font-medium">{s.name}</div>
                    <div className="mt-0.5 text-[11px] text-ink-500">{s.mood}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="label mb-1.5">{t('editor.tone')}</div>
              <select
                className="input"
                value={project.tone}
                onChange={(e) => changeTone(e.target.value as ToneKey)}
              >
                {TONES.map((tn) => (
                  <option key={tn} value={tn}>
                    {t(`editor.tones.${tn}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="label mb-1.5">主色</div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={project.theme.primary}
                  onChange={(e) => {
                    setProject((p) => ({
                      ...p,
                      theme: { ...p.theme, primary: e.target.value },
                    }));
                    touch();
                  }}
                  className="h-10 w-12 rounded-lg border border-ink-100"
                />
                <input
                  className="input"
                  value={project.theme.primary}
                  onChange={(e) => {
                    setProject((p) => ({
                      ...p,
                      theme: { ...p.theme, primary: e.target.value },
                    }));
                    touch();
                  }}
                />
              </div>
            </div>
            <div>
              <div className="label mb-1.5">发布模式</div>
              <div className="flex gap-1 rounded-xl border border-ink-100 p-1 text-xs">
                <button
                  className={`flex-1 rounded-lg px-2 py-1.5 ${project.publishMode === 'single' ? 'bg-brand-600 text-white' : ''}`}
                  onClick={async () => {
                    setProject((p) => ({ ...p, publishMode: 'single' }));
                    await fetch(`/api/projects/${project.id}`, {
                      method: 'PATCH',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ publishMode: 'single' }),
                    });
                  }}
                >
                  单方案
                </button>
                <button
                  className={`flex-1 rounded-lg px-2 py-1.5 ${project.publishMode === 'ab-split' ? 'bg-brand-600 text-white' : ''}`}
                  onClick={async () => {
                    setProject((p) => ({ ...p, publishMode: 'ab-split' }));
                    await fetch(`/api/projects/${project.id}`, {
                      method: 'PATCH',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ publishMode: 'ab-split' }),
                    });
                  }}
                >
                  A/B 分流
                </button>
              </div>
              {project.publishMode === 'ab-split' && (
                <div className="mt-2 text-xs text-ink-500">
                  访客按 cookie 粘性分流到 A / B，看板自动推荐胜出方案。
                </div>
              )}
            </div>
            <div className="rounded-xl border border-ink-100 p-3 text-xs text-ink-500">
              <div className="font-medium text-ink-700">AI {t('editor.strategyPanel')}</div>
              <ul className="mt-2 space-y-1.5">
                {project.strategy.goal.slice(0, 3).map((g, i) => (
                  <li key={i}>• {g}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-ink-100 p-3 text-xs text-ink-500">
              <div className="font-medium text-ink-700">LLM 路由（PRD §4.1）</div>
              <ul className="mt-2 space-y-0.5">
                <li>• Gemini 1.5 Pro — 长文档摄取</li>
                <li>• Claude 3.5 Sonnet — 结构化文案</li>
                <li>• GPT-4o — 多语言语境转换</li>
              </ul>
            </div>
          </div>
        )}
      </aside>

      {/* Middle: preview */}
      <section className="col-span-12 bg-ink-100/30 p-4 md:col-span-6 lg:col-span-6">
        <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-ink-100 bg-white p-1 text-xs">
              <button
                className={`rounded-lg px-2.5 py-1.5 ${device === 'desktop' ? 'bg-brand-600 text-white' : ''}`}
                onClick={() => setDevice('desktop')}
              >
                ▢ {t('editor.desktop')}
              </button>
              <button
                className={`rounded-lg px-2.5 py-1.5 ${device === 'mobile' ? 'bg-brand-600 text-white' : ''}`}
                onClick={() => setDevice('mobile')}
              >
                ▯ {t('editor.mobile')}
              </button>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-ink-100 bg-white p-1 text-xs">
              <button
                title="方案 A — 痛点驱动 (Pain-Agitate-Solve)"
                className={`rounded-lg px-2.5 py-1.5 ${project.activeVariant === 'A' ? 'bg-ink-900 text-white' : ''}`}
                onClick={() => switchVariant('A')}
              >
                方案 A · 痛点
              </button>
              <button
                title="方案 B — 收益驱动 (Benefit-Focused)"
                className={`rounded-lg px-2.5 py-1.5 ${project.activeVariant === 'B' ? 'bg-ink-900 text-white' : ''}`}
                onClick={() => switchVariant('B')}
              >
                方案 B · 收益
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-500">
              {status === 'saving'
                ? t('editor.saving')
                : status === 'saved'
                  ? t('editor.saved')
                  : ''}
            </span>
            <a
              className="btn btn-secondary px-3 py-1.5 text-xs"
              href={`/api/projects/${project.id}/export`}
              download={`${project.slug}.html`}
            >
              导出 HTML
            </a>
            <button
              className="btn btn-secondary px-3 py-1.5 text-xs"
              onClick={deployToVercel}
              disabled={deploying}
              title="将当前页面部署到 Vercel（平台托管 token）"
            >
              {deploying ? '部署中…' : project.deploy?.url ? '重新部署 ▲' : '部署到 Vercel ▲'}
            </button>
            {project.deploy?.url && (
              <a
                className="pill border-brand-200 bg-brand-50 text-brand-700 text-[11px]"
                href={project.deploy.url}
                target="_blank"
                rel="noreferrer"
              >
                {project.deploy.provider === 'mock' ? '预览地址' : 'Vercel 地址'} ↗
              </a>
            )}
            {project.published && (
              <>
                <button className="btn btn-secondary px-3 py-1.5 text-xs" onClick={copyLink}>
                  {copied ? t('editor.copied') : t('editor.copyLink')}
                </button>
                <a
                  className="btn btn-secondary px-3 py-1.5 text-xs"
                  href={`/p/${project.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('editor.viewLive')} ↗
                </a>
              </>
            )}
            <button
              className={`btn px-3 py-1.5 text-xs ${project.published ? 'btn-secondary' : 'btn-primary'}`}
              onClick={togglePublish}
            >
              {project.published ? t('editor.published') + ' ✓' : t('editor.publish')}
            </button>
          </div>
        </div>

        <div className="mx-auto overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-soft">
          <div
            className="mx-auto overflow-y-auto"
            style={{
              width: device === 'mobile' ? 390 : '100%',
              maxHeight: '80vh',
              transition: 'width 200ms',
            }}
          >
            <PageRenderer
              project={project}
              device={device}
              onSelectModule={(id) => setSelectedModuleId(id)}
              selectedId={selectedModuleId}
            />
          </div>
        </div>
      </section>

      {/* Right: module editor */}
      <aside className="col-span-12 border-l border-ink-100 bg-white p-4 md:col-span-3 lg:col-span-3">
        {selected ? (
          <ModuleEditor
            module={selected}
            onChange={(patch) => updateModule(selected.id, patch)}
            onRegenerate={() => regenerate(selected.id)}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-ink-100 p-6 text-center text-sm text-ink-500">
            ← Select a module to edit
          </div>
        )}
      </aside>
    </div>
  );
}

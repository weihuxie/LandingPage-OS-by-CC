'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  Project,
  PageModule,
  ModuleType,
  ToneKey,
  Lead,
  StyleId,
  NarrativeVariant,
  LandingPage,
  PageLocale,
} from '@/lib/types';
import { STYLE_PRESETS } from '@/lib/styles';
import { auditProject } from '@/lib/linter';
import { nativeLabel, PAGE_LOCALES } from '@/lib/i18n-detect';
import PageRenderer from './PageRenderer';
import ModuleEditor from './ModuleEditor';
import LocalizationPreviewModal from './LocalizationPreviewModal';
import type { LocalizationStrategy } from '@/lib/types';

type Props = {
  locale: string;
  initialProject: Project;
  initialLeads: Lead[];
  initialPage?: LandingPage; // v2 LandingPage for locale tab support
};

const TONES: ToneKey[] = [
  'professional',
  'executive',
  'sales',
  'friendly',
  'saas',
  'japanese',
  'enterprise-b2b',
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

export default function Editor({ locale, initialProject, initialLeads, initialPage }: Props) {
  const t = useTranslations();
  const [project, setProject] = useState<Project>(initialProject);
  const [page, setPage] = useState<LandingPage | undefined>(initialPage);
  const [editingLocale, setEditingLocale] = useState<PageLocale>(
    (initialPage?.defaultLocale ?? initialProject.inputs.locale) as PageLocale,
  );
  const [leads] = useState<Lead[]>(initialLeads);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [tab, setTab] = useState<'content' | 'leads' | 'settings'>('content');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(
    project.modules[0]?.id ?? null,
  );
  const [copied, setCopied] = useState(false);
  const [addingLocale, setAddingLocale] = useState(false);
  const [pendingLocale, setPendingLocale] = useState<PageLocale | null>(null);

  const selected = useMemo(
    () => project.modules.find((m) => m.id === selectedModuleId) ?? null,
    [project.modules, selectedModuleId],
  );

  const findings = useMemo(() => auditProject(project), [project]);

  // Track the CURRENT editing locale in a ref so async callbacks (regenerate
  // especially, which takes 5-15s for Claude) can check whether the user
  // navigated away mid-call. Without this guard, a regenerate on the 日本語
  // tab that resolves after the user has switched to 繁中 would overwrite
  // the 繁中 display with Japanese content — the "串显示" bug.
  const editingLocaleRef = useRef<PageLocale>(editingLocale);
  useEffect(() => {
    editingLocaleRef.current = editingLocale;
  }, [editingLocale]);

  // Mirror project.modules → page.variants[activeVariant][editingLocale]
  // whenever project.modules changes. Without this mirror, the `page` state
  // we hold in React only ever reflects what was loaded at mount time (or
  // returned by addLocale/regenerate). Edits live in project.modules and
  // are synced to the server via the debounced autosave — but our LOCAL
  // page cache goes stale. switchLocaleTab reads page.variants[v][target]
  // to paint the tab, so switching away from zh-CN (after edits) and back
  // made user edits "vanish": they were on the server, but the UI was
  // reading the stale local page state.
  useEffect(() => {
    setPage((prev) => {
      if (!prev) return prev;
      const v = project.activeVariant ?? 'A';
      const current = prev.variants[v]?.[editingLocale];
      // Identity guard — when switchLocaleTab just loaded modules FROM page
      // into project, the two references are equal and we skip the write to
      // avoid a pointless re-render loop with the autosave effect (which
      // has `page` in its deps).
      if (current === project.modules) return prev;
      return {
        ...prev,
        variants: {
          ...prev.variants,
          [v]: { ...prev.variants[v], [editingLocale]: project.modules },
        },
      };
    });
  }, [project.modules, project.activeVariant, editingLocale]);

  // Snapshot refs so the unmount / beforeunload flushers can read the
  // latest values synchronously without re-registering every render.
  const saveSnapRef = useRef({ project, page, editingLocale, status });
  useEffect(() => {
    saveSnapRef.current = { project, page, editingLocale, status };
  });

  useEffect(() => {
    if (status !== 'saving') return;
    const timer = setTimeout(async () => {
      // If v2 page available, save modules to exact (variant, locale) cell
      if (page) {
        await fetch(`/api/pages/${page.id}/modules`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            variant: project.activeVariant ?? 'A',
            locale: editingLocale,
            modules: project.modules,
          }),
          // keepalive lets this request complete even if the user navigates
          // away mid-flight — otherwise the browser aborts and the edit is
          // silently lost.
          keepalive: true,
        });
        // Mirror tone/theme on page too
        await fetch(`/api/pages/${page.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tone: project.tone, theme: project.theme }),
          keepalive: true,
        });
      } else {
        // Fallback to legacy compat (shouldn't happen post-migration)
        await fetch(`/api/projects/${project.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            modules: project.modules,
            tone: project.tone,
            theme: project.theme,
          }),
          keepalive: true,
        });
      }
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 1200);
    }, 400);
    return () => clearTimeout(timer);
  }, [status, project, page, editingLocale]);

  // Flush any pending 400ms-debounced save the moment the user leaves.
  // Three exit paths must be covered:
  //   1. Soft nav (Next.js router.push / <Link>) — fires unmount only
  //   2. Hard nav (tab close, refresh, back button to non-Next page) —
  //      fires beforeunload / pagehide, NOT unmount
  //   3. iOS Safari swipe-back — fires pagehide (beforeunload is unreliable)
  // Without this, edits made in the last 400ms before leaving are silently
  // dropped: the setTimeout gets clearTimeout'd by the useEffect cleanup
  // before ever calling fetch.
  useEffect(() => {
    const flush = () => {
      const snap = saveSnapRef.current;
      if (snap.status !== 'saving' || !snap.page) return;
      // Fire-and-forget with keepalive so the browser completes the POST
      // even after the page unloads. keepalive body is capped at ~64KB by
      // the spec, which is plenty for a module array.
      fetch(`/api/pages/${snap.page.id}/modules`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          variant: snap.project.activeVariant ?? 'A',
          locale: snap.editingLocale,
          modules: snap.project.modules,
        }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      // This cleanup fires both on unmount (soft nav, covers case 1) and
      // when the effect re-runs. Since deps are [], it only runs on unmount.
      flush();
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Capture the locale at REQUEST time. If the user switches tabs during
    // the 5-15s Claude call, we must NOT paint these modules into their
    // current view — that's the "串显示" bug (日本語 tab suddenly showing
    // 繁中 content because regenerate was fired from 繁中 earlier).
    const requestLocale = editingLocale;
    const res = await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        regenerateModuleId: id,
        newTone: project.tone,
        locale: requestLocale,
      }),
    });
    const data = await res.json();
    if (!data?.project) return;

    // Always refresh our local page cache — the regenerated locale's
    // content on the server is newer than what we had.
    if (data.page) setPage(data.page);

    // Only paint the new modules into the editor when the user is STILL
    // on the tab that triggered the regenerate. editingLocaleRef reads the
    // live value, not the stale closure from when this function was called.
    if (editingLocaleRef.current !== requestLocale) return;

    if (data.page) {
      const v = project.activeVariant ?? 'A';
      const localeMods = data.page.variants?.[v]?.[requestLocale] ?? [];
      // Keep selectedModuleId valid — regenerateModule preserves module.id
      // via {...module} spread, so the previously-selected module still
      // exists in the new array and the right editor panel stays open.
      setProject({ ...data.project, modules: localeMods });
    } else {
      setProject(data.project);
    }
  };

  const changeTone = async (tone: ToneKey) => {
    setProject((p) => ({ ...p, tone }));
    touch();
  };

  const switchVariant = async (variant: NarrativeVariant) => {
    // Server: record activeVariant on LandingPage
    if (page) {
      await fetch(`/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ switchVariant: variant }),
      });
      const nextModules = page.variants[variant][editingLocale] ?? [];
      setProject((p) => ({ ...p, activeVariant: variant, modules: nextModules }));
      setSelectedModuleId(nextModules[0]?.id ?? null);
    } else {
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

  // Switch the locale tab: load modules for (activeVariant, targetLocale)
  // from the local `page` state. Before switching, we eagerly flush any
  // pending autosave for the CURRENT tab — otherwise React's useEffect
  // cleanup would cancel the 400ms debounced save when editingLocale
  // changes, and the re-fired effect would save the NEW tab's modules
  // to the NEW tab's slot. Result: the old tab's pending edits were
  // silently dropped on the floor (not persisted to the server).
  //
  // The page-mirror effect above keeps edits visible in the UI when
  // switching back, but a browser refresh would lose them without the
  // eager flush here.
  const switchLocaleTab = async (targetLocale: PageLocale) => {
    if (!page) return;
    if (!page.availableLocales.includes(targetLocale)) return;
    if (targetLocale === editingLocale) return;

    const v = project.activeVariant ?? 'A';

    if (status === 'saving') {
      try {
        await fetch(`/api/pages/${page.id}/modules`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            variant: v,
            locale: editingLocale,
            modules: project.modules,
          }),
        });
        setStatus('saved');
      } catch {
        // Non-fatal. The mirror effect above has already cached the
        // edits in local page state, so the user's UI will still show
        // them on the next tab switch back. Server will catch up via
        // the next autosave trigger.
      }
    }

    const nextModules = page.variants[v][targetLocale] ?? [];
    setEditingLocale(targetLocale);
    setProject((p) => ({
      ...p,
      modules: nextModules,
      inputs: { ...p.inputs, locale: targetLocale as any },
    }));
    setSelectedModuleId(nextModules[0]?.id ?? null);
  };

  // Delete a locale tab. Server already has DELETE /api/pages/[id]/locales;
  // we just didn't expose any UI trigger — users could add locales but
  // never remove them. The backend refuses to drop the defaultLocale
  // while other locales exist (you'd need to promote another first), so
  // we hide the X on the default tab.
  const deleteLocale = async (localeToDelete: PageLocale) => {
    if (!page) return;
    const label = nativeLabel(localeToDelete);
    if (
      !confirm(
        `确定删除 ${label} 版本？该语言的所有模块编辑将丢失（不影响其他语言）。`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/pages/${page.id}/locales`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: localeToDelete }),
      });
      const data = await res.json();
      if (data?.page) {
        setPage(data.page);
        // If the user was viewing the tab we just deleted, fall back to
        // the page's default locale so they aren't staring at a ghost tab.
        if (editingLocale === localeToDelete) {
          const fallback = data.page.defaultLocale as PageLocale;
          const v = project.activeVariant ?? 'A';
          const nextModules = data.page.variants[v][fallback] ?? [];
          setEditingLocale(fallback);
          setProject((p) => ({
            ...p,
            modules: nextModules,
            inputs: { ...p.inputs, locale: fallback as any },
          }));
          setSelectedModuleId(nextModules[0]?.id ?? null);
        }
      } else if (data?.error) {
        alert(`删除失败：${data.error}`);
      }
    } catch (e: any) {
      alert(`删除失败：${e?.message ?? e}`);
    }
  };

  // '+ 加语言' now opens a white-box modal so the user sees/edits/approves
  // the localization strategy before generation happens (Phase H).
  const addLocale = (newLocale: PageLocale) => {
    if (!page) return;
    setPendingLocale(newLocale);
  };

  // Called after the user approves the localization strategy in the modal.
  const confirmAddLocale = async (strategy: LocalizationStrategy) => {
    if (!page || !pendingLocale) return;
    const newLocale = pendingLocale;
    setAddingLocale(true);
    try {
      const res = await fetch(`/api/pages/${page.id}/locales`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: newLocale, strategy }),
      });
      const data = await res.json();
      if (data?.page) {
        setPage(data.page);
        switchLocaleTabInternal(data.page, newLocale);

        // Compute media assets that haven't been localized to the new locale.
        // Gives the user a heads-up to go fill in language-specific screenshots
        // (per Q4 design: text is auto-localized; media needs a human pass).
        const gaps = findMediaLocaleGaps(data.page, newLocale);
        if (gaps.length > 0) {
          alert(
            `已添加 ${nativeLabel(newLocale)}。有 ${gaps.length} 个资产没有这个语言的版本——切到这个 tab 后，有配图/视频的模块会自动回落到默认版本。\n\n待补语言版本：\n${gaps.slice(0, 5).join('\n')}${gaps.length > 5 ? `\n...还有 ${gaps.length - 5} 个` : ''}`,
          );
        }
      }
    } finally {
      setAddingLocale(false);
      setPendingLocale(null);
    }
  };

  // Walk through all modules of both variants and report media refs that
  // are missing an override for the newly-added locale.
  const findMediaLocaleGaps = (
    page: LandingPage,
    newLocale: PageLocale,
  ): string[] => {
    const out: string[] = [];
    const check = (m: any, path: string) => {
      if (!m) return;
      if (m.url && !m.localizedUrls?.[newLocale]) {
        out.push(`${path}: ${m.label ?? m.alt ?? m.kind ?? 'media'}`);
      }
    };
    for (const v of ['A', 'B'] as const) {
      const mods = page.variants[v]?.[newLocale] ?? [];
      for (const mod of mods) {
        const c = mod.content as any;
        if (mod.type === 'hero' && c.media) check(c.media, `方案${v} · Hero`);
        if (mod.type === 'videoEmbed' && c.media) check(c.media, `方案${v} · 视频`);
        if (mod.type === 'productShowcase' && Array.isArray(c.items)) {
          c.items.forEach((it: any, i: number) => {
            if (it.media) check(it.media, `方案${v} · 功能${i + 1}`);
          });
        }
      }
    }
    return out;
  };

  // Helper used by addLocale — takes fresh page directly (avoid stale state)
  const switchLocaleTabInternal = (freshPage: LandingPage, targetLocale: PageLocale) => {
    const v = project.activeVariant ?? 'A';
    const nextModules = freshPage.variants[v][targetLocale] ?? [];
    setEditingLocale(targetLocale);
    setProject((p) => ({
      ...p,
      modules: nextModules,
      inputs: { ...p.inputs, locale: targetLocale as any },
    }));
    setSelectedModuleId(nextModules[0]?.id ?? null);
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
        {/* Locale tabs (Phase D) */}
        {page && (
          <div className="mb-2 flex items-center gap-1 flex-wrap">
            {page.availableLocales.map((l) => {
              const isActive = editingLocale === l;
              const isDefault = l === page.defaultLocale;
              // The backend refuses to delete defaultLocale while other
              // locales exist, and a single-locale page can't have its
              // only tab removed — so hide the X in those cases.
              const canDelete = !isDefault && page.availableLocales.length > 1;
              return (
                <div key={l} className="inline-flex items-stretch">
                  <button
                    onClick={() => switchLocaleTab(l)}
                    className={`border-b-2 px-3 py-1.5 text-xs transition ${
                      isActive
                        ? 'border-brand-600 bg-white font-medium text-ink-900'
                        : 'border-transparent text-ink-500 hover:text-ink-900'
                    } ${canDelete && isActive ? 'rounded-tl-lg pr-1.5' : 'rounded-t-lg'}`}
                  >
                    {nativeLabel(l)}
                    {isDefault && <span className="ml-1 text-brand-600">★</span>}
                  </button>
                  {canDelete && isActive && (
                    <button
                      onClick={() => deleteLocale(l)}
                      title={`删除 ${nativeLabel(l)} 版本`}
                      aria-label={`删除 ${nativeLabel(l)}`}
                      className="rounded-tr-lg border-b-2 border-brand-600 bg-white pl-1 pr-2 py-1.5 text-xs text-ink-400 hover:text-red-600"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            {/* Add-locale button: only shows locales not yet generated */}
            {PAGE_LOCALES.filter((l) => !page.availableLocales.includes(l)).length > 0 && (
              <div className="relative">
                <details className="group">
                  <summary className="cursor-pointer rounded-t-lg border-b-2 border-transparent px-3 py-1.5 text-xs text-brand-700 hover:bg-brand-50 list-none">
                    {addingLocale ? '生成中…' : '+ 加语言'}
                  </summary>
                  <div className="absolute left-0 top-full z-10 mt-1 w-36 rounded-xl border border-ink-100 bg-white shadow-soft">
                    {PAGE_LOCALES.filter((l) => !page.availableLocales.includes(l)).map((l) => (
                      <button
                        key={l}
                        disabled={addingLocale}
                        onClick={(e) => {
                          (e.currentTarget.closest('details') as HTMLDetailsElement).open = false;
                          addLocale(l);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-ink-100/50"
                      >
                        {nativeLabel(l)}
                      </button>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
        )}

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

      {pendingLocale && page && (
        <LocalizationPreviewModal
          pageId={page.id}
          targetLocale={pendingLocale}
          /* Don't default to page.targetMarket — adding a new locale almost
             always implies a new market (zh-CN → CN, ja → JP, etc). Modal
             shows a market picker if user wants to override. */
          onApprove={confirmAddLocale}
          onClose={() => setPendingLocale(null)}
        />
      )}
    </div>
  );
}

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
import { presetsForLocale, FONT_PRESET_INDEX } from '@/lib/font-presets';
import { auditProject } from '@/lib/linter';
import { nativeLabel, PAGE_LOCALES } from '@/lib/i18n-detect';
import PageRenderer from './PageRenderer';
import ModuleEditor from './ModuleEditor';
import LocalizationPreviewModal from './LocalizationPreviewModal';
import type { LocalizationStrategy } from '@/lib/types';

// -----------------------------------------------------------------------
// Notice (error / warning banner)
//
// After the Phase A-F fig-leaf cleanup, routes return structured errors:
//   503 { code: 'LLM_REQUIRED', missing: 'ANTHROPIC_API_KEY', ... }
//   503 { code: 'DEPLOY_REQUIRED', missing: 'VC_API_TOKEN', ... }
//   502 { code: 'LLM_CALL_FAILED', provider: 'claude', ... }
//   409 { code: 'HERO_IS_TEMPLATE', ... }
//
// The editor needs to SHOW these to the user — not alert() (which is
// ignored), not console (which is invisible), and definitely not a
// silent no-op (which was the old behavior and the source of "clicked
// regenerate, nothing changed, no idea why"). The banner lives above
// the main grid and stays until the user dismisses it, so a regen that
// fails because ANTHROPIC_API_KEY isn't set produces a visible prompt
// instead of a ghost click.
// -----------------------------------------------------------------------

type NoticeKind = 'error' | 'warning' | 'info';
type NoticeState = {
  kind: NoticeKind;
  title: string;
  message: string;
  code?: string;
  missing?: string;
};

const NOTICE_TITLES: Record<string, string> = {
  LLM_REQUIRED: '需要配置 LLM API Key',
  LLM_CALL_FAILED: 'LLM 调用失败',
  DEPLOY_REQUIRED: '需要配置部署凭据',
  DEPLOY_FAILED: 'Vercel 部署失败',
  STORAGE_REQUIRED: '存储后端未配置',
  HERO_IS_TEMPLATE: '主视觉文案仍是模板',
  EXTRACTION_FAILED: '内容提取失败',
  INTERNAL: '服务器内部错误',
};

async function readStructuredError(res: Response): Promise<NoticeState> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  const code: string = body?.code ?? `HTTP_${res.status}`;
  const title = NOTICE_TITLES[code] ?? `错误 (${code})`;
  const missing = body?.missing as string | undefined;
  let message: string = body?.message ?? body?.reason ?? `HTTP ${res.status}`;
  if (code === 'LLM_REQUIRED' && missing) {
    message = `${body?.feature ?? '该操作'} 需要 ${missing}；请在 Vercel / 本地 env 中配置后重试。`;
  } else if (code === 'DEPLOY_REQUIRED' && missing) {
    message = `部署需要 ${missing}；请在 Vercel 后台配置 VC_API_TOKEN（以及可选的 VC_TEAM_ID）后重试。`;
  } else if (code === 'STORAGE_REQUIRED') {
    message = '生产环境需要 KV（KV_REST_API_URL + KV_REST_API_TOKEN）。当前无可写存储，任何改动不会被持久化。';
  }
  return {
    kind: 'error',
    title,
    message,
    code,
    missing,
  };
}

type NoticeAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** When true, button shows a loading label + is implicitly disabled. */
  running?: boolean;
  /** Tooltip when disabled — e.g. "需要 ANTHROPIC_API_KEY". */
  disabledReason?: string;
};

function NoticeBanner({
  notice,
  onDismiss,
  action,
}: {
  notice: NoticeState;
  onDismiss: () => void;
  action?: NoticeAction;
}) {
  const bgByKind: Record<NoticeKind, string> = {
    error: 'border-red-200 bg-red-50 text-red-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
  };

  // Auto-dismiss policy:
  //   info    → 6s (confirmations / "已添加" / media-gap heads-up)
  //   warning → 12s (hydrationFailed on-mount — important but not urgent)
  //   error   → NEVER (user must read + fix + dismiss; auto-dismiss would
  //             let a failed regen silently disappear, which is the fig
  //             leaf we just spent 10 phases ripping out).
  //
  // Exception: when `action` is present and actively running, do NOT
  // auto-dismiss — user is waiting on the action to finish; ripping the
  // banner away mid-run would be disorienting.
  useEffect(() => {
    if (notice.kind === 'error') return;
    if (action?.running) return;
    const ms = notice.kind === 'info' ? 6000 : 12000;
    const id = setTimeout(onDismiss, ms);
    return () => clearTimeout(id);
  }, [notice, onDismiss, action?.running]);

  const [copied, setCopied] = useState(false);
  // Copy a compact diagnostic blob so the user can paste it into a bug
  // report without retyping the code / missing fields. Includes the
  // message verbatim since it often has the actionable bit (which env
  // var, which provider, which feature).
  const copyDiag = async () => {
    const lines = [
      `code: ${notice.code ?? '(none)'}`,
      notice.missing ? `missing: ${notice.missing}` : null,
      `title: ${notice.title}`,
      `message: ${notice.message}`,
      `ts: ${new Date().toISOString()}`,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (iframe / insecure context) — leave silent
    }
  };

  return (
    <div
      role="alert"
      className={`border-b ${bgByKind[notice.kind]} px-4 py-2.5`}
    >
      <div className="mx-auto flex max-w-screen-2xl items-start justify-between gap-4">
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">{notice.title}</div>
          <div className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed opacity-90">
            {notice.message}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {action && (
              <button
                className="rounded-md border border-current bg-white/70 px-2.5 py-1 text-xs font-medium hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={action.disabled || action.running}
                onClick={action.onClick}
                title={action.disabled ? action.disabledReason : undefined}
              >
                {action.running ? '运行中…' : action.label}
              </button>
            )}
            {notice.code && (
              <div className="flex items-center gap-2 font-mono text-[10px] opacity-70">
                <span>
                  code: {notice.code}
                  {notice.missing ? ` · missing: ${notice.missing}` : ''}
                </span>
                <button
                  className="rounded border border-current px-1.5 py-[1px] opacity-80 hover:opacity-100"
                  onClick={copyDiag}
                  title="复制诊断信息到剪贴板（用于提 issue / 粘给运维）"
                >
                  {copied ? '已复制 ✓' : '复制诊断'}
                </button>
              </div>
            )}
          </div>
        </div>
        <button
          aria-label="dismiss"
          onClick={onDismiss}
          className="shrink-0 rounded-md px-2 py-0.5 text-sm opacity-60 hover:opacity-100"
          disabled={action?.running}
          title={action?.running ? '等待操作完成后才能关闭' : undefined}
        >
          ×
        </button>
      </div>
    </div>
  );
}

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
  // Settings modal — replaces the old 3-tab (内容 / 线索 / 设置) left rail.
  // See the UX review for why tabs-as-modals was a fig leaf of its own:
  // three mental modes (editing / data / config) stuffed into one sidebar
  // made the right-pane "selected module editor" ambiguous every time the
  // user switched tabs. Now the left rail is purely "what you're editing"
  // (modules + findings) and Settings lives behind a ⚙ that opens a modal.
  // Leads moved to Dashboard (which is the canonical analytics surface);
  // we keep a shortcut in the ⋮ overflow menu.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Save state machine. 5-state instead of 3 so the UI can distinguish:
  //   idle   = no pending changes and no last-save timestamp to show yet
  //   dirty  = user just edited, debounce timer is ticking
  //   saving = network call in flight
  //   saved  = latest save succeeded (briefly shown, decays to `idle` with
  //            lastSavedAt kept so the timestamp badge stays visible)
  //   error  = last save threw / returned non-2xx — user must retry, and
  //            we block beforeunload so the edit doesn't silently vanish
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(
    project.modules[0]?.id ?? null,
  );
  const [copied, setCopied] = useState(false);
  // `copiedKind` disambiguates which link was just copied so the button in
  // the overflow menu flashes "已复制" independently. Previously both the
  // Vercel-link action and the preview-link action shared one `copied` flag
  // so the second one opened showed "已复制" before the user ever clicked it.
  const [copiedKind, setCopiedKind] = useState<'vercel' | 'preview' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [addingLocale, setAddingLocale] = useState(false);
  const [pendingLocale, setPendingLocale] = useState<PageLocale | null>(null);
  // Capabilities probe (what can this deployment actually do?). Fetched
  // once on mount from /api/capabilities. Undefined = not yet loaded;
  // buttons stay enabled in that brief window (optimistic) since the
  // banner will still catch any failure.
  const [capabilities, setCapabilities] = useState<{
    hasClaude: boolean;
    hasOpenAI: boolean;
    hasDeepseek: boolean;
    hasDeploy: boolean;
    storageEphemeral: boolean;
  } | null>(null);
  useEffect(() => {
    fetch('/api/capabilities')
      .then((r) => r.json())
      .then((caps) => setCapabilities(caps))
      .catch(() => {
        // Capabilities endpoint itself failing is unusual; leave null
        // and let per-action banners handle the real errors.
      });
  }, []);
  // Top-of-editor error/warning banner state. Populated by handlers when
  // a route returns a structured error (LLM_REQUIRED / DEPLOY_REQUIRED /
  // HERO_IS_TEMPLATE / ...). Also populated on mount if the page arrived
  // with hydrationFailed=true so the user sees immediately that the
  // initial Claude hydration didn't run.
  const [notice, setNotice] = useState<NoticeState | null>(() => {
    if (initialPage?.hydrationFailed) {
      return {
        kind: 'warning',
        title: '本页 Claude 初始化未成功',
        message:
          '模块内容目前是确定性模板，不是 Claude 基于你产品写的。常见原因：ANTHROPIC_API_KEY 未配置、或生成过程超时。配置后对任意模块点「重新生成」即可让 Claude 重写。',
        code: 'HYDRATION_FAILED',
      };
    }
    return null;
  });

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
  const saveSnapRef = useRef({ project, page, editingLocale, saveState });
  useEffect(() => {
    saveSnapRef.current = { project, page, editingLocale, saveState };
  });

  useEffect(() => {
    if (saveState !== 'dirty') return;
    const timer = setTimeout(async () => {
      setSaveState('saving');
      setSaveError(null);
      try {
        // If v2 page available, save modules to exact (variant, locale) cell
        if (page) {
          const res = await fetch(`/api/pages/${page.id}/modules`, {
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
          if (!res.ok) throw new Error(`modules PATCH ${res.status}`);
          // Read back the server-computed flags (hydrationFailed in particular)
          // so the banner clears the moment the user edits the hero away from
          // the template. If we skip this, the banner sticks until full reload.
          try {
            const data = await res.json();
            if (data?.page) setPage(data.page);
          } catch {
            // Non-JSON body is fine — the PATCH still succeeded.
          }
          // Mirror tone/theme on page too
          const res2 = await fetch(`/api/pages/${page.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tone: project.tone, theme: project.theme }),
            keepalive: true,
          });
          if (!res2.ok) throw new Error(`page PATCH ${res2.status}`);
        } else {
          // Fallback to legacy compat (shouldn't happen post-migration)
          const res = await fetch(`/api/projects/${project.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              modules: project.modules,
              tone: project.tone,
              theme: project.theme,
            }),
            keepalive: true,
          });
          if (!res.ok) throw new Error(`legacy PATCH ${res.status}`);
        }
        setLastSavedAt(Date.now());
        setSaveState('saved');
        // Briefly hold the green "✓ 已保存" state so the user sees it,
        // then fall back to the persistent "● 已保存 · HH:MM:SS" badge
        // driven by lastSavedAt. Guard against overwriting 'dirty' if the
        // user typed again during that 1.5s window.
        setTimeout(() => {
          setSaveState((s) => (s === 'saved' ? 'idle' : s));
        }, 1500);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'network error');
        setSaveState('error');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [saveState, project, page, editingLocale]);

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
      // Flush anytime the latest edit hasn't made it to the server yet.
      // `dirty` = debounce timer hadn't fired; `saving` = in-flight fetch
      // started but we want a second keepalive attempt in case unload
      // aborts the first; `error` = last attempt failed, this is our
      // last chance before the user leaves.
      const hasUnsaved =
        snap.saveState === 'dirty' ||
        snap.saveState === 'saving' ||
        snap.saveState === 'error';
      if (!hasUnsaved || !snap.page) return;
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
    // Dialog-prompt only for error state. For dirty/saving we trust the
    // keepalive flush — the common case (quick nav after edit) shouldn't
    // hit a confirm dialog every time, that's annoying. But if the LAST
    // save attempt VISIBLY failed, block unload so the user doesn't walk
    // away thinking their edit is safe when it isn't.
    const confirmIfError = (e: BeforeUnloadEvent) => {
      if (saveSnapRef.current.saveState === 'error') {
        e.preventDefault();
        // Chrome requires returnValue to be set to show the dialog; the
        // actual text is ignored by modern browsers (generic message).
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', confirmIfError);
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      // This cleanup fires both on unmount (soft nav, covers case 1) and
      // when the effect re-runs. Since deps are [], it only runs on unmount.
      flush();
      window.removeEventListener('beforeunload', confirmIfError);
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mark the editor as having unsaved changes. The save useEffect watches
  // for 'dirty' and debounces the actual fetch. Separating 'dirty' from
  // 'saving' lets the UI show "● 待保存" while the debounce timer ticks,
  // which is a more honest signal than "保存中…" before we've made the call.
  const touch = () => setSaveState('dirty');

  // Manual retry button target. Re-enters the dirty state, which triggers
  // the debounced save useEffect. If network is still broken we'll loop
  // back to 'error' — that's fine, the user can see the red badge stayed
  // and decide what to do.
  const retrySave = () => {
    setSaveError(null);
    setSaveState('dirty');
  };

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
    if (!res.ok) {
      // Structured LLM error — surface as banner. Old behavior was: silent
      // no-op. User clicked regenerate, nothing happened, no idea if
      // Claude failed or the click registered.
      setNotice(await readStructuredError(res));
      return;
    }
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

    // Eager flush before leaving the tab if there are unsaved edits.
    // 'dirty' / 'saving' / 'error' all mean "the server may not have
    // the latest modules yet". Without this, switching locale tabs
    // during rapid typing could race the debounced save and the prior
    // tab's last few keystrokes would be lost.
    if (saveState === 'dirty' || saveState === 'saving' || saveState === 'error') {
      try {
        const res = await fetch(`/api/pages/${page.id}/modules`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            variant: v,
            locale: editingLocale,
            modules: project.modules,
          }),
        });
        if (res.ok) {
          setLastSavedAt(Date.now());
          setSaveState('saved');
          setTimeout(() => {
            setSaveState((s) => (s === 'saved' ? 'idle' : s));
          }, 1500);
        } else {
          setSaveError(`modules PATCH ${res.status}`);
          setSaveState('error');
        }
      } catch (e) {
        // Non-fatal for the UI: the mirror effect has cached edits locally
        // so the user's UI will still show them on the next tab switch
        // back. Surface the failure via the save badge so they know.
        setSaveError(e instanceof Error ? e.message : 'network error');
        setSaveState('error');
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
  // `sourceLocale` is optional — when set, the server clones that locale's
  // modules (preserving order / disabled state / form schemas / media
  // refs / IDs) and only translates the text. When omitted the server
  // regenerates from scratch via the template + hydrate pipeline (the
  // legacy behavior, kept for users who want a clean slate).
  const confirmAddLocale = async (
    strategy: LocalizationStrategy,
    sourceLocale?: PageLocale,
  ) => {
    if (!page || !pendingLocale) return;
    const newLocale = pendingLocale;
    setAddingLocale(true);
    try {
      const res = await fetch(`/api/pages/${page.id}/locales`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: newLocale, strategy, sourceLocale }),
      });
      if (!res.ok) {
        // 503 LLM_REQUIRED (no ANTHROPIC_API_KEY / OPENAI_API_KEY) or
        // 502 LLM_CALL_FAILED. The locale is NOT added — we show the
        // banner and leave the user on the current tab. Pre-cleanup
        // this path silently produced a locale with generic English
        // templates; now we refuse rather than ship a fake locale.
        setNotice(await readStructuredError(res));
        return;
      }
      const data = await res.json();
      if (data?.page) {
        setPage(data.page);
        switchLocaleTabInternal(data.page, newLocale);

        // Compute media assets that haven't been localized to the new locale.
        // Gives the user a heads-up to go fill in language-specific screenshots
        // (per Q4 design: text is auto-localized; media needs a human pass).
        const gaps = findMediaLocaleGaps(data.page, newLocale);
        if (gaps.length > 0) {
          setNotice({
            kind: 'info',
            title: `已添加 ${nativeLabel(newLocale)} 语言`,
            message: `有 ${gaps.length} 个媒资（图片/视频）没有 ${nativeLabel(newLocale)} 版本——切到该 tab 时会回落到默认语言的版本。首 5 个：\n${gaps.slice(0, 5).join(' · ')}${gaps.length > 5 ? ` …还有 ${gaps.length - 5} 个` : ''}`,
            code: 'LOCALE_MEDIA_GAPS',
          });
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

  const [hydrating, setHydrating] = useState(false);
  // One-click re-hydrate: run hydrateModulesViaClaude for the current
  // editing locale. Used from the HYDRATION_FAILED banner action. The
  // per-module "regenerate" button is still there for surgical edits;
  // this is the "I just added my API key, do all 5 at once" path.
  const hydrateNow = async () => {
    if (!page || hydrating) return;
    setHydrating(true);
    try {
      const res = await fetch(`/api/pages/${page.id}/hydrate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: editingLocale }),
      });
      if (!res.ok) {
        setNotice(await readStructuredError(res));
        return;
      }
      const data = await res.json();
      if (data?.page) {
        setPage(data.page);
        // Repaint the editor with the freshly-hydrated modules for the
        // locale+variant we were editing. editingLocaleRef guard: if the
        // user switched tabs during hydrate, don't overwrite what they're
        // now looking at — same "串显示" protection as regenerate().
        if (editingLocaleRef.current === editingLocale) {
          const v = project.activeVariant ?? 'A';
          const mods = data.page.variants?.[v]?.[editingLocale] ?? [];
          setProject((p) => ({ ...p, modules: mods }));
        }
        const failed = data.hydrationFailed;
        setNotice({
          kind: failed ? 'warning' : 'info',
          title: failed
            ? 'Hydrate 部分成功 — 仍有模块是模板'
            : '已用 Claude 重写全部模块',
          message: failed
            ? '有模块两次调用后仍匹配模板指纹。通常是产品描述（name / tagline / value）太通用；在 ⚙ 设置里把它们改得更具体后再试一次。'
            : `locale=${editingLocale} 的 5 个文字模块已由 Claude 基于你的产品输入重写。`,
          code: failed ? 'HYDRATION_PARTIAL' : 'HYDRATION_OK',
        });
      }
    } catch (e: any) {
      setNotice({
        kind: 'error',
        title: 'Hydrate 请求失败',
        message: e?.message ?? '网络错误，请重试。',
        code: 'HYDRATE_NETWORK_ERROR',
      });
    } finally {
      setHydrating(false);
    }
  };

  const [deploying, setDeploying] = useState(false);
  const deployToVercel = async () => {
    setDeploying(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/deploy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      // Quality gate: server refuses publish when Hero is still template
      // copy. The old "force=true" override has been removed — the only
      // correct fix is to click "重新生成" on the Hero or hand-edit it.
      // Force-publishing generic template copy is the "3.8 倍 ROI"
      // failure mode we're explicitly trying to kill.
      if (res.status === 409) {
        setNotice(await readStructuredError(res));
        return false;
      }
      // DEPLOY_REQUIRED (no VC_API_TOKEN) → 503, DEPLOY_FAILED (Vercel
      // API rejected the upload) → 502. Both surface as a banner; the
      // old `alert('Vercel 部署失败：...')` is gone because alert() is
      // modal and the operator can't copy the exact error code.
      if (!res.ok) {
        setNotice(await readStructuredError(res));
        return false;
      }
      const data = await res.json();
      // Surgical merge: deploy success returns a fresh ProjectView, but
      // projectViewFromV2 always anchors `modules` on page.defaultLocale.
      // If the user is editing a non-default locale tab, blindly calling
      // setProject(data.project) clobbers the visible modules with source-
      // language content + the mirror useEffect persists the source content
      // back into the target-locale slot. User-visible symptom: "界面被
      // 刷新成源语言" while editingLocale + 查看 link both still point at
      // the target tab.
      //
      // Only the publish/deploy fields should change here. Everything else
      // (modules / variants / strategy / theme) stays tied to whatever the
      // user was editing.
      if (data?.project) {
        setProject((p) => ({
          ...p,
          published: data.project.published ?? p.published,
          deploy: data.project.deploy ?? p.deploy,
          publishedLocales: data.project.publishedLocales ?? p.publishedLocales,
        }));
      }
      return true;
    } finally {
      setDeploying(false);
    }
  };

  // Atomic publish: one click = flag + deploy.
  // Previously the toolbar had two separate buttons ("部署到 Vercel" and
  // "公开") so users had to know to click both, in the right order, to
  // actually make the page live. Users kept publishing without deploying
  // (so /p/slug was live but no Vercel URL existed) or deploying without
  // publishing (so Vercel URL worked but the dashboard showed "草稿").
  //
  // Now clicking the single "发布" button does both. If the deploy step
  // fails the quality gate (409 hero-is-template), deployToVercel's own
  // confirm dialog handles the force-publish branch; if the user backs
  // out there, we roll published back to false so the UI stays consistent
  // with reality (nothing was actually deployed).
  //
  // Un-publish is flag-only because lib/deploy.ts has no un-deploy helper
  // — the Vercel deployment URL keeps resolving. That's an honest tradeoff
  // and documented in the button's title attribute so the user can tell.
  const togglePublish = async () => {
    const next = !project.published;
    // Optimistic flag update so the button reacts instantly.
    setProject((p) => ({ ...p, published: next }));
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ published: next }),
      });
    } catch (e) {
      console.error('[togglePublish] PATCH failed:', e);
      setProject((p) => ({ ...p, published: !next }));
      setNotice({
        kind: 'error',
        title: '状态切换失败',
        message: '网络请求失败，请重试。',
        code: 'PUBLISH_TOGGLE_FAILED',
      });
      return;
    }
    if (next) {
      // Publishing: also deploy. If deploy returns false (quality gate
      // blocked, or Vercel errored), roll the flag back so the UI isn't
      // claiming "已发布" while no usable URL exists.
      const ok = await deployToVercel();
      if (!ok) {
        setProject((p) => ({ ...p, published: false }));
        await fetch(`/api/projects/${project.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ published: false }),
        }).catch(() => {});
      }
    }
  };

  // `?lang=<editingLocale>` forces /p/[slug] to render the tab the user is
  // currently looking at. Without this query, the public route falls back
  // through cookie → Accept-Language → geo → defaultLocale, so clicking
  // "查看" while on the English tab would open the Chinese page on any
  // browser with zh-CN at the top of Accept-Language — exactly the
  // "查看 shows 简体中文" bug the user reported 2026-04.
  const publicUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/p/${project.slug}?lang=${editingLocale}`
      : `/p/${project.slug}?lang=${editingLocale}`;

  const copyLink = async (kind: 'preview' | 'vercel' = 'preview') => {
    const url = kind === 'vercel' ? project.deploy?.url ?? publicUrl : publicUrl;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopiedKind(kind);
      setTimeout(() => {
        setCopied(false);
        setCopiedKind(null);
      }, 1200);
    } catch {
      // ignore — clipboard may be unavailable in iframes / insecure contexts
    }
  };

  // Close overflow menu when clicking outside or pressing Escape. Without
  // this the menu stays pinned open while the user interacts with the
  // rest of the toolbar, which felt "stuck."
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Smart "查看" URL — prefer the live Vercel deploy URL when we have one,
  // fall back to the internal /p/<slug>?lang=<tab> preview. Keeps the
  // toolbar button count down while still giving the user a single
  // predictable "see it live" click. We use the RELATIVE `/p/<slug>` form
  // here (not the absolute `publicUrl`) because `publicUrl` depends on
  // `window.location.origin` which is only available on the client — using
  // it in JSX triggers a Next.js hydration mismatch ("Server: /p/...
  // Client: http://.../p/..."). The absolute form is still used for
  // clipboard copy (the user wants a pasteable URL), just not for href.
  //
  // Locale trap: the Vercel deploy is a single `index.html` with ONE
  // locale baked in (defaultLocale at deploy time — see /api/projects/
  // [id]/deploy which uses projectView.modules without a locale arg).
  // When the user is on a non-default tab, sending them to the Vercel URL
  // would show the OTHER language's content and they'd think localization
  // is broken. Route them through the internal preview with `?lang=` so
  // the page renders the tab they're actually editing.
  const isDefaultLocaleTab =
    editingLocale === (page?.defaultLocale ?? project.inputs.locale);
  const viewUrl =
    project.deploy?.url && isDefaultLocaleTab
      ? project.deploy.url
      : `/p/${project.slug}?lang=${editingLocale}`;

  const unusedTypes = ALL_TYPES.filter((t) => !project.modules.some((m) => m.type === t));

  return (
    <>
      {notice && (
        <NoticeBanner
          notice={notice}
          onDismiss={() => setNotice(null)}
          action={
            // Wire the "立即 hydrate" button only on the mount-time
            // hydration-failed warning and on the partial-hydrate
            // follow-up. Other notices (LLM_REQUIRED from a regen click,
            // DEPLOY_FAILED, etc.) don't get the button — re-clicking
            // the failed action is the right retry there.
            notice.code === 'HYDRATION_FAILED' || notice.code === 'HYDRATION_PARTIAL'
              ? {
                  label: '立即 hydrate（当前语言）',
                  onClick: hydrateNow,
                  disabled: !(capabilities?.hasClaude || capabilities?.hasDeepseek),
                  running: hydrating,
                  disabledReason: '需要 ANTHROPIC_API_KEY 或 DEEPSEEK_API_KEY 才能 hydrate。',
                }
              : undefined
          }
        />
      )}
      <div className="grid min-h-[calc(100vh-56px)] grid-cols-12 gap-0">
      {/* Left rail — modules + findings only. Settings moved to a modal
          accessed from the ⋮ overflow menu; leads moved to Dashboard.
          See `settingsOpen` state doc comment for the rationale. */}
      <aside className="col-span-12 border-r border-ink-100 bg-white p-4 md:col-span-3 lg:col-span-3">
        <div className="mt-0">
          {/* Variant tab — lives above the module list because switching
              A/B swaps both the content AND the module ordering
              (A: hero→social→pain→…; B: hero→social→benefits→…).
              Pinning it here makes "I'm editing variant A" a visible part
              of the module list's identity rather than a toolbar toggle
              people forget is on. */}
          <div className="mb-3">
            <div className="label mb-1.5">叙事方案</div>
            <div className="flex items-center gap-1 rounded-xl border border-ink-100 bg-white p-1 text-xs">
              <button
                title="方案 A — 痛点驱动 (Pain-Agitate-Solve)"
                className={`flex-1 rounded-lg px-2.5 py-1.5 ${project.activeVariant === 'A' ? 'bg-ink-900 text-white' : 'text-ink-700'}`}
                onClick={() => switchVariant('A')}
              >
                A · 痛点
              </button>
              <button
                title="方案 B — 收益驱动 (Benefit-Focused)"
                className={`flex-1 rounded-lg px-2.5 py-1.5 ${project.activeVariant === 'B' ? 'bg-ink-900 text-white' : 'text-ink-700'}`}
                onClick={() => switchVariant('B')}
              >
                B · 收益
              </button>
            </div>
          </div>
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
                {/* ↑↓ 始终可见 (opacity-50 → 100 on hover) — hover-only
                    reveal 把最常用的「调整模块顺序」藏进悬停彩蛋里，用户
                    根本不知道功能存在。删除(×)保持 hover 隐藏，因为是
                    破坏性操作，不宜常驻诱导点击。 */}
                <button
                  title={t('editor.moveUp')}
                  onClick={() => move(m.id, -1)}
                  className="opacity-50 hover:opacity-100 text-ink-500 hover:text-ink-900"
                >
                  ↑
                </button>
                <button
                  title={t('editor.moveDown')}
                  onClick={() => move(m.id, 1)}
                  className="opacity-50 hover:opacity-100 text-ink-500 hover:text-ink-900"
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
      </aside>

      {/* Middle: preview */}
      <section className="col-span-12 bg-ink-100/30 p-4 md:col-span-6 lg:col-span-6">
        {/* Hydration-failure banner (PRD v5.1 §4.4 quality gate).
            Server flags this when the Hero hero headline / bullets still
            match ai.ts's fallback template fingerprints across every
            (variant, locale) cell — i.e. Claude's first rewrite pass and
            every subsequent regenerate have all failed silently. The
            preview will visibly show generic copy that does NOT reflect
            this product, so we surface the problem loudly rather than
            letting the user ship "3.8 倍 ROI" with no supporting grounding. */}
        {page?.hydrationFailed && (
          <div className="mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-800">
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <span aria-hidden>⚠️</span>
              <span>Hero 文案可能仍是模板占位符</span>
            </div>
            <p className="leading-relaxed">
              AI 改写在生成/切换语言时失败，当前 Hero 标题或要点仍是未被替换的通用文案，
              与您的产品信息不匹配。建议点击 Hero 模块右侧的「重新生成」按钮，或手动改写后再发布。
              未修复时，发布功能将被阻止。
            </p>
          </div>
        )}

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
          {/* Toolbar left half — only 视图 (device) now. Variant tab moved
              to the module-list header on the left rail since it governs
              "which content variant am I editing" (the module list reorders
              A vs B), not "which viewport". Keeping them in the same row
              always felt like two unrelated knobs welded together. */}
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
          </div>
          <div className="flex items-center gap-2">
            {/* Persistent save-state badge. Unlike the old "flash for 1.2s
                then disappear" design, this stays visible so the user can
                always tell whether the server has accepted the latest edit.
                Color-coded: gray (dirty / idle), blue (saving), green
                (saved), red (error — clickable to retry). */}
            <SaveStateBadge
              saveState={saveState}
              lastSavedAt={lastSavedAt}
              saveError={saveError}
              onRetry={retrySave}
              labels={{
                dirty: t('editor.dirty'),
                saving: t('editor.saving'),
                saved: t('editor.saved'),
                error: t('editor.saveError'),
                retry: t('editor.retry'),
                savedAt: t('editor.savedAt'),
              }}
            />

            {/* Toolbar — 4 primary buttons + overflow menu.
                  - 导出 HTML   (always, no state — pure export)
                  - 查看 ↗     (smart: Vercel URL if deployed else /p/slug)
                  - 已发布 / 发布 (atomic — one click = flag + deploy)
                  - ⋮         (overflow: 设置 / 线索 / 复制链接 / 发布模式 / 重新部署)
                Publish-mode (single vs A/B split) lives in ⋮ now — it's a
                per-project setting users flip once, not a per-action toggle,
                so parking it next to the publish button pushed everything
                else into the flex-wrap zone and squished "已发布 ✓" into a
                three-line vertical stack on 1400px screens. */}
            <a
              className="btn btn-secondary whitespace-nowrap flex-shrink-0 px-3 py-1.5 text-xs"
              href={`/api/projects/${project.id}/export`}
              download={`${project.slug}.html`}
              title="下载当前页面的静态 HTML 文件"
            >
              导出 HTML
            </a>
            <a
              className="btn btn-secondary whitespace-nowrap flex-shrink-0 px-3 py-1.5 text-xs"
              href={viewUrl}
              target="_blank"
              rel="noreferrer"
              title={
                project.deploy?.url && isDefaultLocaleTab
                  ? `在新标签页打开 Vercel 上的正式页面\n${project.deploy.url}`
                  : project.deploy?.url && !isDefaultLocaleTab
                    ? `当前在 ${editingLocale} 标签；Vercel 上只发布了 ${page?.defaultLocale ?? project.inputs.locale} 版本，改打开本地预览\n${viewUrl}`
                    : `在新标签页打开本地预览（${editingLocale}）\n${viewUrl}`
              }
            >
              查看 ↗
            </a>
            <button
              className={`btn whitespace-nowrap flex-shrink-0 px-3 py-1.5 text-xs ${project.published ? 'btn-secondary' : 'btn-primary'}`}
              onClick={togglePublish}
              disabled={deploying}
              title={
                deploying
                  ? '正在部署到 Vercel…'
                  : project.published
                    ? '点击取消发布（Vercel 链接会保留，但页面将不再在主列表中显示为"已发布"）'
                    : '点击发布到 Vercel 并标记为"已发布"'
              }
            >
              {deploying
                ? '发布中…'
                : project.published
                  ? `${t('editor.published')} ✓`
                  : t('editor.publish')}
            </button>
            <div className="relative flex-shrink-0" ref={menuRef}>
              <button
                className="btn btn-secondary px-2.5 py-1.5 text-xs"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="更多操作"
                title="更多操作"
              >
                ⋮
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-full z-20 mt-1 min-w-[220px] rounded-xl border border-ink-100 bg-white py-1 shadow-lg"
                  role="menu"
                >
                  <button
                    className="block w-full px-3 py-2 text-left text-xs text-ink-700 hover:bg-ink-50"
                    onClick={() => {
                      setSettingsOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    ⚙ 设置（风格 · 语气 · 主色）
                  </button>
                  <a
                    className="block w-full px-3 py-2 text-left text-xs text-ink-700 hover:bg-ink-50"
                    href={`/${locale}/dashboard`}
                    onClick={() => setMenuOpen(false)}
                  >
                    📬 线索（{leads.length}） → Dashboard
                  </a>
                  <div className="my-1 border-t border-ink-100" />
                  <button
                    className="block w-full px-3 py-2 text-left text-xs text-ink-700 hover:bg-ink-50 disabled:opacity-50"
                    disabled={!project.deploy?.url}
                    onClick={() => {
                      copyLink('vercel');
                      setMenuOpen(false);
                    }}
                  >
                    {copied && copiedKind === 'vercel'
                      ? '已复制 Vercel 链接 ✓'
                      : project.deploy?.url
                        ? '复制 Vercel 链接'
                        : '复制 Vercel 链接（尚未部署）'}
                  </button>
                  <button
                    className="block w-full px-3 py-2 text-left text-xs text-ink-700 hover:bg-ink-50"
                    onClick={() => {
                      copyLink('preview');
                      setMenuOpen(false);
                    }}
                  >
                    {copied && copiedKind === 'preview' ? '已复制预览链接 ✓' : '复制预览链接'}
                  </button>
                  <div className="my-1 border-t border-ink-100" />
                  {/* 发布模式 — was an inline <select> in the toolbar next
                      to the publish button; that put a decision users rarely
                      flip (once per project) at the same visual weight as the
                      publish button itself and got the toolbar squished to
                      the point where "已发布 ✓" wrapped into three vertical
                      lines on 1400px screens. Moved here with a radio layout
                      so the "single vs A/B split" choice reads as a setting,
                      not a primary action. */}
                  <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-ink-500">
                    发布模式
                  </div>
                  {([
                    ['single', '单方案', '所有访客看到当前主 variant'],
                    ['ab-split', 'A/B 分流', '按 cookie lp_v 粘性分流 A/B'],
                  ] as const).map(([mode, label, hint]) => (
                    <button
                      key={mode}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-ink-50 ${
                        project.publishMode === mode ? 'text-brand-700' : 'text-ink-700'
                      }`}
                      onClick={async () => {
                        if (project.publishMode === mode) return;
                        setProject((p) => ({ ...p, publishMode: mode }));
                        await fetch(`/api/projects/${project.id}`, {
                          method: 'PATCH',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ publishMode: mode }),
                        });
                      }}
                      title={hint}
                    >
                      <span className="mt-[2px] inline-block h-3 w-3 rounded-full border border-ink-300 bg-white">
                        {project.publishMode === mode && (
                          <span className="block h-full w-full scale-[0.55] rounded-full bg-brand-600" />
                        )}
                      </span>
                      <span className="flex-1">
                        <span className="font-medium">{label}</span>
                        <span className="block text-[10px] text-ink-500">{hint}</span>
                      </span>
                    </button>
                  ))}
                  <div className="my-1 border-t border-ink-100" />
                  <button
                    className="block w-full px-3 py-2 text-left text-xs text-ink-700 hover:bg-ink-50 disabled:opacity-50"
                    disabled={deploying}
                    onClick={() => {
                      deployToVercel();
                      setMenuOpen(false);
                    }}
                    title={
                      project.deploy?.url
                        ? '将当前内容再次推送到已有的 Vercel 部署'
                        : '首次部署到 Vercel（平台托管 token）'
                    }
                  >
                    {project.deploy?.url ? '重新部署到 Vercel ▲' : '部署到 Vercel ▲'}
                  </button>
                </div>
              )}
            </div>
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
              nav={page?.nav}
              fontPresetId={page?.fontPresetId as any}
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
            regenerateDisabledReason={
              capabilities && !capabilities.hasClaude && !capabilities.hasDeepseek
                ? '需要 ANTHROPIC_API_KEY 或 DEEPSEEK_API_KEY 才能重写文案。'
                : null
            }
            // Page-level font picker rendered inside HeroEditor right
            // under 标题字号 (per user UX request — naturally where you
            // check typography during Hero authoring). Other module
            // editors don't render it; users switch to Hero to debug
            // fonts visually. Settings modal still has the same control
            // for "all page-level config" entry-point completeness.
            //
            // Locale wiring: picker shows 6 presets curated for the
            // current editing locale. The chosen fontStack is page-
            // scoped (applies across locales via cross-locale fallback
            // chains), but the OPTIONS surface what's appropriate for
            // the locale the user is staring at right now.
            pageFont={
              page
                ? {
                    value: page.fontPresetId ?? null,
                    locale: editingLocale,
                    onChange: async (presetId) => {
                      setPage((prev) => {
                        if (!prev) return prev;
                        const next = { ...prev };
                        if (presetId) next.fontPresetId = presetId;
                        else delete next.fontPresetId;
                        return next;
                      });
                      try {
                        await fetch(`/api/pages/${page.id}`, {
                          method: 'PATCH',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ fontPresetId: presetId }),
                        });
                      } catch {
                        // Optimistic — autosave's next round-trip surfaces errors.
                      }
                    },
                  }
                : undefined
            }
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
          availableLocales={page.availableLocales}
          defaultSourceLocale={page.defaultLocale}
          onApprove={confirmAddLocale}
          onClose={() => setPendingLocale(null)}
        />
      )}
    </div>
    {settingsOpen && (
      <SettingsModal
        project={project}
        productId={page?.productId}
        pageId={page?.id}
        fontPresetId={page?.fontPresetId}
        onChangeFontPreset={async (presetId) => {
          if (!page) return;
          // Optimistic local update + persist via PATCH. On the next render
          // PageRenderer reads page.fontPresetId; the new font kicks in.
          setPage((prev) => {
            if (!prev) return prev;
            const next = { ...prev };
            if (presetId) next.fontPresetId = presetId;
            else delete next.fontPresetId;
            return next;
          });
          try {
            await fetch(`/api/pages/${page.id}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ fontPresetId: presetId }),
            });
          } catch {
            // Same approach as nav: keep optimistic flip on failure; next
            // autosave round-trips it cleanly.
          }
        }}
        navEnabled={page?.nav?.enabled ?? false}
        onToggleNav={async (enabled) => {
          if (!page) return;
          const nextNav = { enabled, items: page.nav?.items };
          setPage((prev) => (prev ? { ...prev, nav: nextNav } : prev));
          try {
            await fetch(`/api/pages/${page.id}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ nav: nextNav }),
            });
          } catch {
            // Keep UI state flipped even if the network call fails; the
            // next autosave cycle will either succeed or surface the
            // error via the main save state badge.
          }
        }}
        tones={TONES}
        onChangeStyle={changeStyle}
        onChangeTone={changeTone}
        onChangeColor={(hex) => {
          setProject((p) => ({ ...p, theme: { ...p.theme, primary: hex } }));
          touch();
        }}
        onProductInfoChange={(patch) => {
          // Mirror the saved product fields back into project.inputs so the
          // regenerate path uses fresh values immediately without a reload.
          // Backend (/api/projects/[id] PATCH) reads from Product anyway,
          // but the UI label and any subsequent client-side computation
          // need to see the new values right away.
          setProject((p) => ({
            ...p,
            inputs: {
              ...p.inputs,
              name: patch.name ?? p.inputs.name,
              tagline: patch.tagline ?? p.inputs.tagline,
              value: patch.value ?? p.inputs.value,
            },
          }));
        }}
        tLabels={{
          tone: t('editor.tone'),
          strategyPanel: t('editor.strategyPanel'),
          tones: TONES.reduce(
            (acc, tn) => ({ ...acc, [tn]: t(`editor.tones.${tn}`) }),
            {} as Record<string, string>,
          ),
        }}
        onClose={() => setSettingsOpen(false)}
      />
    )}
    </>
  );
}

// Extracted settings modal. Contains everything that used to be in the
// left rail's 设置 tab: style preset, tone, primary color, AI strategy
// summary, LLM routing legend. Lives OUTSIDE the editor grid so it can
// overlay the full viewport without wrestling with the aside's col-span.
//
// Design-intent note: publishMode (single / ab-split) is NOT here — it
// moved to an inline dropdown right before the Deploy button, because
// the single-most-confusing thing about the old 3-tab design was that
// 发布模式 affected Deploy but lived in a totally different UI region.
// Co-locating them is the fix.
function SettingsModal({
  project,
  productId,
  pageId,
  fontPresetId,
  onChangeFontPreset,
  navEnabled,
  onToggleNav,
  tones,
  onChangeStyle,
  onChangeTone,
  onChangeColor,
  onProductInfoChange,
  tLabels,
  onClose,
}: {
  project: Project;
  productId?: string;
  pageId?: string;
  fontPresetId?: string;
  onChangeFontPreset: (presetId: string | null) => void;
  navEnabled: boolean;
  onToggleNav: (enabled: boolean) => void;
  tones: ToneKey[];
  onChangeStyle: (id: StyleId) => void;
  onChangeTone: (t: ToneKey) => void;
  onChangeColor: (hex: string) => void;
  onProductInfoChange: (patch: { name?: string; tagline?: string; value?: string }) => void;
  tLabels: { tone: string; strategyPanel: string; tones: Record<string, string> };
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Local draft for product info so the user can edit without triggering
  // a network call on every keystroke. Save on blur / explicit save click.
  const [pName, setPName] = useState(project.inputs.name ?? '');
  const [pTagline, setPTagline] = useState(project.inputs.tagline ?? '');
  const [pValue, setPValue] = useState(project.inputs.value ?? '');
  const [productSaving, setProductSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [productError, setProductError] = useState<string | null>(null);

  const saveProductInfo = async () => {
    if (!productId) return;
    const patch: { name?: string; tagline?: string; value?: string } = {};
    if (pName !== project.inputs.name) patch.name = pName;
    if (pTagline !== project.inputs.tagline) patch.tagline = pTagline;
    if (pValue !== project.inputs.value) patch.value = pValue;
    if (Object.keys(patch).length === 0) return;
    setProductSaving('saving');
    setProductError(null);
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        // Try to extract structured error body
        let msg = `HTTP ${res.status}`;
        try {
          const b = await res.json();
          msg = b?.message ?? b?.error ?? msg;
        } catch {}
        setProductSaving('error');
        setProductError(msg);
        return;
      }
      onProductInfoChange(patch);
      setProductSaving('saved');
      setTimeout(() => setProductSaving('idle'), 1400);
    } catch (e: any) {
      setProductSaving('error');
      setProductError(e?.message ?? 'network error');
    }
  };
  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-ink-900/40 px-4 py-10"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-ink-100 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold">设置</div>
          <button
            className="rounded-md px-2 py-0.5 text-lg text-ink-500 hover:text-ink-900"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="mt-4 space-y-4">
          {/* Product info — editable. Lets the user fix a generic
              name/tagline/value (the root cause of Claude output
              matching template fingerprints) without leaving the editor.
              Saves via PATCH /api/products/[id]; next regenerate picks
              up the fresh values because the backend reads Product
              fresh on each PATCH. */}
          {productId ? (
            <div className="rounded-xl border border-ink-100 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="label">产品信息</div>
                {productSaving === 'saving' && (
                  <span className="text-[11px] text-ink-500">保存中…</span>
                )}
                {productSaving === 'saved' && (
                  <span className="text-[11px] text-emerald-700">已保存 ✓</span>
                )}
                {productSaving === 'error' && (
                  <span className="text-[11px] text-red-700">保存失败：{productError}</span>
                )}
              </div>
              <div className="space-y-2">
                <div>
                  <label className="text-[11px] text-ink-500">产品名</label>
                  <input
                    className="input"
                    value={pName}
                    onChange={(e) => setPName(e.target.value)}
                    onBlur={saveProductInfo}
                  />
                </div>
                <div>
                  <label className="text-[11px] text-ink-500">Tagline</label>
                  <input
                    className="input"
                    value={pTagline}
                    onChange={(e) => setPTagline(e.target.value)}
                    onBlur={saveProductInfo}
                  />
                </div>
                <div>
                  <label className="text-[11px] text-ink-500">核心价值（Claude 生成的锚点）</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={pValue}
                    onChange={(e) => setPValue(e.target.value)}
                    onBlur={saveProductInfo}
                  />
                  <p className="mt-1 text-[10px] leading-relaxed text-ink-500">
                    越具体越好。通用描述（"帮助团队提升效率"）会让 Claude 退回到模板；
                    产品特定信息（"把 11 小时/周手工录入变成自动同步"）才抓得住锚点。
                  </p>
                </div>
              </div>
            </div>
          ) : null}
          <div>
            <div className="label mb-1.5">风格</div>
            <div className="grid grid-cols-1 gap-1.5">
              {Object.values(STYLE_PRESETS).map((s) => (
                <button
                  key={s.id}
                  onClick={() => onChangeStyle(s.id)}
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
            <div className="label mb-1.5">字体（按页面默认语言）</div>
            <select
              className="input"
              value={fontPresetId ?? ''}
              onChange={(e) => onChangeFontPreset(e.target.value || null)}
            >
              <option value="">默认（按风格预设自动选）</option>
              {/* Settings modal shows the page's defaultLocale's curated
                  6 — primary entry point keyed off page identity. The
                  inline picker in Hero editor uses editingLocale for
                  more contextual switching. */}
              {presetsForLocale(project.inputs.locale as any).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} — {p.hint}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
              字体作用全页面（所有语言共享）。选项按页面默认语言展示；
              切到具体语言 tab 时编辑器右栏 Hero 块下也能选当前语言的字体。
            </p>
          </div>
          <div>
            <div className="label mb-1.5">{tLabels.tone}</div>
            <select
              className="input"
              value={project.tone}
              onChange={(e) => onChangeTone(e.target.value as ToneKey)}
            >
              {tones.map((tn) => (
                <option key={tn} value={tn}>
                  {tLabels.tones[tn]}
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
                onChange={(e) => onChangeColor(e.target.value)}
                className="h-10 w-12 rounded-lg border border-ink-100"
              />
              <input
                className="input"
                value={project.theme.primary}
                onChange={(e) => onChangeColor(e.target.value)}
              />
            </div>
          </div>
          {pageId && (
            <div className="rounded-xl border border-ink-100 p-3">
              <div className="label mb-1.5">页面导航</div>
              <label className="flex items-center gap-2 text-xs text-ink-700">
                <input
                  type="checkbox"
                  checked={navEnabled}
                  onChange={(e) => onToggleNav(e.target.checked)}
                />
                显示顶部导航栏（锚点跳转到各模块）
              </label>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
                开启后页面顶部会固定一条导航条，自动列出 hero 以外的启用模块。
              </p>
            </div>
          )}
          <div className="rounded-xl border border-ink-100 p-3 text-xs text-ink-500">
            <div className="font-medium text-ink-700">AI {tLabels.strategyPanel}</div>
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
              <li>• Claude Opus 4 — 结构化文案</li>
              <li>• GPT-4o — 多语言语境转换</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Persistent save-state badge. Rendered in the editor toolbar so the user
 * always has a visible signal of whether their latest edit has reached the
 * server. Replaces the old "flash '已保存' for 1.2s then disappear" design,
 * which left the toolbar blank 99% of the time and gave the user no way to
 * distinguish "saved" from "never opened network" from "save failed silently".
 *
 * State → visual:
 *   idle (never saved)       → nothing (nothing to report yet)
 *   idle (saved before)      → gray "● 已保存 · HH:MM:SS"
 *   dirty                    → gray "● 待保存" (debounce timer ticking)
 *   saving                   → blue "↻ 保存中…"
 *   saved                    → green "✓ 已保存" (briefly, then decays to idle)
 *   error                    → red "⚠ 保存失败" + clickable retry link
 */
function SaveStateBadge({
  saveState,
  lastSavedAt,
  saveError,
  onRetry,
  labels,
}: {
  saveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  saveError: string | null;
  onRetry: () => void;
  labels: {
    dirty: string;
    saving: string;
    saved: string;
    error: string;
    retry: string;
    savedAt: string;
  };
}) {
  const fmt = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  if (saveState === 'error') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-700"
        title={saveError ?? undefined}
      >
        <span aria-hidden>⚠</span>
        <span>{labels.error}</span>
        <button
          onClick={onRetry}
          className="ml-0.5 underline hover:no-underline font-medium"
        >
          {labels.retry}
        </button>
      </span>
    );
  }

  if (saveState === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-brand-700">
        <span className="animate-pulse" aria-hidden>↻</span>
        <span>{labels.saving}</span>
      </span>
    );
  }

  if (saveState === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700">
        <span aria-hidden>✓</span>
        <span>{labels.saved}</span>
        {lastSavedAt && <span className="text-ink-400">· {fmt(lastSavedAt)}</span>}
      </span>
    );
  }

  if (saveState === 'dirty') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-500">
        <span aria-hidden>●</span>
        <span>{labels.dirty}</span>
      </span>
    );
  }

  // idle: show the last-saved timestamp if we have one, otherwise nothing
  // (prevents "● 已保存" lying about a freshly-loaded never-edited page).
  if (lastSavedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-500">
        <span className="text-emerald-600" aria-hidden>●</span>
        <span>
          {labels.savedAt} {fmt(lastSavedAt)}
        </span>
      </span>
    );
  }
  return null;
}

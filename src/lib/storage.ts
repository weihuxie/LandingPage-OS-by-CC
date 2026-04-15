/**
 * Storage adapter.
 *
 * Runtime decision:
 *   - KV_REST_API_URL present  → Vercel KV (Redis)
 *   - otherwise                → file system at .data/ (local dev)
 *
 * All readers forward-migrate old records so schema changes don't crash
 * the editor / renderer.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { kv } from '@vercel/kv';
import type { Project, Lead, AssetLibrary } from './types';

const USE_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

// --- Keys (shared between KV and FS layouts) ---------------------------

const KEY_PROJECTS = 'lp:projects';
const KEY_LEADS = 'lp:leads';
const KEY_ASSETS = 'lp:assets';
const KEY_EVENTS = 'lp:events';

const DEFAULT_ASSETS: AssetLibrary = {
  brand: null,
  testimonials: [],
  certifications: [],
  cases: [],
  press: [],
};

// --- Low-level adapter -------------------------------------------------

async function readRaw<T>(key: string, fallback: T): Promise<T> {
  if (USE_KV) {
    const v = (await kv.get<T>(key)) as T | null;
    return v ?? fallback;
  }
  return readFs(key, fallback);
}

async function writeRaw<T>(key: string, value: T): Promise<void> {
  if (USE_KV) {
    await kv.set(key, value);
    return;
  }
  await writeFs(key, value);
}

// --- FS adapter --------------------------------------------------------

// Priority: explicit DATA_DIR → /tmp on Vercel (writable, ephemeral) → project-relative .data/
const DATA_DIR =
  process.env.DATA_DIR ??
  (process.env.VERCEL === '1' ? '/tmp/.data' : path.join(process.cwd(), '.data'));

function fsPath(key: string): string {
  return path.join(DATA_DIR, key.replace(/^lp:/, '') + '.json');
}

async function ensureFsDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readFs<T>(key: string, fallback: T): Promise<T> {
  await ensureFsDir();
  const file = fsPath(key);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeFs<T>(key: string, value: T): Promise<void> {
  await ensureFsDir();
  const file = fsPath(key);
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

// --- Projects ----------------------------------------------------------

export async function readProjects(): Promise<Project[]> {
  const list = (await readRaw<any[]>(KEY_PROJECTS, [])) ?? [];
  return list.map(migrate);
}

export async function writeProjects(list: Project[]): Promise<void> {
  await writeRaw(KEY_PROJECTS, list);
}

export async function getProject(id: string): Promise<Project | null> {
  const list = await readProjects();
  return list.find((p) => p.id === id) ?? null;
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const list = await readProjects();
  return list.find((p) => p.slug === slug) ?? null;
}

export async function saveProject(project: Project): Promise<Project> {
  const list = await readProjects();
  const idx = list.findIndex((p) => p.id === project.id);
  project.updatedAt = Date.now();
  if (idx === -1) list.unshift(project);
  else list[idx] = project;
  await writeProjects(list);
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  const list = await readProjects();
  await writeProjects(list.filter((p) => p.id !== id));
}

// --- Leads -------------------------------------------------------------

export async function readLeads(projectId?: string): Promise<Lead[]> {
  const all = (await readRaw<Lead[]>(KEY_LEADS, [])) ?? [];
  return projectId ? all.filter((l) => l.projectId === projectId) : all;
}

export async function appendLead(lead: Lead): Promise<void> {
  const all = (await readRaw<Lead[]>(KEY_LEADS, [])) ?? [];
  all.unshift(lead);
  await writeRaw(KEY_LEADS, all);

  const list = await readProjects();
  const p = list.find((x) => x.id === lead.projectId);
  if (p) {
    p.leadCount = (p.leadCount ?? 0) + 1;
    if (lead.variant && p.abStats) {
      p.abStats[lead.variant].leads += 1;
    }
    await writeProjects(list);
  }
}

// --- Assets ------------------------------------------------------------

export async function readAssets(): Promise<AssetLibrary> {
  return (await readRaw<AssetLibrary>(KEY_ASSETS, DEFAULT_ASSETS)) ?? DEFAULT_ASSETS;
}

export async function writeAssets(lib: AssetLibrary): Promise<void> {
  await writeRaw(KEY_ASSETS, lib);
}

// --- Events (analytics) ------------------------------------------------

export interface PageEvent {
  id: string;
  projectId: string;
  variant?: 'A' | 'B';
  type: 'view' | 'cta_click' | 'form_submit';
  locale: string;
  country?: string;
  referrer?: string;
  createdAt: number;
}

const MAX_EVENTS = 50_000;

export async function appendEvent(ev: PageEvent): Promise<void> {
  const all = (await readRaw<PageEvent[]>(KEY_EVENTS, [])) ?? [];
  all.unshift(ev);
  if (all.length > MAX_EVENTS) all.length = MAX_EVENTS;
  await writeRaw(KEY_EVENTS, all);

  if (ev.type === 'view') {
    const list = await readProjects();
    const p = list.find((x) => x.id === ev.projectId);
    if (p) {
      p.views = (p.views ?? 0) + 1;
      if (ev.variant && p.abStats) {
        p.abStats[ev.variant].views += 1;
      }
      await writeProjects(list);
    }
  }
}

export async function readEvents(projectId?: string): Promise<PageEvent[]> {
  const all = (await readRaw<PageEvent[]>(KEY_EVENTS, [])) ?? [];
  return projectId ? all.filter((e) => e.projectId === projectId) : all;
}

// --- Migration (forward-compat) ---------------------------------------

function migrate(p: any): Project {
  const theme = p.theme ?? {};
  const styleId =
    theme.styleId ?? (theme.style === 'minimal' ? 'minimal-trust' : 'saas-modern');
  const variants = p.variants ?? { A: p.modules ?? [], B: p.modules ?? [] };
  return {
    ...p,
    activeVariant: p.activeVariant ?? 'A',
    publishMode: p.publishMode ?? 'single',
    theme: { primary: theme.primary ?? '#4861ff', styleId, secondary: theme.secondary },
    variants,
    views: p.views ?? 0,
    abStats: p.abStats ?? { A: { views: 0, leads: 0 }, B: { views: 0, leads: 0 } },
  } as Project;
}

// --- Introspection (for /api/health) ----------------------------------

export function storageBackend(): 'kv' | 'fs' {
  return USE_KV ? 'kv' : 'fs';
}

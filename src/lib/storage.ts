import { promises as fs } from 'fs';
import path from 'path';
import type { Project, Lead, AssetLibrary } from './types';

const DATA_DIR = path.join(process.cwd(), '.data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const ASSETS_FILE = path.join(DATA_DIR, 'assets.json');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');

async function ensure() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  for (const f of [PROJECTS_FILE, LEADS_FILE, EVENTS_FILE]) {
    try {
      await fs.access(f);
    } catch {
      await fs.writeFile(f, '[]', 'utf8');
    }
  }
  try {
    await fs.access(ASSETS_FILE);
  } catch {
    await fs.writeFile(
      ASSETS_FILE,
      JSON.stringify(
        { brand: null, testimonials: [], certifications: [], cases: [], press: [] },
        null,
        2,
      ),
      'utf8',
    );
  }
}

export async function readProjects(): Promise<Project[]> {
  await ensure();
  const raw = await fs.readFile(PROJECTS_FILE, 'utf8');
  try {
    const list = JSON.parse(raw) as any[];
    return list.map(migrate);
  } catch {
    return [];
  }
}

export async function writeProjects(list: Project[]): Promise<void> {
  await ensure();
  await fs.writeFile(PROJECTS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

export async function getProject(id: string): Promise<Project | null> {
  const list = await readProjects();
  const p = list.find((x) => x.id === id);
  return p ? migrate(p) : null;
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const list = await readProjects();
  const p = list.find((x) => x.slug === slug);
  return p ? migrate(p) : null;
}

// Forward-migrate older project records so renderer / editor never crash.
function migrate(p: any): Project {
  const theme = p.theme ?? {};
  const styleId = theme.styleId ?? (theme.style === 'minimal' ? 'minimal-trust' : 'saas-modern');
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

export async function readLeads(projectId?: string): Promise<Lead[]> {
  await ensure();
  const raw = await fs.readFile(LEADS_FILE, 'utf8');
  let all: Lead[] = [];
  try {
    all = JSON.parse(raw) as Lead[];
  } catch {
    all = [];
  }
  return projectId ? all.filter((l) => l.projectId === projectId) : all;
}

export async function appendLead(lead: Lead): Promise<void> {
  await ensure();
  const raw = await fs.readFile(LEADS_FILE, 'utf8');
  let all: Lead[] = [];
  try {
    all = JSON.parse(raw) as Lead[];
  } catch {
    all = [];
  }
  all.unshift(lead);
  await fs.writeFile(LEADS_FILE, JSON.stringify(all, null, 2), 'utf8');

  // bump project lead count + A/B stats
  const projects = await readProjects();
  const p = projects.find((x) => x.id === lead.projectId);
  if (p) {
    p.leadCount = (p.leadCount ?? 0) + 1;
    if (lead.variant && p.abStats) {
      p.abStats[lead.variant].leads += 1;
    }
    await writeProjects(projects);
  }
}

// --- Asset library ------------------------------------------------------

export async function readAssets(): Promise<AssetLibrary> {
  await ensure();
  const raw = await fs.readFile(ASSETS_FILE, 'utf8');
  try {
    return JSON.parse(raw) as AssetLibrary;
  } catch {
    return { brand: null, testimonials: [], certifications: [], cases: [], press: [] };
  }
}

export async function writeAssets(lib: AssetLibrary): Promise<void> {
  await ensure();
  await fs.writeFile(ASSETS_FILE, JSON.stringify(lib, null, 2), 'utf8');
}

// --- Events (lightweight analytics for A9 dashboard) -------------------

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

export async function appendEvent(ev: PageEvent): Promise<void> {
  await ensure();
  const raw = await fs.readFile(EVENTS_FILE, 'utf8');
  let all: PageEvent[] = [];
  try {
    all = JSON.parse(raw) as PageEvent[];
  } catch {
    all = [];
  }
  all.unshift(ev);
  // Cap at 50k events to keep the file manageable (PoC)
  if (all.length > 50_000) all = all.slice(0, 50_000);
  await fs.writeFile(EVENTS_FILE, JSON.stringify(all, null, 2), 'utf8');

  // bump counter on project for views
  if (ev.type === 'view') {
    const projects = await readProjects();
    const p = projects.find((x) => x.id === ev.projectId);
    if (p) {
      p.views = (p.views ?? 0) + 1;
      if (ev.variant && p.abStats) {
        p.abStats[ev.variant].views += 1;
      }
      await writeProjects(projects);
    }
  }
}

export async function readEvents(projectId?: string): Promise<PageEvent[]> {
  await ensure();
  const raw = await fs.readFile(EVENTS_FILE, 'utf8');
  let all: PageEvent[] = [];
  try {
    all = JSON.parse(raw) as PageEvent[];
  } catch {
    all = [];
  }
  return projectId ? all.filter((e) => e.projectId === projectId) : all;
}

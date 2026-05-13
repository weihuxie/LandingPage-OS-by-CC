/**
 * One-shot backfill: disable Vercel Deployment Protection on every
 * existing `lp-*` project under your team.
 *
 * Sibling to the per-deploy auto-disable wired into src/lib/deploy.ts
 * (commit 09f4b68, 2026-05-13). That commit ensures *future* deploys
 * publish-to-public. This script handles the *historical* lp-* projects
 * that were deployed before the fix and still have team-default
 * Vercel SSO Protection inherited (the exact "daisy.liu hits login page"
 * symptom that motivated all of this).
 *
 * What this does:
 *   1. Paginate GET /v10/projects across your team (or personal account).
 *   2. For each project whose name starts with `lp-` (configurable):
 *      a. If both ssoProtection and passwordProtection are already null
 *         → skip (idempotent, no API call needed)
 *      b. Otherwise PATCH /v9/projects/{name} setting both to null.
 *   3. Print a per-project line + final summary.
 *
 * Usage (one-shot, run from your laptop — key never leaves it):
 *   VC_API_TOKEN=... VC_TEAM_ID=team_xxx npx tsx scripts/backfill-vercel-protection.ts
 *   VC_API_TOKEN=... VC_TEAM_ID=team_xxx npm run backfill:vercel-protection -- --dry-run
 *   VC_API_TOKEN=... npm run backfill:vercel-protection -- --prefix lp- --team team_xxx
 *
 * Default is APPLY (actually PATCH). Pass --dry-run to preview first.
 * Use --prefix to scope (default "lp-"). Use --team to override
 * VC_TEAM_ID env. Use --help for flag list.
 *
 * Exit codes:
 *   0  all matched projects either already off or PATCHed successfully
 *   1  some projects failed to PATCH (summary lists them)
 *   2  configuration / fatal error (missing token, etc.)
 */

const VERCEL_API = 'https://api.vercel.com';

const API_KEY = process.env.VC_API_TOKEN;
if (!API_KEY) {
  console.error('❌ VC_API_TOKEN env not set. Run with:');
  console.error('   VC_API_TOKEN=... VC_TEAM_ID=team_xxx npx tsx scripts/backfill-vercel-protection.ts');
  process.exit(2);
}

// ---------- CLI args ----------

function parseArgs(argv: string[]): {
  dryRun: boolean;
  prefix: string;
  teamId: string | undefined;
} {
  const out = {
    dryRun: false,
    prefix: 'lp-',
    teamId: process.env.VC_TEAM_ID,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--prefix') {
      out.prefix = argv[++i] ?? '';
      if (!out.prefix) throw new Error('--prefix requires a value');
    } else if (a === '--team') {
      out.teamId = argv[++i];
      if (!out.teamId) throw new Error('--team requires a team ID');
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: VC_API_TOKEN=... VC_TEAM_ID=... npx tsx scripts/backfill-vercel-protection.ts [options]

Disables Vercel Deployment Protection (ssoProtection + passwordProtection)
on every existing project matching the prefix.

Options:
  --dry-run              List projects that WOULD be patched; don't actually patch.
  --prefix <str>         Project name prefix to match. Default "lp-".
  --team <id>            Team ID. Overrides VC_TEAM_ID env. Omit for personal scope.
  -h, --help             Show this help.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${a} (use --help to list options)`);
    }
  }
  return out;
}

let args: ReturnType<typeof parseArgs>;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error('❌', (e as Error).message);
  process.exit(2);
}

// ---------- API helpers ----------

interface VercelProject {
  id: string;
  name: string;
  ssoProtection: unknown | null;
  passwordProtection: unknown | null;
}

interface ListResponse {
  projects: VercelProject[];
  pagination: { count: number; next: string | number | null };
}

async function listAllProjects(): Promise<VercelProject[]> {
  const all: VercelProject[] = [];
  let cursor: string | number | null = null;
  // Vercel: limit max is documented as up to 100. Use 100 to minimize round-trips.
  while (true) {
    const params = new URLSearchParams();
    params.set('limit', '100');
    // Server-side hint to narrow results — final filter is still client-side.
    params.set('search', args.prefix);
    if (args.teamId) params.set('teamId', args.teamId);
    if (cursor != null) params.set('from', String(cursor));
    const url = `${VERCEL_API}/v10/projects?${params.toString()}`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`list projects ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as ListResponse;
    if (Array.isArray(json.projects)) all.push(...json.projects);
    if (!json.pagination?.next) break;
    cursor = json.pagination.next;
  }
  return all;
}

async function patchProject(name: string): Promise<{ ok: true } | { ok: false; err: string }> {
  const qs = args.teamId ? `?teamId=${encodeURIComponent(args.teamId)}` : '';
  const url = `${VERCEL_API}/v9/projects/${encodeURIComponent(name)}${qs}`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ssoProtection: null,
        passwordProtection: null,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, err: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- Main ----------

function isProtected(p: VercelProject): boolean {
  return p.ssoProtection !== null || p.passwordProtection !== null;
}

async function main() {
  console.log(`\n  Vercel Deployment Protection backfill`);
  console.log(`  team:     ${args.teamId ?? '(personal scope)'}`);
  console.log(`  prefix:   "${args.prefix}"`);
  console.log(`  mode:     ${args.dryRun ? 'DRY RUN (no changes)' : 'APPLY (will PATCH)'}\n`);

  let projects: VercelProject[];
  try {
    projects = await listAllProjects();
  } catch (e) {
    console.error('❌ list projects failed:', e instanceof Error ? e.message : e);
    process.exit(2);
  }
  // Server-side `search` is substring-ish; enforce hard prefix client-side.
  const matched = projects.filter((p) => p.name.startsWith(args.prefix));
  const alreadyOff = matched.filter((p) => !isProtected(p));
  const stillOn = matched.filter(isProtected);

  console.log(`  scanned:        ${projects.length} project(s) matching "${args.prefix}*" on the server`);
  console.log(`  prefix-matched: ${matched.length} (server-side search is loose; this is the hard filter)`);
  console.log(`  already off:    ${alreadyOff.length}`);
  console.log(`  needs patch:    ${stillOn.length}\n`);

  if (alreadyOff.length > 0) {
    console.log(`  Skipping (already public):`);
    for (const p of alreadyOff) console.log(`    · ${p.name}`);
    console.log();
  }

  if (stillOn.length === 0) {
    console.log('  ✅ nothing to do — every matched project is already public.');
    return;
  }

  console.log(`  ${args.dryRun ? 'Would patch' : 'Patching'} ${stillOn.length} project(s):`);
  let patched = 0;
  let failed = 0;
  for (const p of stillOn) {
    const sso = p.ssoProtection !== null ? 'sso' : '';
    const pw = p.passwordProtection !== null ? 'pwd' : '';
    const what = [sso, pw].filter(Boolean).join('+');
    process.stdout.write(`    · ${p.name.padEnd(45)} (${what}) `);
    if (args.dryRun) {
      console.log('— would PATCH ssoProtection=null, passwordProtection=null');
      continue;
    }
    const r = await patchProject(p.name);
    if (r.ok) {
      console.log('✅ patched');
      patched++;
    } else {
      console.log(`❌ ${r.err}`);
      failed++;
    }
  }

  console.log();
  if (args.dryRun) {
    console.log(`  Dry run complete. Re-run without --dry-run to actually patch ${stillOn.length} project(s).`);
    return;
  }
  console.log(`  Done. patched=${patched}, failed=${failed}, skipped(already-off)=${alreadyOff.length}.`);
  if (failed > 0) {
    console.log(`  ⚠️  Some PATCHes failed. The deploy itself isn't affected, but those projects still have protection on.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('backfill failed:', e);
  process.exit(2);
});

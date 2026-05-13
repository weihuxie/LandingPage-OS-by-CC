/**
 * Vercel one-click deploy (PRD v5.1 §6).
 *
 * Platform-hosted token via VC_API_TOKEN env var; users never configure.
 *
 * History: this used to return a MOCK URL like `https://slug.mock-vercel.app`
 * when no VC_API_TOKEN was set, so "deploy" looked like it worked in local
 * dev without any credentials. In production that path was a 遮羞布: the
 * user clicked "Deploy", saw `https://slug.mock-vercel.app` open in a new
 * tab, and couldn't tell whether the deploy was real or fake. Now we
 * throw DeployRequiredError when the token is missing — the route handler
 * maps to 503 and the UI surfaces "Deploy requires VC_API_TOKEN" so the
 * operator knows exactly what's missing. For local-dev sanity, run against
 * a personal Vercel token rather than relying on a mock fallback.
 *
 * 2026-05 fix: after the deployment succeeds, PATCH the project to disable
 * both SSO Protection (Vercel Authentication) and Password Protection.
 * Without this, projects inherit team defaults — and Pro/Enterprise teams
 * default to "preview deployments require team login", which makes every
 * auto-created `lp-<slug>` landing page private to team members only.
 * Customers / public visitors trying to view the published landing page
 * hit Vercel's login page instead of the page (2026-05 user report:
 * daisy.liu@hand-china.com hit Vercel SSO when opening an lp-srm-* URL).
 *
 * Landing pages are public by intent — they're the whole product surface.
 * The PATCH is non-blocking: if it fails (network, perms, API drift) we
 * log and proceed, since the deployment itself already succeeded and
 * protection is a UX concern, not a correctness concern.
 *
 * Docs:
 *   - Deploy: https://vercel.com/docs/rest-api/endpoints/deployments#create-a-new-deployment
 *   - Update project: https://vercel.com/docs/rest-api/projects/update-an-existing-project
 */

import type { DeployRecord } from './types';
import { DeployRequiredError } from './errors';

const VERCEL_API = 'https://api.vercel.com';

export interface DeployInput {
  slug: string; // used as project name + URL segment
  html: string;
  teamId?: string; // optional Vercel team scope
}

export interface DeployResult extends DeployRecord {}

export async function deployToVercel(input: DeployInput): Promise<DeployResult> {
  // Note: Vercel reserves the VERCEL_* env var prefix for system variables,
  // so we use VC_API_TOKEN / VC_TEAM_ID for our platform-owned credentials.
  const token = process.env.VC_API_TOKEN;
  const teamId = input.teamId ?? process.env.VC_TEAM_ID;

  // Fail loud — no mock fallback. See function header comment.
  if (!token) {
    throw new DeployRequiredError('VC_API_TOKEN');
  }

  // Real Vercel deployment
  const body = {
    name: `lp-${input.slug}`.slice(0, 52), // Vercel project name constraint
    target: 'production' as const,
    projectSettings: {
      framework: null, // static site, no build step
      devCommand: null,
      buildCommand: null,
      outputDirectory: null,
      installCommand: null,
    },
    files: [
      {
        file: 'index.html',
        data: input.html,
      },
    ],
  };

  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const res = await fetch(`${VERCEL_API}/v13/deployments${qs}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      provider: 'vercel',
      url: '',
      deployedAt: Date.now(),
      status: 'error',
      errorMessage: `Vercel API ${res.status}: ${text.slice(0, 500)}`,
    };
  }

  const data = (await res.json()) as {
    id: string;
    url: string;
    readyState?: string;
    alias?: string[];
  };

  // Fire-and-log: disable deployment protection on the newly-created (or
  // pre-existing) project. By the time /v13/deployments returns 2xx, the
  // project named `body.name` exists in Vercel's records and is PATCHable.
  // Errors here don't block — the deployment itself succeeded; the user
  // can manually disable protection in the Vercel dashboard if this PATCH
  // failed (and we log the reason). See file header for the 2026-05
  // context that motivated this.
  await disableProjectProtection(body.name, token, teamId).catch((e) => {
    console.warn(
      `[deploy] disableProjectProtection threw unexpectedly for "${body.name}":`,
      e instanceof Error ? e.message : e,
    );
  });

  return {
    provider: 'vercel',
    url: `https://${data.url}`,
    deploymentId: data.id,
    deployedAt: Date.now(),
    status: data.readyState === 'READY' ? 'ready' : 'building',
  };
}

/**
 * PATCH a Vercel project to set both protection fields to `null`, which
 * the Vercel API documents as "disables protection entirely":
 *   - ssoProtection: null  → Vercel Authentication off
 *   - passwordProtection: null → password gate off
 *
 * Idempotent — safe to call on every deploy. If a user manually
 * re-enables protection in the Vercel dashboard between deploys, the
 * next deploy will reset it. That's the intended behavior: landing
 * pages should be public by default in this product. If someone needs a
 * specific lp-* project to STAY protected (e.g. a confidential preview
 * for a single client), they can fork the deploy flow.
 *
 * Non-throwing: errors are logged but not propagated. The deployment
 * already succeeded by the time this runs, and protection is a
 * UX/visibility concern, not a deployment correctness concern.
 *
 * @param projectName  Same name field sent to /v13/deployments. Vercel
 *                     accepts name OR id in the PATCH path.
 */
async function disableProjectProtection(
  projectName: string,
  token: string,
  teamId?: string,
): Promise<void> {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const url = `${VERCEL_API}/v9/projects/${encodeURIComponent(projectName)}${qs}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ssoProtection: null,
        passwordProtection: null,
      }),
    });
  } catch (e) {
    console.warn(
      `[deploy] disableProjectProtection network error for "${projectName}":`,
      e instanceof Error ? e.message : e,
    );
    return;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(
      `[deploy] disableProjectProtection ${res.status} for "${projectName}": ${text.slice(0, 300)}`,
    );
    return;
  }
  console.warn(
    `[deploy] disabled SSO + password protection on Vercel project "${projectName}"`,
  );
}

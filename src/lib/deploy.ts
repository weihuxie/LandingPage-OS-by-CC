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
 * Docs: https://vercel.com/docs/rest-api/endpoints/deployments#create-a-new-deployment
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

  return {
    provider: 'vercel',
    url: `https://${data.url}`,
    deploymentId: data.id,
    deployedAt: Date.now(),
    status: data.readyState === 'READY' ? 'ready' : 'building',
  };
}

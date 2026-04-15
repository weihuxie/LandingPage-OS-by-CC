/**
 * Vercel one-click deploy (PRD v5.1 §6).
 *
 * Platform-hosted token via VERCEL_TOKEN env var; users never configure.
 * If the token is missing, returns a mock URL so local/dev flows stay functional.
 *
 * Docs: https://vercel.com/docs/rest-api/endpoints/deployments#create-a-new-deployment
 */

import type { DeployRecord } from './types';

const VERCEL_API = 'https://api.vercel.com';

export interface DeployInput {
  slug: string; // used as project name + URL segment
  html: string;
  teamId?: string; // optional Vercel team scope
}

export interface DeployResult extends DeployRecord {}

export async function deployToVercel(input: DeployInput): Promise<DeployResult> {
  const token = process.env.VERCEL_TOKEN;
  const teamId = input.teamId ?? process.env.VERCEL_TEAM_ID;

  // Mock mode (no token) — returns a deterministic stub URL so the UX works
  // end-to-end without real credentials. Real production drops in a token.
  if (!token) {
    return {
      provider: 'mock',
      url: `https://${input.slug}.mock-vercel.app`,
      deploymentId: 'dpl_mock_' + input.slug,
      deployedAt: Date.now(),
      status: 'ready',
    };
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

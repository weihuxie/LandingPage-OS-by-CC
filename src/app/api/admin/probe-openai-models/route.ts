/**
 * GET /api/admin/probe-openai-models
 *
 * Diagnostic endpoint: hits the configured OPENAI_BASE_URL (or
 * api.openai.com if unset) at /v1/models with the current API key and
 * returns the raw catalog. Used by the admin LLM page to answer
 * "which model IDs is my gateway actually willing to serve" — critical
 * for KSP / Azure / other proxies where the activated model list
 * differs from what openai.com exposes.
 *
 * Behind the same admin gate as the rest of /api/admin/* (middleware
 * checks for ADMIN_PASSWORD-derived cookie). No POST body — purely
 * read-only probe.
 */
import { NextResponse } from 'next/server';
import { listOpenAIModels } from '@/lib/llm-openai';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const result = await listOpenAIModels();
    return NextResponse.json({
      ok: true,
      baseURL: result.baseURL,
      modelCount: result.models.length,
      // Sort newest-first by `created` (Unix seconds) when present so
      // the most recent activations show at the top — saves admin a
      // ctrl-F when the gateway returns 30+ legacy snapshots.
      models: [...result.models].sort((a, b) => (b.created ?? 0) - (a.created ?? 0)),
    });
  } catch (e: any) {
    // Surface the gateway's own error verbatim — that's exactly what
    // the admin needs to see (e.g. "model X not activated", "API key
    // invalid", "rate limit"). No status normalization here.
    const status: number = e?.status ?? 500;
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? String(e),
        status,
        // Some KSP/Azure errors carry a structured body; pass it through
        // so the UI can show the operator the gateway-specific code.
        details: e?.error ?? e?.response?.data ?? undefined,
      },
      { status: 200 }, // 200 so client always parses; ok=false is the signal
    );
  }
}

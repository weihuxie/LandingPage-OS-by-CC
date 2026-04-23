/**
 * Admin endpoint for the parallel-locale migration (P2 · CLAUDE.md §四 TODO #1).
 *
 *   POST /api/admin/migrate-locales?dryRun=1           — preview every page
 *   POST /api/admin/migrate-locales                     — apply to every page
 *   POST /api/admin/migrate-locales?pageId=xxx&dryRun=1 — preview one page
 *   POST /api/admin/migrate-locales?pageId=xxx          — apply to one page
 *
 * Auth: the admin cookie gate is enforced by middleware.ts for
 * `/api/admin/*`. This handler assumes the request already passed that
 * check — don't re-verify here or the routes diverge.
 *
 * Why POST for dry-runs too: the endpoint mutates state in the apply path
 * and we want the same URL shape for both. `?dryRun=1` reads KV but writes
 * nothing; easy to revoke or rate-limit later.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getLandingPage, readLandingPages } from '@/lib/storage';
import { applyPageMigration, planPageMigration } from '@/lib/migrate-parallel-locales';
import type { PageMigrationPlan } from '@/lib/migrate-parallel-locales';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';
  const pageId = url.searchParams.get('pageId');

  let targets;
  if (pageId) {
    const page = await getLandingPage(pageId);
    if (!page) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: `Page ${pageId} not found.` },
        { status: 404 },
      );
    }
    targets = [page];
  } else {
    targets = await readLandingPages();
  }

  const plans = targets.map(planPageMigration);
  const needWork = plans.filter((p) => !p.alreadyMigrated);

  const summary = {
    totalPagesExamined: plans.length,
    alreadyMigrated: plans.filter((p) => p.alreadyMigrated).length,
    needMigration: needWork.length,
    newSiblingsPlanned: needWork.reduce((n, p) => n + p.newSiblings.length, 0),
  };

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      summary,
      plans: plans.map(serializePlan),
    });
  }

  const applied: Array<{ pageId: string; groupId: string; newSiblingIds: string[] }> = [];
  const errors: Array<{ pageId: string; error: string }> = [];
  for (const plan of needWork) {
    try {
      await applyPageMigration(plan);
      applied.push({
        pageId: plan.pageId,
        groupId: plan.groupId,
        newSiblingIds: plan.newSiblings.map((s) => s.id),
      });
    } catch (e) {
      errors.push({
        pageId: plan.pageId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    dryRun: false,
    summary: {
      ...summary,
      applied: applied.length,
      failed: errors.length,
    },
    applied,
    errors,
  });
}

function serializePlan(plan: PageMigrationPlan) {
  return {
    pageId: plan.pageId,
    slug: plan.slug,
    alreadyMigrated: plan.alreadyMigrated,
    groupId: plan.groupId,
    primary: {
      id: plan.primaryUpdate.id,
      locale: plan.primaryUpdate.locale,
      defaultLocale: plan.primaryUpdate.defaultLocale,
    },
    newSiblings: plan.newSiblings.map((s) => ({
      id: s.id,
      locale: s.locale,
    })),
  };
}

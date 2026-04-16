import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { readLandingPages, writeLandingPages } from '@/lib/storage';
import { nanoid } from 'nanoid';
import type { LandingPage } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Debug endpoint: create a minimal page, write it to KV both through
 * the abstraction layer AND directly, then immediately read back.
 */
export async function POST(_: NextRequest) {
  const log: Record<string, any> = {};
  const testId = `test_${nanoid(6)}`;

  try {
    // Step 1: Read current state
    const before = await readLandingPages();
    log.beforeCount = before.length;
    log.beforeIds = before.map(p => p.id);

    // Step 2: Create a minimal test page
    const testPage: LandingPage = {
      id: testId,
      productId: 'test',
      slug: `test-${testId}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      purpose: 'main',
      name: 'Write Test',
      targetMarket: 'CN',
      defaultLocale: 'zh-CN',
      availableLocales: ['zh-CN'],
      cta: 'demo',
      audience: { industry: '', companySize: '', role: '', source: 'ads' },
      strategy: { audience: [], goal: [], narrative: [], local: [] },
      tone: 'saas',
      variants: { A: {}, B: {} },
      activeVariant: 'A',
      publishMode: 'single',
      theme: {},
      published: false,
      deploy: null,
      stats: {
        views: 0, leads: 0, byLocale: {},
        byVariantLocale: { A: {}, B: {} },
        abStats: { A: { views: 0, leads: 0 }, B: { views: 0, leads: 0 } },
      },
    };

    // Step 3: Write through abstraction
    const newList = [testPage, ...before];
    log.writingCount = newList.length;
    log.useKV = !!process.env.KV_REST_API_URL;
    await writeLandingPages(newList);
    log.writeComplete = true;

    // Step 4: Read back through abstraction
    const after = await readLandingPages();
    log.afterCount = after.length;
    log.afterIds = after.map(p => p.id);
    log.afterHasTest = after.some(p => p.id === testId);

    // Step 5: Read DIRECTLY from KV
    const rawKv = await kv.get('lp:v2:pages');
    const rawArr = Array.isArray(rawKv) ? rawKv : [];
    log.rawKvCount = rawArr.length;
    log.rawKvHasTest = rawArr.some((p: any) => p?.id === testId);

    // Step 6: Also try direct kv.set + kv.get to test KV itself
    await kv.set('lp:test-direct', { testId, ts: Date.now() });
    const directRead = await kv.get('lp:test-direct');
    log.directKvWriteRead = directRead;

    // Clean up: remove test page
    const cleaned = after.filter(p => p.id !== testId);
    await writeLandingPages(cleaned);
    log.cleaned = true;

  } catch (e: any) {
    log.error = { message: e?.message, stack: e?.stack?.slice(0, 500) };
  }

  return NextResponse.json(log);
}

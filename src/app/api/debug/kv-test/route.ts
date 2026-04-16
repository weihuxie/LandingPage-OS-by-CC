import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';

/**
 * Direct KV operation test: SET, GET, SADD, SMEMBERS on test keys.
 * Validates that Redis set operations work correctly.
 */
export async function POST(_: NextRequest) {
  const log: Record<string, any> = {};
  const testKey = 'lp:test:kv-ops';
  const testSetKey = 'lp:test:set-ops';

  try {
    // 1. Clean up from previous runs
    await kv.del(testKey);
    await kv.del(testSetKey);

    // 2. SET + GET
    await kv.set(testKey, { hello: 'world' });
    const got = await kv.get(testKey);
    log.setGet = { wrote: true, readBack: got };

    // 3. SADD + SMEMBERS
    const r1 = await kv.sadd(testSetKey, 'a');
    log.sadd1 = r1;
    const r2 = await kv.sadd(testSetKey, 'b');
    log.sadd2 = r2;
    const r3 = await kv.sadd(testSetKey, 'c');
    log.sadd3 = r3;
    const members = await kv.smembers(testSetKey);
    log.smembers = members;
    log.setSize = members?.length;

    // 4. Check actual page index
    const pageIds = await kv.smembers('lp:v2:page-ids');
    log.realPageIndex = pageIds;
    log.realPageIndexSize = pageIds?.length;

    // 5. Check product index
    const productIds = await kv.smembers('lp:v2:product-ids');
    log.realProductIndex = productIds;
    log.realProductIndexSize = productIds?.length;

    // 6. Check type of page index key
    const pageIndexType = await kv.type('lp:v2:page-ids');
    log.pageIndexKeyType = pageIndexType;

    // 7. Try to read a known page by direct key
    const knownId = pageIds?.[0];
    if (knownId) {
      const page = await kv.get('lp:v2:page:' + knownId);
      log.directPageRead = page ? { id: (page as any).id, slug: (page as any).slug } : null;
    }

    // Cleanup test keys
    await kv.del(testKey);
    await kv.del(testSetKey);
    log.cleanup = true;

  } catch (e: any) {
    log.error = { message: e?.message, stack: e?.stack?.slice(0, 300) };
  }

  return NextResponse.json(log);
}

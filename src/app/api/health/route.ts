import { NextResponse } from 'next/server';
import { providerStatus } from '@/lib/llm';
import { storageBackend } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return NextResponse.json({
    ok: true,
    llm: providerStatus(),
    storage: storageBackend(),
    timestamp: Date.now(),
  });
}

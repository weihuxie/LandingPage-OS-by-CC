import { NextResponse } from 'next/server';
import { providerStatus } from '@/lib/llm';
import { storageBackend } from '@/lib/storage';

export async function GET() {
  return NextResponse.json({
    ok: true,
    llm: providerStatus(),
    storage: storageBackend(),
    timestamp: Date.now(),
  });
}

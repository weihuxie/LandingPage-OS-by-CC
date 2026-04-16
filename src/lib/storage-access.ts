/**
 * Generic KV-or-FS accessors for small JSON payloads not yet first-class
 * in storage.ts (templates, temp state, etc.).
 */
import { promises as fs } from 'fs';
import path from 'path';
import { kv } from '@vercel/kv';

const USE_KV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
const DATA_DIR =
  process.env.DATA_DIR ??
  (process.env.VERCEL === '1' ? '/tmp/.data' : path.join(process.cwd(), '.data'));

function fsPath(key: string): string {
  return path.join(DATA_DIR, key.replace(/^lp:/, '').replace(/:/g, '_') + '.json');
}

export async function readRaw<T>(key: string, fallback: T): Promise<T> {
  if (USE_KV) {
    const v = (await kv.get<T>(key)) as T | null;
    return v ?? fallback;
  }
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(fsPath(key), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeRaw<T>(key: string, value: T): Promise<void> {
  if (USE_KV) {
    await kv.set(key, value);
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(fsPath(key), JSON.stringify(value, null, 2), 'utf8');
}

/**
 * KV-backed storage for auth tables (S1 of Summit 权限改造).
 *
 * Kept in a separate module from storage.ts on purpose — auth has a
 * different failure model (expiring tokens, one-time consumption) and
 * a different caller surface (middleware / edge), and growing storage.ts
 * past ~700 lines is already uncomfortable. `@vercel/kv` is shared.
 *
 * Consistency contract mirrors storage.ts:
 *   · Data keys first, index sets second — if index write fails, a
 *     read-path SCAN could self-heal, but for S1 we lean on the small
 *     scale (dozens of users, not millions) and keep it simple: one
 *     retry burst per op via withKVRetry, any unrecoverable failure
 *     throws and the caller decides.
 *   · FS fallback mirrors the v1 `.data/<key>.json` pattern so local
 *     dev without Redis works the same way — just slower.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { kv } from '@vercel/kv';
import type { User, Tenant, TenantMember, Invite, MagicLink, TenantRole } from './types';
import { StorageRequiredError } from './errors';
import { canonicalEmail } from './user-auth';

// --- Runtime detection (copy of storage.ts helpers; keep in sync) ------

function useKV(): boolean {
  // eslint-disable-next-line dot-notation
  return !!process.env['KV_REST_API_URL'] && !!process.env['KV_REST_API_TOKEN'];
}

function isVercel(): boolean {
  // eslint-disable-next-line dot-notation
  return process.env['VERCEL'] === '1';
}

function assertStorageOk(): void {
  if (isVercel() && !useKV()) {
    throw new StorageRequiredError();
  }
}

async function withKVRetry<T>(op: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await op();
    } catch (e) {
      lastErr = e;
      console.error(`[auth-kv] ${label} attempt ${i + 1}/${maxAttempts} failed:`, e);
      if (i === maxAttempts - 1) break;
      await new Promise((r) => setTimeout(r, Math.pow(2.5, i) * 100 + Math.random() * 50));
    }
  }
  throw lastErr;
}

// --- FS fallback (local dev only; Vercel path is guarded above) --------

const DATA_DIR = path.join(process.cwd(), '.data', 'auth');

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function fsReadJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const buf = await fs.readFile(path.join(DATA_DIR, file), 'utf-8');
    return JSON.parse(buf) as T;
  } catch (e: any) {
    if (e?.code === 'ENOENT') return fallback;
    throw e;
  }
}

async function fsWriteJson(file: string, data: unknown): Promise<void> {
  await ensureDir();
  await fs.writeFile(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// --- KV key shapes -----------------------------------------------------
//
// These are colon-separated so Upstash's web UI renders them as tree
// nodes — makes inspection during debugging painless. Don't add
// non-alphanum chars to the variable parts (token, userId, email) or
// the tree rendering breaks.

const K = {
  user: (id: string) => `user:${id}`,
  userByEmail: (email: string) => `user_email:${canonicalEmail(email)}`,
  userIndex: 'user_index',

  tenant: (id: string) => `tenant:${id}`,
  tenantIndex: 'tenant_index',

  member: (tenantId: string, userId: string) => `member:${tenantId}:${userId}`,
  tenantMembers: (tenantId: string) => `tenant_members:${tenantId}`,
  userTenants: (userId: string) => `user_tenants:${userId}`,

  invite: (token: string) => `invite:${token}`,
  tenantInvites: (tenantId: string) => `tenant_invites:${tenantId}`,

  magic: (token: string) => `magic:${token}`,
};

// --- Users -------------------------------------------------------------

export async function getUser(id: string): Promise<User | null> {
  assertStorageOk();
  if (useKV()) return (await kv.get<User>(K.user(id))) ?? null;
  const list = await fsReadJson<User[]>('users.json', []);
  return list.find((u) => u.id === id) ?? null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  assertStorageOk();
  const canon = canonicalEmail(email);
  if (useKV()) {
    const id = await kv.get<string>(K.userByEmail(canon));
    if (!id) return null;
    return await getUser(id);
  }
  const list = await fsReadJson<User[]>('users.json', []);
  return list.find((u) => u.email === canon) ?? null;
}

/**
 * Insert a new user. Caller must have already checked getUserByEmail
 * returned null — this function does NOT de-dup, because the magic-link
 * verify flow calls it inside a check-or-create race that's benign
 * (two clicks of the same magic link can race, but both produce the
 * same userId if we key on canonicalized email at that layer).
 */
export async function saveUser(user: User): Promise<User> {
  assertStorageOk();
  if (useKV()) {
    await withKVRetry(() => kv.set(K.user(user.id), user), `saveUser:${user.id}`);
    await withKVRetry(
      () => kv.set(K.userByEmail(user.email), user.id),
      `saveUser:email-idx:${user.email}`,
    );
    await withKVRetry(() => kv.sadd(K.userIndex, user.id), `saveUser:set-idx:${user.id}`);
    return user;
  }
  const list = await fsReadJson<User[]>('users.json', []);
  const idx = list.findIndex((u) => u.id === user.id);
  if (idx === -1) list.push(user);
  else list[idx] = user;
  await fsWriteJson('users.json', list);
  return user;
}

// --- Tenants -----------------------------------------------------------

export async function getTenant(id: string): Promise<Tenant | null> {
  assertStorageOk();
  if (useKV()) return (await kv.get<Tenant>(K.tenant(id))) ?? null;
  const list = await fsReadJson<Tenant[]>('tenants.json', []);
  return list.find((t) => t.id === id) ?? null;
}

export async function saveTenant(tenant: Tenant): Promise<Tenant> {
  assertStorageOk();
  if (useKV()) {
    await withKVRetry(() => kv.set(K.tenant(tenant.id), tenant), `saveTenant:${tenant.id}`);
    await withKVRetry(() => kv.sadd(K.tenantIndex, tenant.id), `saveTenant:idx:${tenant.id}`);
    return tenant;
  }
  const list = await fsReadJson<Tenant[]>('tenants.json', []);
  const idx = list.findIndex((t) => t.id === tenant.id);
  if (idx === -1) list.push(tenant);
  else list[idx] = tenant;
  await fsWriteJson('tenants.json', list);
  return tenant;
}

// --- Tenant members (user ↔ tenant join table) -------------------------

export async function getMember(tenantId: string, userId: string): Promise<TenantMember | null> {
  assertStorageOk();
  if (useKV()) return (await kv.get<TenantMember>(K.member(tenantId, userId))) ?? null;
  const list = await fsReadJson<TenantMember[]>('members.json', []);
  return list.find((m) => m.tenantId === tenantId && m.userId === userId) ?? null;
}

export async function addMember(member: TenantMember): Promise<TenantMember> {
  assertStorageOk();
  if (useKV()) {
    await withKVRetry(
      () => kv.set(K.member(member.tenantId, member.userId), member),
      `addMember:${member.tenantId}:${member.userId}`,
    );
    // Two reverse indexes so we can list "members of a tenant" and
    // "tenants this user belongs to" without scanning. Both are sadd
    // which is idempotent, so a duplicate call just overwrites cleanly.
    await withKVRetry(
      () => kv.sadd(K.tenantMembers(member.tenantId), member.userId),
      `addMember:tenant-idx:${member.tenantId}`,
    );
    await withKVRetry(
      () => kv.sadd(K.userTenants(member.userId), member.tenantId),
      `addMember:user-idx:${member.userId}`,
    );
    return member;
  }
  const list = await fsReadJson<TenantMember[]>('members.json', []);
  const idx = list.findIndex((m) => m.tenantId === member.tenantId && m.userId === member.userId);
  if (idx === -1) list.push(member);
  else list[idx] = member;
  await fsWriteJson('members.json', list);
  return member;
}

export async function listTenantsForUser(userId: string): Promise<Tenant[]> {
  assertStorageOk();
  if (useKV()) {
    const ids = (await kv.smembers(K.userTenants(userId))) ?? [];
    if (ids.length === 0) return [];
    const rows = await Promise.all(ids.map((id) => getTenant(id)));
    return rows.filter((t): t is Tenant => !!t);
  }
  const members = await fsReadJson<TenantMember[]>('members.json', []);
  const tenantIds = members.filter((m) => m.userId === userId).map((m) => m.tenantId);
  const tenants = await fsReadJson<Tenant[]>('tenants.json', []);
  return tenants.filter((t) => tenantIds.includes(t.id));
}

export async function listMembersForTenant(tenantId: string): Promise<TenantMember[]> {
  assertStorageOk();
  if (useKV()) {
    const userIds = (await kv.smembers(K.tenantMembers(tenantId))) ?? [];
    if (userIds.length === 0) return [];
    const rows = await Promise.all(userIds.map((uid) => getMember(tenantId, uid)));
    return rows.filter((m): m is TenantMember => !!m);
  }
  const list = await fsReadJson<TenantMember[]>('members.json', []);
  return list.filter((m) => m.tenantId === tenantId);
}

// --- Invites -----------------------------------------------------------

export async function getInvite(token: string): Promise<Invite | null> {
  assertStorageOk();
  if (useKV()) return (await kv.get<Invite>(K.invite(token))) ?? null;
  const list = await fsReadJson<Invite[]>('invites.json', []);
  return list.find((i) => i.token === token) ?? null;
}

export async function saveInvite(invite: Invite): Promise<Invite> {
  assertStorageOk();
  if (useKV()) {
    await withKVRetry(() => kv.set(K.invite(invite.token), invite), `saveInvite:${invite.token}`);
    await withKVRetry(
      () => kv.sadd(K.tenantInvites(invite.tenantId), invite.token),
      `saveInvite:tenant-idx:${invite.tenantId}`,
    );
    return invite;
  }
  const list = await fsReadJson<Invite[]>('invites.json', []);
  const idx = list.findIndex((i) => i.token === invite.token);
  if (idx === -1) list.push(invite);
  else list[idx] = invite;
  await fsWriteJson('invites.json', list);
  return invite;
}

export async function listInvitesForTenant(tenantId: string): Promise<Invite[]> {
  assertStorageOk();
  if (useKV()) {
    const tokens = (await kv.smembers(K.tenantInvites(tenantId))) ?? [];
    if (tokens.length === 0) return [];
    const rows = await Promise.all(tokens.map((t) => getInvite(t)));
    return rows.filter((i): i is Invite => !!i);
  }
  const list = await fsReadJson<Invite[]>('invites.json', []);
  return list.filter((i) => i.tenantId === tenantId);
}

// --- Magic links (one-time tokens) -------------------------------------

export async function getMagicLink(token: string): Promise<MagicLink | null> {
  assertStorageOk();
  if (useKV()) return (await kv.get<MagicLink>(K.magic(token))) ?? null;
  const list = await fsReadJson<MagicLink[]>('magic.json', []);
  return list.find((m) => m.token === token) ?? null;
}

export async function saveMagicLink(link: MagicLink): Promise<MagicLink> {
  assertStorageOk();
  if (useKV()) {
    // Set with TTL so expired links get garbage-collected by Upstash
    // automatically — 15min + 1min buffer for clock skew. Matches the
    // app-level `expiresAt` check so we don't leak a token whose KV
    // TTL lasts longer than our verifier would accept.
    const ttlSec = Math.max(60, Math.ceil((link.expiresAt - Date.now()) / 1000) + 60);
    await withKVRetry(
      () => kv.set(K.magic(link.token), link, { ex: ttlSec }),
      `saveMagicLink:${link.token}`,
    );
    return link;
  }
  const list = await fsReadJson<MagicLink[]>('magic.json', []);
  const idx = list.findIndex((m) => m.token === link.token);
  if (idx === -1) list.push(link);
  else list[idx] = link;
  await fsWriteJson('magic.json', list);
  return link;
}

/**
 * Atomic-ish one-time consume: read, check usedAt, write back with
 * usedAt set. KV is single-region with sequential reads, so the race
 * window is small; we still mitigate by having saveMagicLink write
 * under TTL so stale clicks after the TTL can't re-trigger a flow even
 * on race. If this ever needs to be rock-solid (e.g. wire transfer
 * class), swap to SETNX + expiring sentinel key.
 */
export async function consumeMagicLink(token: string): Promise<MagicLink | null> {
  const link = await getMagicLink(token);
  if (!link) return null;
  if (link.usedAt) return null; // already consumed
  if (link.expiresAt < Date.now()) return null;
  const consumed: MagicLink = { ...link, usedAt: Date.now() };
  await saveMagicLink(consumed);
  return consumed;
}

// --- Convenience: new-user id / tenant id ------------------------------

/**
 * Human-debuggable id. `usr_` / `tnt_` prefix makes it visually obvious
 * in logs and KV explorer what kind of object you're looking at. Short
 * random suffix (10 base32 chars = ~50 bits) is fine at our scale.
 */
export function newId(prefix: 'usr' | 'tnt'): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  const b32 = Array.from(buf)
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 10);
  return `${prefix}_${b32}`;
}

// --- Defaults ----------------------------------------------------------

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days (locked 2026-04-21)
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 min

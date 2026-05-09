/**
 * API-UPLOAD-* · /api/assets/upload route tests.
 *
 * Covers from audit-2026-05.md §4.4:
 *   401  no cookie → 401 UNAUTHORIZED
 *   402  multipart missing `file` field → 400 BAD_REQUEST
 *   403  unsupported MIME (PDF) → 415 UNSUPPORTED_MEDIA_TYPE
 *   404  file > 5MB → 413 PAYLOAD_TOO_LARGE
 *   406  test env (no BLOB token, VERCEL!=1) → mode='inline', data: URL
 *   409  filename with special chars → uploaded successfully (sanitization
 *        observable in BLOB-mode pathname; in INLINE-mode just verify
 *        the route accepted the request without 500)
 *   410  image/svg+xml MIME → accepted
 *   411  image/heic MIME → 415 (not in allowlist)
 *
 * Deferred (require dev-server env control or server-side fetch mocking):
 *   405  BLOB_READ_WRITE_TOKEN set → mode='blob' branch (env doesn't
 *        propagate from test process to dev server)
 *   407  VERCEL=1 + no BLOB token → 503 UPLOAD_REQUIRED (same env issue)
 *   408  Vercel Blob put() throws → 500 UPLOAD_FAILED (server-side mock)
 *
 * IMPORTANT — Content-Type header dance:
 *   playwright.config.ts sets `extraHTTPHeaders: { 'content-type': 'application/json' }`
 *   for every request to keep the JSON CRUD specs short. multipart uploads
 *   need `multipart/form-data; boundary=...` instead, and a per-request
 *   `headers: { 'content-type': '' }` override doesn't unset the global
 *   value (Playwright merges instead of replaces). The fix is a fresh
 *   APIRequestContext WITH `extraHTTPHeaders: {}` explicitly empty —
 *   then Playwright's `multipart` option auto-generates the right header.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { loginAndEnsureTenant } from '../helpers/user-auth';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

// Tiny valid 1x1 PNG. Used wherever we need to upload "an image" without
// caring what's in it. Hex-encoded inline so the spec is self-contained.
const PNG_1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63600100000005000119c2bce80000000049454e44ae426082',
  'hex',
);

/**
 * Build a request context with EMPTY extraHTTPHeaders so multipart
 * requests get the right Content-Type. Pass `loggedIn=true` to perform
 * the magic-link flow on the new context first.
 */
async function makeMultipartContext(
  playwright: any,
  opts: { loggedIn: boolean },
): Promise<APIRequestContext> {
  const ctx = await playwright.request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: {}, // explicitly empty so multipart sets its own header
  });
  if (opts.loggedIn) {
    await loginAndEnsureTenant(ctx);
  }
  return ctx;
}

test.describe('API-UPLOAD · /api/assets/upload', () => {

  test('API-UPLOAD-401 · no cookie → 401 UNAUTHORIZED', async ({ playwright }) => {
    const ctx = await makeMultipartContext(playwright, { loggedIn: false });
    try {
      const res = await ctx.post('/api/assets/upload', {
        multipart: {
          file: { name: 'x.png', mimeType: 'image/png', buffer: PNG_1x1 },
        },
      });
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body.code).toBe('UNAUTHORIZED');
    } finally {
      await ctx.dispose();
    }
  });

  test('API-UPLOAD-402 · multipart missing `file` field → 400 BAD_REQUEST', async ({ playwright }) => {
    const ctx = await makeMultipartContext(playwright, { loggedIn: true });
    try {
      const res = await ctx.post('/api/assets/upload', {
        multipart: {
          // Wrong field name on purpose — server expects `file`.
          wrongField: { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('x') },
        },
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('BAD_REQUEST');
      expect(body.message).toContain('file');
    } finally {
      await ctx.dispose();
    }
  });

  test('API-UPLOAD-403 · unsupported MIME (application/pdf) → 415', async ({ playwright }) => {
    const ctx = await makeMultipartContext(playwright, { loggedIn: true });
    try {
      const res = await ctx.post('/api/assets/upload', {
        multipart: {
          file: { name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-x') },
        },
      });
      expect(res.status()).toBe(415);
      const body = await res.json();
      expect(body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(body.message).toContain('application/pdf');
    } finally {
      await ctx.dispose();
    }
  });

  test('API-UPLOAD-404 · file > 5MB → 413 PAYLOAD_TOO_LARGE', async ({ playwright }) => {
    const ctx = await makeMultipartContext(playwright, { loggedIn: true });
    try {
      const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
      const res = await ctx.post('/api/assets/upload', {
        multipart: {
          file: { name: 'big.png', mimeType: 'image/png', buffer: big },
        },
      });
      expect(res.status()).toBe(413);
      const body = await res.json();
      expect(body.code).toBe('PAYLOAD_TOO_LARGE');
      expect(body.message).toMatch(/5(\.0)? MB/);
    } finally {
      await ctx.dispose();
    }
  });

  test('API-UPLOAD-406 · test env (no BLOB token) → mode="inline", data: URL', async ({ playwright }) => {
    const ctx = await makeMultipartContext(playwright, { loggedIn: true });
    try {
      const res = await ctx.post('/api/assets/upload', {
        multipart: {
          file: { name: 'pixel.png', mimeType: 'image/png', buffer: PNG_1x1 },
        },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe('inline');
      expect(body.url).toMatch(/^data:image\/png;base64,/);
      expect(body.size).toBe(PNG_1x1.length);
      expect(body.contentType).toBe('image/png');
      expect(body.warning).toContain('BLOB_READ_WRITE_TOKEN');
    } finally {
      await ctx.dispose();
    }
  });

  test('API-UPLOAD-409 · filename with special chars → uploaded ok (sanitization is BLOB-mode contract)', async ({ playwright }) => {
    const ctx = await makeMultipartContext(playwright, { loggedIn: true });
    try {
      // Path-traversal-style chars; in BLOB mode, route's
      // `safeName.replace(/[^\w.\-]+/g, '_').slice(-80)` neutralizes them.
      // In INLINE branch (test env), we just verify the route accepted
      // the file and didn't 500 — sanitization isn't observable because
      // there's no pathname to inspect.
      const res = await ctx.post('/api/assets/upload', {
        multipart: {
          file: {
            name: '../../etc/passwd?inject=<script>.png',
            mimeType: 'image/png',
            buffer: PNG_1x1,
          },
        },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.contentType).toBe('image/png');
      // BLOB-mode would expose pathname for assertion: `expect(body.pathname).not.toMatch(/[\<\>\?]/)`
      // — defer to env-controlled BLOB-mode test (deferred per spec header).
    } finally {
      await ctx.dispose();
    }
  });

  test('API-UPLOAD-410 · image/svg+xml → accepted (allowlist hit)', async ({ playwright }) => {
    const ctx = await makeMultipartContext(playwright, { loggedIn: true });
    try {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
      const res = await ctx.post('/api/assets/upload', {
        multipart: {
          file: { name: 'icon.svg', mimeType: 'image/svg+xml', buffer: svg },
        },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.contentType).toBe('image/svg+xml');
    } finally {
      await ctx.dispose();
    }
  });

  test('API-UPLOAD-411 · image/heic → 415 (not in allowlist)', async ({ playwright }) => {
    const ctx = await makeMultipartContext(playwright, { loggedIn: true });
    try {
      const res = await ctx.post('/api/assets/upload', {
        multipart: {
          file: { name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.from('fake-heic') },
        },
      });
      expect(res.status()).toBe(415);
      const body = await res.json();
      expect(body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    } finally {
      await ctx.dispose();
    }
  });
});

import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { errorResponse, UploadRequiredError } from '@/lib/errors';
import { requireUserApi } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

// Upload handlers move bytes through Node, so the default 10s Hobby
// timeout is too tight for ~5MB images on slow connections. 30s leaves
// plenty of room while still failing loud on anything truly stuck.
export const maxDuration = 30;

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = /^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/;

/**
 * Binary asset upload endpoint.
 *
 * Behavior matrix (see also src/lib/errors.ts → UploadRequiredError docstring):
 *   - BLOB_READ_WRITE_TOKEN set       → Vercel Blob (`put()`), returns CDN URL
 *   - missing + local dev (VERCEL!=1) → data: URL inline fallback
 *   - missing + prod (VERCEL==1)      → 503 UPLOAD_REQUIRED
 *
 * Why not always data URL:
 *   - KV values have size limits; a 2MB page JSON that 500s is worse
 *     than a banner telling the operator to configure Blob.
 *   - Once base64 is embedded in module JSON, migrating it to a CDN
 *     later needs a data-rewrite pass.
 *
 * Why not always Blob (and refuse uploads locally without the token):
 *   - Makes local development annoying. Base64 inline is fine for
 *     iteration; it only fails when the page ships somewhere persistent.
 */
export async function POST(req: NextRequest) {
  try {
    return await postImpl(req);
  } catch (e) {
    if (e instanceof UploadRequiredError) {
      const { status, body } = errorResponse(e);
      return NextResponse.json(body, { status });
    }
    // Any other runtime failure (Vercel Blob 500, multipart parse error,
    // invalid token, rate-limited, etc.) — emit structured JSON instead
    // of letting Next.js swallow it into an opaque 500. The UploadButton
    // reads `message` to show something actionable in the UI.
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error('[upload] unexpected failure', e);
    return NextResponse.json(
      {
        error: 'upload-failed',
        code: 'UPLOAD_FAILED',
        message: msg || 'upload failed (unknown reason)',
      },
      { status: 500 },
    );
  }
}

async function postImpl(req: NextRequest) {
  const auth = await requireUserApi();
  if ('response' in auth) return auth.response;
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      {
        error: 'bad-request',
        code: 'BAD_REQUEST',
        message: 'multipart/form-data with a `file` field required',
      },
      { status: 400 },
    );
  }
  if (!ALLOWED_MIME.test(file.type)) {
    return NextResponse.json(
      {
        error: 'unsupported-media',
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: `Only image uploads are allowed (got ${file.type || 'unknown'}). Allowed: png, jpeg, gif, webp, svg`,
      },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: 'payload-too-large',
        code: 'PAYLOAD_TOO_LARGE',
        message: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; max ${MAX_BYTES / 1024 / 1024} MB`,
      },
      { status: 413 },
    );
  }

  const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
  const isProd = process.env.VERCEL === '1';

  // 1) Preferred: Vercel Blob (works locally if the dev has a token too)
  if (hasBlob) {
    const ts = Date.now();
    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'upload';
    const pathname = `landing-page-assets/${ts}-${safeName}`;
    const blob = await put(pathname, file, {
      access: 'public',
      contentType: file.type,
    });
    return NextResponse.json({
      mode: 'blob',
      url: blob.url,
      pathname: blob.pathname,
      size: file.size,
      contentType: file.type,
    });
  }

  // 2) Local-dev fallback → data: URL (the caller embeds this in the
  //    module JSON; the `warning` field lets the UI show a yellow notice).
  if (!isProd) {
    const buf = Buffer.from(await file.arrayBuffer());
    const dataUrl = `data:${file.type};base64,${buf.toString('base64')}`;
    return NextResponse.json({
      mode: 'inline',
      url: dataUrl,
      size: file.size,
      contentType: file.type,
      warning:
        'BLOB_READ_WRITE_TOKEN not set — image is embedded as base64. Set ' +
        'Vercel Blob (Storage → Blob) for CDN-backed uploads in production.',
    });
  }

  // 3) Prod without Blob → refuse up-front
  throw new UploadRequiredError();
}

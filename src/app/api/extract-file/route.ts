import { NextRequest, NextResponse } from 'next/server';
import { extractFileText } from '@/lib/file-read';
import { extractFromText } from '@/lib/extract';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // pdf-parse / mammoth need node, not edge

/**
 * Accept a single file and return an extracted context + raw text snippet.
 * The caller uses this synchronously during the wizard so users see facts
 * pulled from their uploaded PDF/DOCX.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'file too large (max 10 MB)' },
      { status: 413 },
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const text = await extractFileText(buffer, file.name);
  if (!text) {
    return NextResponse.json({
      error: 'unsupported-or-empty',
      filename: file.name,
      context: null,
    });
  }
  const context = extractFromText(text, 'file');
  return NextResponse.json({
    filename: file.name,
    textLength: text.length,
    context,
    // Don't ship full text back to client — client only needs facts
    preview: text.slice(0, 300),
  });
}

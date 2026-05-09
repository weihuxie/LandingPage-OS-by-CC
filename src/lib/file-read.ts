/**
 * Server-side file content extraction.
 * Supports PDF (pdf-parse), DOCX (mammoth), TXT/MD (raw).
 * Anything else → null (user sees warning in UI).
 */

export async function extractFileText(
  buffer: Buffer,
  filename: string,
): Promise<string | null> {
  const lower = filename.toLowerCase();
  try {
    if (lower.endsWith('.pdf')) {
      // Bypass `pdf-parse`'s top-level `index.js`, which has a debug-mode
      // `fs.readFileSync('./test/data/05-versions-space.pdf')` that fires
      // unconditionally under ESM (`!module.parent === !undefined === true`).
      // The deep `lib/pdf-parse.js` is the actual implementation and
      // doesn't carry that broken module-load side-effect — the standard
      // upstream workaround. Affects both raw-Node test environments
      // and any non-bundled ESM consumer.
      const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
      const data = await pdfParse(buffer);
      return sanitize(data.text);
    }
    if (lower.endsWith('.docx')) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return sanitize(result.value);
    }
    if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.csv')) {
      return sanitize(buffer.toString('utf8'));
    }
    // PPTX is harder — skip for MVP
    return null;
  } catch (e) {
    return null;
  }
}

function sanitize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 50_000); // cap at 50KB to keep cost bounded
}

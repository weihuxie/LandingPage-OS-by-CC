/**
 * Ambient declaration for the deep submodule import used in src/lib/
 * file-read.ts:
 *
 *   const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
 *
 * Why: `@types/pdf-parse` only ships types for the top-level `pdf-parse`
 * specifier. The deep submodule path has identical runtime signature but
 * no .d.ts → tsc throws TS7016 "implicitly has an 'any' type" on it. Vercel
 * runs typecheck during `next build` (not catch-all suppressed), so the
 * build fails on this line even though `npm run dev` is happy.
 *
 * The reason file-read.ts uses the deep path in the first place is
 * documented inline — pdf-parse's top-level index.js has a debug-mode
 * fs.readFileSync that fires unconditionally under ESM, breaking
 * `next build` and any non-bundled consumer. The deep path is the
 * upstream-blessed workaround.
 *
 * Mirror the top-level package's exported shape (default export = the
 * pdf-parse function returning {text, numpages, ...}). We don't need
 * the full signature — just enough that `data.text` typechecks.
 */
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }
  function pdfParse(buffer: Buffer | Uint8Array): Promise<PdfParseResult>;
  export default pdfParse;
}

'use client';
import { useState } from 'react';

export type UploadResult = {
  mode: 'blob' | 'inline';
  url: string;
  pathname?: string;
  size: number;
  contentType: string;
  warning?: string;
};

type Props = {
  /** Label text. Default: "📎 上传". */
  label?: string;
  /** MIME filter on the file chooser. Default: "image/*". */
  accept?: string;
  /** Hide the button entirely when upload is blocked upstream. */
  disabled?: boolean;
  /** Extra classes merged with the default compact button style. */
  className?: string;
  /** Invoked with the server response when upload succeeds. */
  onUpload: (result: UploadResult) => void;
  /**
   * Invoked on network / 4xx / 5xx. Callers that want to surface the
   * error inline can store it and render a red note near the field;
   * otherwise the component falls back to showing the message in a
   * small red text under itself.
   */
  onError?: (err: { code: string; message: string }) => void;
};

/**
 * Shared "upload an image" button used by MediaField (Hero / ProductShowcase
 * / Benefits / VideoEmbed) and LogosEditor (SocialProof logos) and the
 * testimonial avatar field.
 *
 * Why a shared component (added as part of Phase A):
 * Before this existed, only LogosEditor had an upload path — and it did
 * base64 inline directly in the component, bypassing any server. MediaField
 * shipped with only a URL input. Result: the same "put a picture here"
 * gesture behaved four different ways across the editor. This component
 * funnels every upload through POST /api/assets/upload so behaviour
 * (size limit, fallback, Blob vs data URL) is decided in one place.
 *
 * The server response includes `mode` ('blob' | 'inline') + optional
 * `warning` string — callers can pass that warning to the user if they
 * care (LogosEditor surfaces it via a footnote; MediaField logs it).
 */
export default function UploadButton({
  label = '📎 上传',
  accept = 'image/*',
  disabled,
  className = '',
  onUpload,
  onError,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onPick = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const input = ev.target;
    const f = input.files?.[0];
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch('/api/assets/upload', {
        method: 'POST',
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body?.message ?? `upload failed (${res.status})`;
        setErr(msg);
        onError?.({ code: body?.code ?? 'UPLOAD_FAILED', message: msg });
        return;
      }
      onUpload(body as UploadResult);
      if (body.warning) {
        // Soft warning (e.g. "inlined as base64, set Blob for prod")
        // — route it to console so developers notice without a modal.
        // eslint-disable-next-line no-console
        console.warn('[upload]', body.warning);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'upload failed';
      setErr(msg);
      onError?.({ code: 'NETWORK', message: msg });
    } finally {
      setBusy(false);
      input.value = ''; // allow re-picking the same file
    }
  };

  return (
    <span className="inline-flex flex-col items-start">
      <label
        className={`btn btn-secondary cursor-pointer whitespace-nowrap text-xs ${
          disabled || busy ? 'pointer-events-none opacity-50' : ''
        } ${className}`}
        title={disabled ? '上传不可用' : '从本地选图'}
      >
        {busy ? '⟳ 上传中…' : label}
        <input
          type="file"
          accept={accept}
          disabled={disabled || busy}
          className="hidden"
          onChange={onPick}
        />
      </label>
      {err && (
        <span className="mt-1 text-[11px] text-red-600" title={err}>
          {err.length > 60 ? err.slice(0, 60) + '…' : err}
        </span>
      )}
    </span>
  );
}

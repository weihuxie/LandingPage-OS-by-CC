'use client';
import { useState } from 'react';
import type { FormContent } from '@/lib/types';

const labels = {
  en: { name: 'Name', email: 'Work Email', company: 'Company', phone: 'Phone', message: 'What do you want to learn?', consent: "I've read and agree to the privacy policy", success: "Got it — we'll be in touch shortly." },
  'zh-CN': { name: '姓名', email: '工作邮箱', company: '公司', phone: '电话', message: '想了解什么？', consent: '我已阅读并同意隐私政策', success: '已收到，我们会尽快联系你。' },
  'zh-TW': { name: '姓名', email: '工作信箱', company: '公司', phone: '電話', message: '想了解什麼?', consent: '我已閱讀並同意隱私政策', success: '已收到,我們會盡快聯絡你。' },
  ja: { name: '氏名', email: 'ビジネスメール', company: '会社名', phone: '電話番号', message: 'ご相談内容', consent: 'プライバシーポリシーに同意します', success: '送信を受け付けました。担当よりご連絡します。' },
} as const;

export default function LeadFormClient({
  content,
  interactive,
  slug,
  locale,
  variant,
}: {
  content: FormContent;
  interactive: boolean;
  slug: string;
  locale: string;
  variant?: 'A' | 'B';
}) {
  const L = (labels as any)[locale] ?? labels.en;
  const [form, setForm] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // Inline validation errors. MVP silently disabled the submit button
  // whenever `!consent`, so users who skipped the checkbox saw a grayed
  // button with no explanation and reported "点了没反应" (Feishu #9).
  // Now the button is always enabled; on submit we validate and show an
  // inline message against the offending field.
  const [errors, setErrors] = useState<{ consent?: string; phone?: string }>({});
  // Loose international-ish phone regex — intentionally permissive. Too
  // strict loses real leads (台灣 0912, +81-90-xxxx, sales line extensions).
  // Too loose lets through "asdf". 7-20 chars of digits + common
  // separators is the sweet spot.
  const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

  // External mode: skip the inline form entirely, render a CTA card
  // linking to 飞书 / Typeform / Calendly. Fire a form_submit event on
  // click so lead-source attribution still works for this page.
  if (content.mode === 'external') {
    const href = content.externalUrl && content.externalUrl.trim() ? content.externalUrl : '';
    const isExternal = /^https?:\/\//i.test(href);
    const onClick = () => {
      if (!interactive) return;
      fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, type: 'form_submit', variant, locale }),
        keepalive: true,
      }).catch(() => {});
    };
    return (
      <div className="mx-auto max-w-3xl px-6 py-16" id="contact">
        <div className="rounded-3xl border border-ink-100 bg-white p-8 text-center shadow-soft sm:p-10">
          <h3 className="text-2xl font-semibold">{content.title}</h3>
          <p className="mt-2 text-ink-500">{content.subtitle}</p>
          {href ? (
            <a
              href={href}
              target={isExternal ? '_blank' : undefined}
              rel={isExternal ? 'noopener noreferrer' : undefined}
              onClick={onClick}
              className="mt-6 inline-block rounded-xl px-6 py-3 text-sm font-medium text-white transition"
              style={{ background: 'var(--brand)' }}
            >
              {content.submitLabel}
            </a>
          ) : (
            <div className="mt-6 text-xs text-ink-400">
              (External form URL not configured)
            </div>
          )}
        </div>
      </div>
    );
  }

  const update = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const consentError = {
    en: 'Please agree to the privacy policy to continue.',
    'zh-CN': '请先同意隐私政策再提交。',
    'zh-TW': '請先同意隱私政策再提交。',
    ja: 'プライバシーポリシーへの同意が必要です。',
  } as any;
  const phoneError = {
    en: 'Please enter a valid phone number.',
    'zh-CN': '请填写正确的电话号码。',
    'zh-TW': '請填寫正確的電話號碼。',
    ja: '有効な電話番号を入力してください。',
  } as any;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!interactive) return;
    const nextErrors: { consent?: string; phone?: string } = {};
    // Validate consent first — it's the most common reason submit "does
    // nothing" in QA, so surface it loudly (visible red text under the
    // checkbox) instead of the old silent disabled-button behavior.
    if (!consent) {
      nextErrors.consent = (consentError[locale] ?? consentError.en) as string;
    }
    // Phone is optional (only validate if present and the field is
    // actually in the form). Old submit path accepted any string so
    // leads like "asdf" went to KV without complaint.
    if (content.fields.includes('phone') && form.phone && form.phone.trim()) {
      if (!PHONE_RE.test(form.phone.trim())) {
        nextErrors.phone = (phoneError[locale] ?? phoneError.en) as string;
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    await fetch('/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, locale, variant, ...form }),
    });
    // also fire event
    fetch('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, type: 'form_submit', variant, locale }),
      keepalive: true,
    }).catch(() => {});
    setSubmitting(false);
    setDone(true);
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-16" id="contact">
      <div className="rounded-3xl border border-ink-100 bg-white p-8 shadow-soft sm:p-10">
        <h3 className="text-2xl font-semibold">{content.title}</h3>
        <p className="mt-1 text-ink-500">{content.subtitle}</p>

        {done ? (
          <div
            className="mt-6 rounded-2xl p-5 text-sm font-medium text-white"
            style={{ background: 'var(--brand)' }}
          >
            ✓ {L.success}
          </div>
        ) : (
          <form className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={onSubmit}>
            {content.fields.includes('name') && (
              <input
                className="input"
                placeholder={L.name}
                value={form.name ?? ''}
                onChange={(e) => update('name', e.target.value)}
                required
              />
            )}
            {content.fields.includes('email') && (
              <input
                className="input"
                type="email"
                placeholder={L.email}
                value={form.email ?? ''}
                onChange={(e) => update('email', e.target.value)}
                required
              />
            )}
            {content.fields.includes('company') && (
              <input
                className="input"
                placeholder={L.company}
                value={form.company ?? ''}
                onChange={(e) => update('company', e.target.value)}
              />
            )}
            {content.fields.includes('phone') && (
              <div>
                <input
                  className="input w-full"
                  type="tel"
                  inputMode="tel"
                  placeholder={L.phone}
                  value={form.phone ?? ''}
                  onChange={(e) => {
                    update('phone', e.target.value);
                    if (errors.phone) setErrors((x) => ({ ...x, phone: undefined }));
                  }}
                />
                {errors.phone && (
                  <div className="mt-1 text-xs text-red-600">{errors.phone}</div>
                )}
              </div>
            )}
            {content.fields.includes('message') && (
              <textarea
                className="input sm:col-span-2 min-h-[96px]"
                placeholder={L.message}
                value={form.message ?? ''}
                onChange={(e) => update('message', e.target.value)}
              />
            )}
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-xs text-ink-500">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => {
                    setConsent(e.target.checked);
                    if (errors.consent) setErrors((x) => ({ ...x, consent: undefined }));
                  }}
                />
                {L.consent}
              </label>
              {errors.consent && (
                <div className="mt-1 text-xs text-red-600">{errors.consent}</div>
              )}
            </div>
            <button
              type="submit"
              className="sm:col-span-2 rounded-xl px-5 py-3 text-sm font-medium text-white transition disabled:opacity-50"
              style={{ background: 'var(--brand)' }}
              disabled={!interactive || submitting}
            >
              {submitting ? '…' : content.submitLabel}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

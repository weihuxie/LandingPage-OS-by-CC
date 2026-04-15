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

  const update = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!interactive) return;
    if (!consent) return;
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
              <input
                className="input"
                placeholder={L.phone}
                value={form.phone ?? ''}
                onChange={(e) => update('phone', e.target.value)}
              />
            )}
            {content.fields.includes('message') && (
              <textarea
                className="input sm:col-span-2 min-h-[96px]"
                placeholder={L.message}
                value={form.message ?? ''}
                onChange={(e) => update('message', e.target.value)}
              />
            )}
            <label className="sm:col-span-2 flex items-center gap-2 text-xs text-ink-500">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              {L.consent}
            </label>
            <button
              type="submit"
              className="sm:col-span-2 rounded-xl px-5 py-3 text-sm font-medium text-white transition disabled:opacity-50"
              style={{ background: 'var(--brand)' }}
              disabled={!interactive || !consent || submitting}
            >
              {submitting ? '…' : content.submitLabel}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

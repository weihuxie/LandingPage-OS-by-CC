'use client';
/**
 * 右下角浮动反馈按钮（2026-05）。
 *
 * 设计选择 — 用飞书 Form 跳出 + URL prefill query string，而不是 API
 * 直写飞书 Base：
 *   · 零后端代码（不用建 /api/feedback）
 *   · 零运维（飞书 form 自管 availability + spam 防护 + 验证码）
 *   · 零 token 维护（不用 LARK app credentials）
 *   · prefill 让 UX 损失最小化（用户只填"内容/类型/严重度"3 项，
 *     其它 4 项 prefill 已自动填好）
 *
 * 飞书 Base / Form 由本仓库一次性手动建好（2026-05），下次重建参考
 * feedback-widget skill 的 7 步工作流（见 ~/.claude/skills/feedback-widget/）。
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * 飞书 form 公开分享链接 — anyone_editable 模式，匿名可填。
 * 重建后替换此常量即可。
 */
const FEISHU_FORM_URL =
  'https://onecontract-cloud.feishu.cn/share/base/shrcnhmAiUpH2zyWrvfhYRwWOHb';

/**
 * Build the Feishu form URL with prefill query string. Each prefill_*
 * key MUST be the form's field title verbatim (URL-encoded). The form
 * matches by title, not by field_id.
 *
 * Encoding: encodeURIComponent handles both the Chinese field name and
 * any special chars in the value (URL might have query strings of its
 * own, etc.).
 */
function buildPrefillUrl(args: {
  email: string | null;
  pageUrl: string;
  deployedAt: string;
}): string {
  const params = new URLSearchParams();
  // Field titles must match the form schema exactly. See feedback-widget
  // skill section 6 — option/title mismatches kill prefill silently.
  if (args.email) params.append('prefill_反馈人', args.email);
  params.append('prefill_页面URL', args.pageUrl);
  params.append('prefill_部署版本', args.deployedAt);
  // 提交时间 wants milliseconds timestamp as a string (Feishu doesn't
  // parse ISO dates for prefill — see schema-and-form.md §6 故障排查).
  params.append('prefill_提交时间', String(Date.now()));
  return `${FEISHU_FORM_URL}?${params.toString()}`;
}

interface SessionLite {
  user: { email: string } | null;
}

export default function FeedbackButton({ deployedAt }: { deployedAt: string }) {
  const t = useTranslations('feedback');
  const [email, setEmail] = useState<string | null>(null);

  // Best-effort fetch the email so prefill_反馈人 is set. If session is
  // missing (logged out) the button still works — user just fills email
  // manually in the form.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SessionLite | null) => {
        if (!cancelled && data?.user?.email) setEmail(data.user.email);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Build URL at click time (not at mount) so window.location is
    // current — user may have navigated within the SPA after mount.
    const url = buildPrefillUrl({
      email,
      pageUrl: typeof window !== 'undefined' ? window.location.href : '',
      deployedAt,
    });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-5 right-5 z-40 flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3.5 py-2 text-sm font-medium text-ink-700 shadow-lg transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
      aria-label={t('aria')}
      title={t('title')}
    >
      <span aria-hidden>💬</span>
      <span className="hidden sm:inline">{t('label')}</span>
    </button>
  );
}

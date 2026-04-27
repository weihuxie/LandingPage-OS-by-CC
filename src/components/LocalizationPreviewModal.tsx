'use client';
import { useEffect, useState } from 'react';
import type {
  LocalizationStrategy,
  LandingPage,
  PageLocale,
  MarketCode,
  ModuleType,
  StyleId,
} from '@/lib/types';
import { nativeLabel } from '@/lib/i18n-detect';
import { STYLE_PRESETS } from '@/lib/styles';
import IntroCard from './IntroCard';

const MARKETS: MarketCode[] = ['CN', 'TW', 'JP', 'US', 'EU', 'GLOBAL'];

/**
 * Localization strategy white-box preview (Phase H.2).
 * User clicks "+加日语" → modal fetches proposeLocalization() from server
 * → user reviews/edits → approves → parent handler POSTs to create locale.
 *
 * Answer to user's 2nd design question: "make localization decisions visible
 * and editable before generation, not after".
 */
export default function LocalizationPreviewModal({
  pageId,
  targetLocale,
  targetMarket,
  availableLocales,
  defaultSourceLocale,
  onApprove,
  onClose,
}: {
  pageId: string;
  targetLocale: PageLocale;
  targetMarket?: MarketCode;
  /**
   * Feishu #15 — if the page already has hydrated locales, offer the
   * user a choice between "inherit from an existing locale" (preserves
   * all manual edits: module order, disabled state, form schemas, media
   * refs) and "generate from scratch" (classic template + hydrate path).
   * When the list is empty or undefined the picker is hidden and the
   * from-scratch path is the only option.
   */
  availableLocales?: PageLocale[];
  defaultSourceLocale?: PageLocale;
  onApprove: (
    strategy: LocalizationStrategy,
    sourceLocale?: PageLocale,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [strategy, setStrategy] = useState<LocalizationStrategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Inheritance defaults ON when the page already has ≥1 hydrated locale.
  // Users who deliberately want a clean-slate regeneration can flip to
  // "from scratch" in the modal; everyone else gets structure-preserving
  // inheritance without having to opt in.
  const inheritableLocales = (availableLocales ?? []).filter(
    (l) => l !== targetLocale,
  );
  const [sourceLocale, setSourceLocale] = useState<PageLocale | null>(
    inheritableLocales.includes(defaultSourceLocale as PageLocale)
      ? (defaultSourceLocale as PageLocale)
      : inheritableLocales[0] ?? null,
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/pages/${pageId}/locales/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: targetLocale, market: targetMarket }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        setStrategy(d.strategy);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [pageId, targetLocale, targetMarket]);

  const submit = async () => {
    if (!strategy) return;
    setSubmitting(true);
    try {
      await onApprove(
        { ...strategy, approvedByUser: true },
        sourceLocale ?? undefined,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const regenerate = () => {
    setStrategy(null);
    setLoading(true);
    fetch(`/api/pages/${pageId}/locales/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: targetLocale, market: strategy?.targetMarket }),
    })
      .then((r) => r.json())
      .then((d) => {
        setStrategy(d.strategy);
        setLoading(false);
      });
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="card max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              为添加 {nativeLabel(targetLocale)} 版本定制本地化策略
            </h2>
            <p className="mt-1 text-xs text-ink-500">
              这些选择决定这个语言版本的风格、信任点、CTA 强度、表单字段 —
              下一步才生成模块内容。可编辑，可以重来。
            </p>
          </div>
          <button
            className="text-ink-500 hover:text-ink-900"
            onClick={onClose}
            disabled={submitting}
          >
            ×
          </button>
        </div>

        {/* 小白指引 — 第一次添加语言时关键的几个心智 */}
        <div className="mb-3">
          <IntroCard storageKey="localize-modal" title="本地化 ≠ 翻译">
            <ul className="list-disc space-y-1 pl-4">
              <li>
                <strong>每个 locale 是独立的页面</strong> — 生成后你可以单独改 Hero / 留资字段，
                互不影响。源语言改了不会自动同步过来。
              </li>
              <li>
                <strong>"继承自 X"</strong> 会保留来源版本的模块顺序 / 隐藏 / 表单字段 / 图片，
                只把文案翻译过来。<strong>"从头生成"</strong> 按目标市场默认模板重新写一遍 ——
                CN 偏短手机号字段，EU 加 GDPR 同意，JP 多正式语等。
              </li>
              <li>
                LLM 会根据目标市场调整风格和信任点（CN/JP/US/EU 各不一样），
                <strong>不只是直译</strong>。下面这些选项可改、可重新生成。
              </li>
              <li>
                生成后这个 locale 默认 <strong>未发布</strong>，需要你显式点"发布"才上线。
              </li>
            </ul>
          </IntroCard>
        </div>

        {loading || !strategy ? (
          <div className="py-16 text-center text-sm text-ink-500">AI 分析中…</div>
        ) : (
          <div className="space-y-4">
            {/* Inheritance source (Feishu #15).
                Hidden when no other locales exist yet — the first locale
                has nothing to inherit from. */}
            {inheritableLocales.length > 0 && (
              <Row label="📋 来源版本">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="input text-sm"
                    value={sourceLocale ?? ''}
                    onChange={(e) =>
                      setSourceLocale(
                        (e.target.value || null) as PageLocale | null,
                      )
                    }
                  >
                    {inheritableLocales.map((l) => (
                      <option key={l} value={l}>
                        继承自 {nativeLabel(l)}
                      </option>
                    ))}
                    <option value="">从头生成（不继承）</option>
                  </select>
                  <span className="text-[11px] text-ink-500">
                    {sourceLocale
                      ? '保留来源版本的模块顺序 / 隐藏 / 表单字段 / 图片，仅翻译文案'
                      : '按默认模板重新生成 — 你在其他语言里做的手动编辑不会保留'}
                  </span>
                </div>
              </Row>
            )}

            {/* Target market */}
            <Row label="目标市场">
              <select
                className="input text-sm"
                value={strategy.targetMarket ?? 'GLOBAL'}
                onChange={(e) =>
                  setStrategy({ ...strategy, targetMarket: e.target.value as MarketCode })
                }
              >
                {MARKETS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="ml-2 text-[11px] text-ink-500">
                语言 ≠ 市场 · 比如英语访客访问日本站 → locale=en / market=JP
              </span>
            </Row>

            {/* Audience nuances */}
            <ListRow
              label="🎯 受众调整"
              items={strategy.audienceNuances}
              onChange={(x) => setStrategy({ ...strategy, audienceNuances: x })}
            />

            {/* Trust triggers */}
            <ListRow
              label="🏛️  信任触发"
              items={strategy.trustTriggers}
              onChange={(x) => setStrategy({ ...strategy, trustTriggers: x })}
            />

            {/* Narrative notes */}
            <ListRow
              label="💬 叙事调整"
              items={strategy.narrativeNotes}
              onChange={(x) => setStrategy({ ...strategy, narrativeNotes: x })}
            />

            {/* CTA intensity */}
            <Row label="🔴 CTA 强度">
              <div className="flex gap-1 rounded-lg border border-ink-100 p-0.5 text-[11px]">
                {(['restrained', 'moderate', 'strong'] as const).map((x) => (
                  <button
                    key={x}
                    onClick={() => setStrategy({ ...strategy, ctaIntensity: x })}
                    className={`flex-1 rounded px-3 py-1 ${
                      strategy.ctaIntensity === x
                        ? 'bg-ink-900 text-white'
                        : 'text-ink-500'
                    }`}
                  >
                    {x === 'restrained' ? '克制' : x === 'moderate' ? '中等' : '强烈'}
                  </button>
                ))}
              </div>
            </Row>

            {/* Style preset */}
            <Row label="🎨 视觉风格">
              <select
                className="input text-sm"
                value={strategy.recommendedStyle}
                onChange={(e) =>
                  setStrategy({
                    ...strategy,
                    recommendedStyle: e.target.value as StyleId,
                  })
                }
              >
                {Object.values(STYLE_PRESETS).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Row>

            {/* Form changes */}
            <Row label="📝 表单字段变更">
              <div className="text-xs">
                {strategy.formChanges.add.length > 0 && (
                  <div>
                    <span className="text-brand-700">+ 添加:</span>{' '}
                    {strategy.formChanges.add.join(', ')}
                  </div>
                )}
                {strategy.formChanges.remove.length > 0 && (
                  <div>
                    <span className="text-red-500">- 移除:</span>{' '}
                    {strategy.formChanges.remove.join(', ')}
                  </div>
                )}
                {strategy.formChanges.add.length === 0 &&
                  strategy.formChanges.remove.length === 0 && (
                    <span className="text-ink-500">无变更</span>
                  )}
              </div>
            </Row>

            {/* Module order */}
            {strategy.recommendedModuleOrder && (
              <Row label="⚙️  模块顺序">
                <div className="text-xs text-ink-500">
                  {strategy.recommendedModuleOrder.join(' → ')}
                </div>
              </Row>
            )}

            {/* Media gaps */}
            {strategy.mediaGaps.length > 0 && (
              <div>
                <div className="label">🎬 媒体资产缺口</div>
                <div className="mt-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
                  <div className="mb-2 font-medium text-amber-900">
                    以下 {strategy.mediaGaps.length} 个资产没有 {nativeLabel(targetLocale)} 版本，将回落到默认:
                  </div>
                  <ul className="space-y-1">
                    {strategy.mediaGaps.map((g, i) => (
                      <li key={i} className="flex items-center gap-2 text-amber-800">
                        <span className="pill text-[10px] border-amber-200 bg-white">
                          {g.suggestedAction === 'upload-localized'
                            ? '需上传本地化版本'
                            : g.suggestedAction === 'ai-translate-caption'
                              ? 'AI 翻译字幕'
                              : '复用默认'}
                        </span>
                        <span>{g.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Testimonial / certification filters (auto-applied — show as info) */}
            <div className="rounded-xl border border-ink-100 bg-ink-100/30 p-3 text-xs text-ink-500">
              <div>
                🗣️ 证言会优先选{' '}
                <span className="font-medium text-ink-900">
                  原语言 = {nativeLabel(targetLocale)}
                </span>{' '}
                的条目，其次选市场匹配 {strategy.targetMarket} 的条目
              </div>
              <div className="mt-1">
                📜 认证会展示市场 = {strategy.targetMarket} 的合规素材
              </div>
            </div>
          </div>
        )}

        {!loading && strategy && (
          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={regenerate}
              className="btn btn-secondary text-xs"
              disabled={submitting}
            >
              ↻ 重新分析
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="btn btn-ghost text-xs"
                disabled={submitting}
              >
                取消
              </button>
              <button
                onClick={submit}
                className="btn btn-primary text-xs"
                disabled={submitting}
              >
                {submitting ? '生成中…' : '确认并生成 →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function ListRow({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span
              className="mt-1.5 inline-block h-1 w-1 flex-shrink-0 rounded-full"
              style={{ background: 'var(--brand, #4861ff)' }}
            />
            <textarea
              rows={Math.max(1, Math.ceil(it.length / 60))}
              value={it}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
              className="input flex-1 text-xs !py-1"
            />
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="text-xs text-ink-500 hover:text-red-600"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() => onChange([...items, ''])}
          className="text-[11px] text-brand-700 hover:underline"
        >
          + 添加一条
        </button>
      </div>
    </div>
  );
}

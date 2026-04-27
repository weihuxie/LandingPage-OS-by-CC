'use client';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type {
  PageModule,
  HeroContent,
  SocialProofContent,
  SocialProofLogo,
  PainContent,
  SolutionContent,
  BenefitsContent,
  UseCaseContent,
  TestimonialContent,
  FAQContent,
  CTAContent,
  FormContent,
  FormFieldKey,
  FormFieldSpec,
  ProductShowcaseContent,
  VideoEmbedContent,
  MediaRef,
  AssetLibrary,
} from '@/lib/types';
import { resolveSocialProofLogo } from '@/lib/types';
import MediaField from './MediaField';
import UploadButton from './UploadButton';
import PageFontPicker from './PageFontPicker';

type PageFontControl = {
  value: string | null;
  onChange: (presetId: string | null) => void;
};

type Props = {
  module: PageModule;
  onChange: (patch: Partial<PageModule>) => void;
  onRegenerate: () => void;
  // When Claude isn't configured (no ANTHROPIC_API_KEY), the regenerate
  // button is greyed out + carries a tooltip instead of letting the user
  // click and then see a 503 banner. Undefined = no gating info from
  // parent (treat as "allow" — backward compat).
  regenerateDisabledReason?: string | null;
  /** Page-level font picker control. Plumbed into HeroEditor (renders
   *  right under 标题字号) so the user can debug typography next to
   *  the heading-size selector. Other module editors don't surface
   *  this — Settings modal still has the same control as a fallback
   *  entry point for any module. */
  pageFont?: PageFontControl;
};

export default function ModuleEditor({
  module,
  onChange,
  onRegenerate,
  regenerateDisabledReason,
  pageFont,
}: Props) {
  const t = useTranslations();

  const setContent = (c: any) => onChange({ content: c });

  return (
    <div className="space-y-4">
      <div>
        <div className="label">Module</div>
        <div className="mt-1 text-sm font-semibold">
          {t(`editor.moduleTypes.${module.type}`)}
        </div>
        <div className="mt-0.5 text-xs text-ink-500">
          {t(`editor.moduleRoles.${module.type}`)}
        </div>
      </div>
      <button
        className="btn btn-secondary w-full text-xs disabled:cursor-not-allowed disabled:opacity-50"
        onClick={onRegenerate}
        disabled={!!regenerateDisabledReason}
        title={regenerateDisabledReason ?? undefined}
      >
        ↻ {t('editor.regenerateCopy')}
      </button>

      <div className="space-y-3">
        {module.type === 'hero' && (
          <HeroEditor
            c={module.content as HeroContent}
            setC={setContent}
            pageFont={pageFont}
          />
        )}
        {module.type === 'productShowcase' && (
          <ProductShowcaseEditor c={module.content as ProductShowcaseContent} setC={setContent} />
        )}
        {module.type === 'videoEmbed' && (
          <VideoEmbedEditor c={module.content as VideoEmbedContent} setC={setContent} />
        )}
        {module.type === 'socialProof' && <SocialProofEditor c={module.content as SocialProofContent} setC={setContent} />}
        {module.type === 'pain' && <PainEditor c={module.content as PainContent} setC={setContent} />}
        {module.type === 'solution' && <SolutionEditor c={module.content as SolutionContent} setC={setContent} />}
        {module.type === 'benefits' && <BenefitsEditor c={module.content as BenefitsContent} setC={setContent} />}
        {module.type === 'useCase' && <UseCaseEditor c={module.content as UseCaseContent} setC={setContent} />}
        {module.type === 'testimonial' && <TestimonialEditor c={module.content as TestimonialContent} setC={setContent} />}
        {module.type === 'faq' && <ListItemsEditor c={module.content as FAQContent} setC={setContent} itemFields={['q', 'a']} />}
        {module.type === 'cta' && <CTAEditor c={module.content as CTAContent} setC={setContent} />}
        {module.type === 'form' && <FormEditor c={module.content as FormContent} setC={setContent} />}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {multiline ? (
        <textarea
          className="input mt-1 min-h-[72px]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="input mt-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function LayoutPicker<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; name: string; desc: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <div className="grid grid-cols-1 gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`rounded-xl border p-2.5 text-left text-xs transition ${
              value === o.id ? 'border-brand-300 bg-brand-50' : 'border-ink-100 hover:bg-ink-100/40'
            }`}
          >
            <div className="font-medium">{o.name}</div>
            <div className="mt-0.5 text-[11px] text-ink-500">{o.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

const HERO_LAYOUTS: { id: import('@/lib/types').HeroLayout; name: string; desc: string }[] = [
  { id: 'split', name: '左文右图', desc: '经典双栏，文案左 + 截图/视频右。适合有产品截图的 SaaS。' },
  { id: 'centered', name: '居中 + 下方大图', desc: '标题居中，下方铺全宽截图。Linear / Notion 风。' },
  { id: 'video-bg', name: '品牌满屏', desc: '渐变色填满，文案叠加居中。适合品牌型/没有截图时。' },
  { id: 'bold-stat', name: '大数字主导', desc: '用超大数字/指标占视觉主位。适合 ROI / 效率类强数字卖点。' },
  { id: 'editorial', name: '编辑分栏', desc: '衬线标题 + 黑白 + 分栏感。适合合规/权威/研究类叙事。' },
];

const FONT_SCALES: { id: import('@/lib/types').FontScale; name: string }[] = [
  { id: 'sm', name: '小' },
  { id: 'md', name: '中' },
  { id: 'lg', name: '大' },
  { id: 'xl', name: '特大' },
];

function FontScalePicker({
  value,
  onChange,
}: {
  value: import('@/lib/types').FontScale;
  onChange: (v: import('@/lib/types').FontScale) => void;
}) {
  return (
    <div>
      <div className="label mb-1.5">标题字号</div>
      <div className="flex gap-1 rounded-lg border border-ink-100 p-0.5 text-xs">
        {FONT_SCALES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.id)}
            className={`flex-1 rounded-md px-2 py-1 transition ${
              value === s.id ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}

const BENEFITS_LAYOUTS: { id: import('@/lib/types').BenefitsLayout; name: string; desc: string }[] = [
  { id: 'cards', name: '三列卡片', desc: '每个收益一张卡，简洁并列。适合 3 个核心卖点。' },
  { id: 'alternating', name: '左右交替', desc: '文案 + 配图交替排版。有截图时视觉更强。' },
  { id: 'compact', name: '紧凑列表', desc: '序号 + 标题 + 一行描述。信息密度高，适合 CN 市场。' },
];

function HeroEditor({
  c,
  setC,
  pageFont,
}: {
  c: HeroContent;
  setC: (c: HeroContent) => void;
  pageFont?: PageFontControl;
}) {
  return (
    <>
      <LayoutPicker
        label="布局"
        value={c.layout ?? 'split'}
        options={HERO_LAYOUTS}
        onChange={(v) => setC({ ...c, layout: v })}
      />
      <FontScalePicker
        value={c.fontScale ?? 'md'}
        onChange={(v) => setC({ ...c, fontScale: v })}
      />
      {/* Per UX request: page-level font picker sits right under 标题字号
          so the user can debug typography while editing the Hero. Page-
          scoped not Hero-scoped — same control as Settings modal,
          shared via page.fontPresetId. Only renders if parent provides
          pageFont prop (i.e. when this Hero is inside a real LandingPage
          context, not e.g. a fixture preview). */}
      {pageFont && (
        <PageFontPicker value={pageFont.value} onChange={pageFont.onChange} />
      )}
      <Field label="Eyebrow" value={c.eyebrow} onChange={(v) => setC({ ...c, eyebrow: v })} />
      <Field label="Headline" value={c.headline} onChange={(v) => setC({ ...c, headline: v })} multiline />
      <Field label="Subhead" value={c.subhead} onChange={(v) => setC({ ...c, subhead: v })} multiline />
      <Field label="Primary CTA" value={c.primaryCta} onChange={(v) => setC({ ...c, primaryCta: v })} />
      {/* href 留空 → 默认滚动到 #contact 表单；填 https://... 则打开外链 (新标签) */}
      <Field
        label="Primary CTA 链接 (留空 = 滚到表单 #contact)"
        value={c.primaryCtaHref ?? ''}
        onChange={(v) => setC({ ...c, primaryCtaHref: v || undefined })}
      />
      <Field
        label="Secondary CTA 文案 (可选)"
        value={c.secondaryCta ?? ''}
        onChange={(v) => setC({ ...c, secondaryCta: v || undefined })}
      />
      <Field
        label="Secondary CTA 链接 (留空 = 滚到 #contact)"
        value={c.secondaryCtaHref ?? ''}
        onChange={(v) => setC({ ...c, secondaryCtaHref: v || undefined })}
      />
      <Field label="Bullets (one per line)" value={c.bullets.join('\n')} onChange={(v) => setC({ ...c, bullets: v.split('\n').filter(Boolean) })} multiline />
      <MediaField
        label="Hero 主视觉 (可选 · 图片或视频)"
        value={c.media}
        onChange={(m) => setC({ ...c, media: m })}
      />
    </>
  );
}

function BenefitsEditor({ c, setC }: { c: BenefitsContent; setC: (c: BenefitsContent) => void }) {
  return (
    <>
      <LayoutPicker
        label="布局"
        value={c.layout ?? 'cards'}
        options={BENEFITS_LAYOUTS}
        onChange={(v) => setC({ ...c, layout: v })}
      />
      <Field label="Title" value={c.title} onChange={(v) => setC({ ...c, title: v })} />
      <div className="label">Items</div>
      <div className="space-y-3">
        {c.items.map((it, i) => (
          <div key={i} className="rounded-xl border border-ink-100 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-xs text-ink-500">#{i + 1}</div>
              <button
                onClick={() => setC({ ...c, items: c.items.filter((_, j) => j !== i) })}
                className="text-xs text-ink-500 hover:text-red-600"
              >
                remove
              </button>
            </div>
            <Field label="Title" value={it.title} onChange={(v) => { const next = [...c.items]; next[i] = { ...it, title: v }; setC({ ...c, items: next }); }} />
            <Field label="Body" value={it.body} onChange={(v) => { const next = [...c.items]; next[i] = { ...it, body: v }; setC({ ...c, items: next }); }} multiline />
            {(c.layout === 'alternating') && (
              <div className="mt-2">
                <MediaField
                  label="配图 (交替布局用)"
                  value={it.media}
                  onChange={(m) => { const next = [...c.items]; next[i] = { ...it, media: m }; setC({ ...c, items: next }); }}
                />
              </div>
            )}
          </div>
        ))}
        <button
          onClick={() => setC({ ...c, items: [...c.items, { title: '', body: '' }] })}
          className="btn btn-secondary w-full text-xs"
        >
          + Add item
        </button>
      </div>
    </>
  );
}

function ProductShowcaseEditor({
  c,
  setC,
}: {
  c: ProductShowcaseContent;
  setC: (c: ProductShowcaseContent) => void;
}) {
  return (
    <>
      <Field label="Title" value={c.title} onChange={(v) => setC({ ...c, title: v })} />
      <Field label="Subtitle" value={c.subtitle ?? ''} onChange={(v) => setC({ ...c, subtitle: v })} />
      <div className="label">Items (交替左右排版)</div>
      <div className="space-y-3">
        {c.items.map((it, i) => (
          <div key={i} className="rounded-xl border border-ink-100 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-xs text-ink-500">#{i + 1}</div>
              <button
                onClick={() => setC({ ...c, items: c.items.filter((_, j) => j !== i) })}
                className="text-xs text-ink-500 hover:text-red-600"
              >
                remove
              </button>
            </div>
            <Field
              label="标题"
              value={it.title}
              onChange={(v) => {
                const next = [...c.items];
                next[i] = { ...it, title: v };
                setC({ ...c, items: next });
              }}
            />
            <Field
              label="描述"
              value={it.body}
              onChange={(v) => {
                const next = [...c.items];
                next[i] = { ...it, body: v };
                setC({ ...c, items: next });
              }}
              multiline
            />
            <Field
              label="要点 (每行一条)"
              value={(it.bullets ?? []).join('\n')}
              onChange={(v) => {
                const next = [...c.items];
                next[i] = { ...it, bullets: v.split('\n').filter(Boolean) };
                setC({ ...c, items: next });
              }}
              multiline
            />
            <div className="mt-2">
              <MediaField
                label="配图 (可选)"
                value={it.media}
                onChange={(m) => {
                  const next = [...c.items];
                  next[i] = { ...it, media: m };
                  setC({ ...c, items: next });
                }}
              />
            </div>
          </div>
        ))}
        <button
          onClick={() =>
            setC({
              ...c,
              items: [
                ...c.items,
                { title: '', body: '', bullets: [], media: undefined },
              ],
            })
          }
          className="btn btn-secondary w-full text-xs"
        >
          + 添加分块
        </button>
      </div>
    </>
  );
}

function VideoEmbedEditor({
  c,
  setC,
}: {
  c: VideoEmbedContent;
  setC: (c: VideoEmbedContent) => void;
}) {
  return (
    <>
      <Field label="Title" value={c.title} onChange={(v) => setC({ ...c, title: v })} />
      <Field
        label="Subtitle"
        value={c.subtitle ?? ''}
        onChange={(v) => setC({ ...c, subtitle: v })}
      />
      <MediaField
        label="视频 (YouTube / Vimeo / Loom / MP4)"
        value={c.media}
        onChange={(m) => setC({ ...c, media: m ?? { id: '', kind: 'video', url: '' } })}
        defaultKind="video"
      />
    </>
  );
}

function SocialProofEditor({ c, setC }: { c: SocialProofContent; setC: (c: SocialProofContent) => void }) {
  const variant = c.variant ?? 'logos-and-stats';
  const VARIANTS: Array<{ key: 'logos-and-stats' | 'logos-only' | 'stats-only'; label: string; hint: string }> = [
    { key: 'logos-and-stats', label: 'Logos + Stats', hint: '默认：logo 墙在上，数字在下' },
    { key: 'logos-only', label: 'Logos only', hint: 'Helios 顶部信任带' },
    { key: 'stats-only', label: 'Stats only', hint: 'Helios 底部数据成果带' },
  ];
  const showLogos = variant !== 'stats-only';
  const showStats = variant !== 'logos-only';
  return (
    <>
      <Field label="Title" value={c.title} onChange={(v) => setC({ ...c, title: v })} />
      <div>
        <div className="label mb-1.5">Variant</div>
        <div className="flex flex-wrap gap-1.5">
          {VARIANTS.map((v) => (
            <button
              key={v.key}
              onClick={() => setC({ ...c, variant: v.key })}
              title={v.hint}
              className={`pill ${variant === v.key ? 'border-brand-200 bg-brand-50 text-brand-700' : ''}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {showLogos && (
        <>
          <div>
            <div className="label mb-1.5">Logo 展示</div>
            <div className="flex gap-1.5">
              {(['grid', 'scroll'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setC({ ...c, logoMode: m })}
                  title={m === 'scroll' ? '横向无缝滚动（hover 暂停）' : '网格静态排列'}
                  className={`pill ${(c.logoMode ?? 'grid') === m ? 'border-brand-200 bg-brand-50 text-brand-700' : ''}`}
                >
                  {m === 'scroll' ? '滚动 scroll' : '网格 grid'}
                </button>
              ))}
            </div>
          </div>
          <LogosEditor
            logos={c.logos}
            setLogos={(next) => setC({ ...c, logos: next })}
          />
        </>
      )}
      {showStats && (
        <div>
          <div className="label mb-1">Stats</div>
          <div className="space-y-1.5">
            {c.stats.map((s, i) => (
              <div key={i} className="flex gap-1.5">
                <input
                  className="input"
                  placeholder="Value"
                  value={s.value}
                  onChange={(e) => {
                    const next = [...c.stats];
                    next[i] = { ...s, value: e.target.value };
                    setC({ ...c, stats: next });
                  }}
                />
                <input
                  className="input"
                  placeholder="Label"
                  value={s.label}
                  onChange={(e) => {
                    const next = [...c.stats];
                    next[i] = { ...s, label: e.target.value };
                    setC({ ...c, stats: next });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Per-logo editor row.
 *
 * Schema for each entry is `SocialProofLogo = string | { src, alt? }` —
 * old comma-separated-text pages stay valid, new pages can store image
 * URLs (Vercel Blob or data: URL depending on env). Mode switch (T ↔ 🖼)
 * clears the field on transition to avoid putting a brand name into a
 * `src` slot or a URL into a text chip.
 *
 * Uploads go through <UploadButton> → POST /api/assets/upload, which
 * routes to Vercel Blob when BLOB_READ_WRITE_TOKEN is set and to an
 * inline data: URL otherwise (local dev). Before Phase A this used
 * a local FileReader → base64, which shipped to production as a 2MB+
 * page JSON and hit KV limits.
 */
function LogosEditor({
  logos,
  setLogos,
}: {
  logos: SocialProofLogo[];
  setLogos: (next: SocialProofLogo[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const update = (i: number, next: SocialProofLogo) => {
    const arr = [...logos];
    arr[i] = next;
    setLogos(arr);
  };
  const remove = (i: number) => setLogos(logos.filter((_, j) => j !== i));

  return (
    <div>
      <div className="label mb-1.5">Logos</div>
      <div className="space-y-2">
        {logos.map((l, i) => {
          const r = resolveSocialProofLogo(l);
          const isImage = r.kind === 'image';
          return (
            <div key={i} className="flex items-start gap-1.5">
              {/* mode toggle — only resets field on an actual transition */}
              <div className="flex shrink-0 overflow-hidden rounded-md border border-ink-200">
                <button
                  type="button"
                  title="文字"
                  className={`px-2 py-1 text-xs ${
                    !isImage ? 'bg-brand-50 text-brand-700' : 'text-ink-500'
                  }`}
                  onClick={() => {
                    if (isImage) update(i, '');
                  }}
                >
                  T
                </button>
                <button
                  type="button"
                  title="图片"
                  className={`border-l border-ink-200 px-2 py-1 text-xs ${
                    isImage ? 'bg-brand-50 text-brand-700' : 'text-ink-500'
                  }`}
                  onClick={() => {
                    if (!isImage) update(i, { src: '' });
                  }}
                >
                  🖼
                </button>
              </div>

              {/* input region */}
              {isImage ? (
                <div className="flex-1 space-y-1">
                  <div className="flex gap-1.5">
                    <input
                      className="input flex-1"
                      placeholder="图片 URL 或 data:URI"
                      value={r.src}
                      onChange={(e) =>
                        update(i, { src: e.target.value, alt: r.alt })
                      }
                    />
                    <UploadButton
                      onUpload={(res) => update(i, { src: res.url, alt: r.alt })}
                    />
                  </div>
                  {r.src && (
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-14 shrink-0 items-center justify-center rounded border border-ink-100 bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={r.src}
                          alt=""
                          className="max-h-6 max-w-full object-contain"
                        />
                      </div>
                      <input
                        className="input flex-1 text-xs"
                        placeholder="alt 描述（可选，例如 Acme 客户 logo）"
                        value={r.alt ?? ''}
                        onChange={(e) =>
                          update(i, {
                            src: r.src,
                            alt: e.target.value || undefined,
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              ) : (
                <input
                  className="input flex-1"
                  placeholder="品牌名文字"
                  value={r.text}
                  onChange={(e) => update(i, e.target.value)}
                />
              )}

              <button
                type="button"
                className="btn btn-secondary shrink-0 px-2 text-xs"
                title="删除"
                onClick={() => remove(i)}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary text-xs"
          onClick={() => setLogos([...logos, ''])}
        >
          + 加 logo
        </button>
        <button
          type="button"
          className="btn btn-secondary text-xs"
          onClick={() => setPickerOpen(true)}
          title="从资产库里选已维护的品牌 / 认证 logo"
        >
          📚 从品牌资产库
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-500">
        文字会渲染成品牌名卡片；URL / data: 会渲染成图片。上传经
        <code className="mx-1">/api/assets/upload</code>
        走 Vercel Blob（本地无 <code className="mx-0.5">BLOB_READ_WRITE_TOKEN</code>{' '}
        时以 base64 内嵌，仅限本地调试）。
      </p>
      {pickerOpen && (
        <BrandAssetLogoPicker
          onPick={(logo) => setLogos([...logos, logo])}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Picker over AssetLibrary — surfaces brand.logos[] and certifications[]
 * (those with logoUrl) as clickable thumbnails. Clicking appends to the
 * module's logos[] immediately, modal stays open so users can add several
 * in one pass. Before this existed, brand assets edited at /[locale]/assets
 * had no path into a page — SocialProof logos could only be typed in or
 * re-uploaded. User feedback H2 in the feedback base.
 *
 * Press assets aren't shown here because PressAsset has no logoUrl field;
 * they'd need a dedicated consumer module before being "pickable".
 */
function BrandAssetLogoPicker({
  onPick,
  onClose,
}: {
  onPick: (logo: SocialProofLogo) => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const [lib, setLib] = useState<AssetLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/assets')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setLib(d.assets as AssetLibrary);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePick = (logo: SocialProofLogo, flashKey: string) => {
    onPick(logo);
    setFlashId(flashKey);
    setTimeout(() => setFlashId((cur) => (cur === flashKey ? null : cur)), 800);
  };

  const brandLogos = (lib?.brand?.logos ?? []).filter(Boolean);
  const certLogos = (lib?.certifications ?? []).filter((c) => c.logoUrl);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <div className="text-sm font-medium">从品牌资产库选择</div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-500 hover:text-ink-900"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {!lib && !error && (
            <div className="text-sm text-ink-500">加载中…</div>
          )}
          {error && (
            <div className="text-sm text-red-600">加载失败：{error}</div>
          )}
          {lib && (
            <div className="space-y-5">
              <div>
                <div className="label mb-2">品牌 Logo</div>
                {brandLogos.length === 0 ? (
                  <div className="text-xs text-ink-500">
                    暂无品牌 logo —— 请到「资产库 → 企业品牌」tab 维护。
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {brandLogos.map((src, i) => {
                      const key = `brand:${i}`;
                      const flashed = flashId === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => handlePick({ src }, key)}
                          className={`relative flex h-16 items-center justify-center rounded-lg border bg-white p-2 transition ${
                            flashed
                              ? 'border-brand-400 bg-brand-50'
                              : 'border-ink-100 hover:border-brand-400'
                          }`}
                          title="点击加入 logo 列表"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={src}
                            alt=""
                            className="max-h-full max-w-full object-contain"
                          />
                          {flashed && (
                            <span className="absolute right-1 top-1 rounded bg-brand-600 px-1 text-[10px] text-white">
                              ✓
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <div className="label mb-2">认证 Logo</div>
                {certLogos.length === 0 ? (
                  <div className="text-xs text-ink-500">
                    暂无带 logo 的认证 —— 请到「资产库 → 认证合规」tab 给认证填 logo URL。
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {certLogos.map((c) => {
                      const key = `cert:${c.id}`;
                      const flashed = flashId === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() =>
                            handlePick({ src: c.logoUrl!, alt: c.name }, key)
                          }
                          className={`relative flex flex-col items-center gap-1 rounded-lg border bg-white p-2 transition ${
                            flashed
                              ? 'border-brand-400 bg-brand-50'
                              : 'border-ink-100 hover:border-brand-400'
                          }`}
                          title={`点击加入:${c.name}`}
                        >
                          <div className="flex h-10 w-full items-center justify-center">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={c.logoUrl!}
                              alt=""
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                          <div className="w-full truncate text-[10px] text-ink-500">
                            {c.name}
                          </div>
                          {flashed && (
                            <span className="absolute right-1 top-1 rounded bg-brand-600 px-1 text-[10px] text-white">
                              ✓
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-ink-100 px-5 py-3 text-xs text-ink-500">
          <span>💡 点击即添加,可连续多选</span>
          <a
            href={`/${locale}/assets`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-600 hover:underline"
          >
            去资产库编辑 →
          </a>
        </div>
      </div>
    </div>
  );
}

function SolutionEditor({ c, setC }: { c: SolutionContent; setC: (c: SolutionContent) => void }) {
  return (
    <>
      <Field label="Title" value={c.title} onChange={(v) => setC({ ...c, title: v })} />
      <Field label="Subtitle" value={c.subtitle} onChange={(v) => setC({ ...c, subtitle: v })} />
      <Field label="Body" value={c.body} onChange={(v) => setC({ ...c, body: v })} multiline />
      <MediaField
        label="配图 (架构图 / 流程图,可选)"
        value={c.media}
        onChange={(m) => setC({ ...c, media: m })}
      />
    </>
  );
}

/**
 * Dedicated pain editor (replaces the generic ListItemsEditor dispatch as
 * part of Phase F). Same structural reason as TestimonialEditor: the
 * generic editor only understands string fields, so it can't surface the
 * optional `media?: MediaRef` that each pain item now carries. A small
 * illustration or GIF per pain card makes the anxiety land harder than
 * text alone, so the upload path has to be first-class in the editor.
 */
function PainEditor({ c, setC }: { c: PainContent; setC: (c: PainContent) => void }) {
  const updateItem = (i: number, patch: Partial<PainContent['items'][number]>) => {
    const next = [...c.items];
    next[i] = { ...next[i], ...patch };
    setC({ ...c, items: next });
  };
  const removeItem = (i: number) =>
    setC({ ...c, items: c.items.filter((_, j) => j !== i) });

  return (
    <>
      <Field label="Title" value={c.title} onChange={(v) => setC({ ...c, title: v })} />
      <Field
        label="Subtitle"
        value={c.subtitle ?? ''}
        onChange={(v) => setC({ ...c, subtitle: v })}
      />
      <div className="label">Items</div>
      <div className="space-y-3">
        {c.items.map((it, i) => (
          <div key={i} className="rounded-xl border border-ink-100 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-xs text-ink-500">#{i + 1}</div>
              <button
                onClick={() => removeItem(i)}
                className="text-xs text-ink-500 hover:text-red-600"
              >
                remove
              </button>
            </div>
            <Field
              label="title"
              value={it.title ?? ''}
              onChange={(v) => updateItem(i, { title: v })}
            />
            <div className="mt-1.5">
              <Field
                label="body"
                value={it.body ?? ''}
                onChange={(v) => updateItem(i, { body: v })}
                multiline
              />
            </div>
            <div className="mt-2">
              <MediaField
                label="插画 / GIF (可选)"
                value={it.media}
                onChange={(m) => updateItem(i, { media: m })}
              />
            </div>
          </div>
        ))}
        <button
          onClick={() =>
            setC({ ...c, items: [...c.items, { title: '', body: '' }] })
          }
          className="btn btn-secondary w-full text-xs"
        >
          + Add item
        </button>
      </div>
    </>
  );
}

/**
 * Dedicated useCase editor — mirrors PainEditor's structure. Each role
 * can carry an optional screenshot of the dashboard/UI that role actually
 * uses (e.g. a PM-specific kanban view, a sales-specific pipeline view).
 * Text-only items keep rendering as one-line rows; items with media get
 * a thumbnail in the renderer.
 */
function UseCaseEditor({ c, setC }: { c: UseCaseContent; setC: (c: UseCaseContent) => void }) {
  const updateItem = (i: number, patch: Partial<UseCaseContent['items'][number]>) => {
    const next = [...c.items];
    next[i] = { ...next[i], ...patch };
    setC({ ...c, items: next });
  };
  const removeItem = (i: number) =>
    setC({ ...c, items: c.items.filter((_, j) => j !== i) });

  return (
    <>
      <Field label="Title" value={c.title} onChange={(v) => setC({ ...c, title: v })} />
      <div className="label">Items</div>
      <div className="space-y-3">
        {c.items.map((it, i) => (
          <div key={i} className="rounded-xl border border-ink-100 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-xs text-ink-500">#{i + 1}</div>
              <button
                onClick={() => removeItem(i)}
                className="text-xs text-ink-500 hover:text-red-600"
              >
                remove
              </button>
            </div>
            <Field
              label="role"
              value={it.role ?? ''}
              onChange={(v) => updateItem(i, { role: v })}
            />
            <div className="mt-1.5">
              <Field
                label="scenario"
                value={it.scenario ?? ''}
                onChange={(v) => updateItem(i, { scenario: v })}
                multiline
              />
            </div>
            <div className="mt-2">
              <MediaField
                label="该角色 UI 截图 (可选)"
                value={it.media}
                onChange={(m) => updateItem(i, { media: m })}
              />
            </div>
          </div>
        ))}
        <button
          onClick={() =>
            setC({ ...c, items: [...c.items, { role: '', scenario: '' }] })
          }
          className="btn btn-secondary w-full text-xs"
        >
          + Add item
        </button>
      </div>
    </>
  );
}

function CTAEditor({ c, setC }: { c: CTAContent; setC: (c: CTAContent) => void }) {
  return (
    <>
      <FontScalePicker
        value={c.fontScale ?? 'md'}
        onChange={(v) => setC({ ...c, fontScale: v })}
      />
      <Field label="Headline" value={c.headline} onChange={(v) => setC({ ...c, headline: v })} />
      <Field label="Subhead" value={c.subhead} onChange={(v) => setC({ ...c, subhead: v })} />
      <Field label="Button" value={c.button} onChange={(v) => setC({ ...c, button: v })} />
      <Field
        label="按钮链接 (留空 = 滚到表单 #contact)"
        value={c.buttonHref ?? ''}
        onChange={(v) => setC({ ...c, buttonHref: v || undefined })}
      />
    </>
  );
}

function FormEditor({ c, setC }: { c: FormContent; setC: (c: FormContent) => void }) {
  const mode = c.mode ?? 'inline';
  const urlLooksValid = !c.externalUrl || /^https?:\/\//i.test(c.externalUrl);

  // Feishu #11 — schema-driven editor. We treat `fieldSchemas` as the
  // source of truth. Legacy pages (no fieldSchemas) are upgraded on the
  // first edit. The legacy `fields` array is kept in sync so readers
  // that haven't migrated still see the new order.
  const schema: FormFieldSpec[] =
    c.fieldSchemas && c.fieldSchemas.length > 0
      ? c.fieldSchemas
      : c.fields.map((k) => ({ key: k }));

  const writeSchema = (next: FormFieldSpec[]) => {
    setC({ ...c, fieldSchemas: next, fields: next.map((s) => s.key) });
  };

  const toggleKey = (k: FormFieldKey) => {
    const idx = schema.findIndex((s) => s.key === k);
    if (idx >= 0) writeSchema(schema.filter((_, i) => i !== idx));
    else writeSchema([...schema, { key: k }]);
  };

  const updateAt = (i: number, patch: Partial<FormFieldSpec>) => {
    const next = [...schema];
    next[i] = { ...next[i], ...patch };
    writeSchema(next);
  };

  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...schema];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    writeSchema(next);
  };
  const moveDown = (i: number) => {
    if (i === schema.length - 1) return;
    const next = [...schema];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    writeSchema(next);
  };

  const allKeys: FormFieldKey[] = ['name', 'email', 'company', 'phone', 'message', 'smsCode'];

  return (
    <>
      <Field label="Title" value={c.title} onChange={(v) => setC({ ...c, title: v })} />
      <Field label="Subtitle" value={c.subtitle} onChange={(v) => setC({ ...c, subtitle: v })} />
      <Field label="Submit Label" value={c.submitLabel} onChange={(v) => setC({ ...c, submitLabel: v })} />
      <div>
        <div className="label mb-1.5">Mode</div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setC({ ...c, mode: 'inline' })}
            title="站内表单，提交到本项目 /api/leads"
            className={`pill ${mode === 'inline' ? 'border-brand-200 bg-brand-50 text-brand-700' : ''}`}
          >
            Inline form
          </button>
          <button
            onClick={() => setC({ ...c, mode: 'external' })}
            title="跳转飞书/Typeform/Calendly，无站内字段"
            className={`pill ${mode === 'external' ? 'border-brand-200 bg-brand-50 text-brand-700' : ''}`}
          >
            External link
          </button>
        </div>
      </div>
      {mode === 'external' ? (
        <>
          <Field
            label="External URL"
            value={c.externalUrl ?? ''}
            onChange={(v) => setC({ ...c, externalUrl: v })}
          />
          {!urlLooksValid && (
            <div className="text-[11px] text-amber-600">URL 应以 http:// 或 https:// 开头</div>
          )}
          <div className="text-[11px] text-ink-400">
            粘贴飞书表单 / Typeform / Calendly 链接。Submit Label 会成为按钮文案。
          </div>
        </>
      ) : (
        <>
          <div>
            <div className="label mb-1.5">Fields</div>
            <div className="flex flex-wrap gap-1.5">
              {allKeys.map((k) => (
                <button
                  key={k}
                  onClick={() => toggleKey(k)}
                  className={`pill ${schema.some((s) => s.key === k) ? 'border-brand-200 bg-brand-50 text-brand-700' : ''}`}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[11px] text-ink-400">
              smsCode 目前只渲染占位输入框，发送验证码按钮在 S2 上线前禁用。
            </div>
          </div>
          {schema.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="label">字段顺序 / 自定义</div>
              {schema.map((spec, i) => (
                <div
                  key={spec.key}
                  className="rounded-xl border border-ink-100 bg-white p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-ink-900">{spec.key}</div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveUp(i)}
                        disabled={i === 0}
                        className="rounded border border-ink-100 px-1.5 py-0.5 text-xs text-ink-500 disabled:opacity-30"
                        title="上移"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDown(i)}
                        disabled={i === schema.length - 1}
                        className="rounded border border-ink-100 px-1.5 py-0.5 text-xs text-ink-500 disabled:opacity-30"
                        title="下移"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleKey(spec.key)}
                        className="rounded border border-red-200 px-1.5 py-0.5 text-xs text-red-600"
                        title="移除"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input
                      className="input text-sm"
                      placeholder="标签 (默认用 locale 文案)"
                      value={spec.label ?? ''}
                      onChange={(e) => updateAt(i, { label: e.target.value || undefined })}
                    />
                    <input
                      className="input text-sm"
                      placeholder="placeholder (可选)"
                      value={spec.placeholder ?? ''}
                      onChange={(e) => updateAt(i, { placeholder: e.target.value || undefined })}
                    />
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-xs text-ink-500">
                    <input
                      type="checkbox"
                      checked={spec.required ?? (spec.key === 'name' || spec.key === 'email')}
                      onChange={(e) => updateAt(i, { required: e.target.checked })}
                    />
                    必填
                  </label>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

/**
 * Dedicated testimonial editor (replaces the generic ListItemsEditor dispatch
 * for type === 'testimonial' as part of Phase A). The generic editor can
 * only render `{label:string,value:string}` text pairs — it has no way to
 * model the optional `avatar?: MediaRef` field. Splitting it out lets us
 * reuse <MediaField> so the headshot upload path goes through the shared
 * /api/assets/upload endpoint just like every other image in the editor.
 *
 * The three text fields stay laid out vertically to match the rest of the
 * editor (quote is multiline; author / company are single-line). The avatar
 * field sits below them so a user focused on writing a quote isn't distracted
 * by the upload UI until they want to attach a headshot.
 */
function TestimonialEditor({
  c,
  setC,
}: {
  c: TestimonialContent;
  setC: (c: TestimonialContent) => void;
}) {
  const updateItem = (i: number, patch: Partial<TestimonialContent['items'][number]>) => {
    const next = [...c.items];
    next[i] = { ...next[i], ...patch };
    setC({ ...c, items: next });
  };
  const removeItem = (i: number) =>
    setC({ ...c, items: c.items.filter((_, j) => j !== i) });

  return (
    <>
      <Field label="Title" value={c.title} onChange={(v) => setC({ ...c, title: v })} />
      <div className="label">Items</div>
      <div className="space-y-3">
        {c.items.map((it, i) => (
          <div key={i} className="rounded-xl border border-ink-100 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-xs text-ink-500">#{i + 1}</div>
              <button
                onClick={() => removeItem(i)}
                className="text-xs text-ink-500 hover:text-red-600"
              >
                remove
              </button>
            </div>
            <div className="mt-1.5">
              <Field
                label="quote"
                value={it.quote ?? ''}
                onChange={(v) => updateItem(i, { quote: v })}
                multiline
              />
            </div>
            <div className="mt-1.5">
              <Field
                label="author"
                value={it.author ?? ''}
                onChange={(v) => updateItem(i, { author: v })}
              />
            </div>
            <div className="mt-1.5">
              <Field
                label="company"
                value={it.company ?? ''}
                onChange={(v) => updateItem(i, { company: v })}
              />
            </div>
            <div className="mt-2">
              <MediaField
                label="Avatar (头像,可选)"
                defaultKind="image"
                value={it.avatar}
                onChange={(v) => updateItem(i, { avatar: v })}
              />
            </div>
          </div>
        ))}
        <button
          onClick={() =>
            setC({
              ...c,
              items: [...c.items, { quote: '', author: '', company: '' }],
            })
          }
          className="btn btn-secondary w-full text-xs"
        >
          + Add item
        </button>
      </div>
    </>
  );
}

function ListItemsEditor({
  c,
  setC,
  itemFields,
}: {
  c: any;
  setC: (c: any) => void;
  itemFields: string[];
}) {
  return (
    <>
      <Field label="Title" value={c.title} onChange={(v) => setC({ ...c, title: v })} />
      {'subtitle' in c && (
        <Field
          label="Subtitle"
          value={c.subtitle ?? ''}
          onChange={(v) => setC({ ...c, subtitle: v })}
        />
      )}
      <div className="label">Items</div>
      <div className="space-y-3">
        {c.items.map((it: any, i: number) => (
          <div key={i} className="rounded-xl border border-ink-100 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-xs text-ink-500">#{i + 1}</div>
              <button
                onClick={() => {
                  const next = c.items.filter((_: any, j: number) => j !== i);
                  setC({ ...c, items: next });
                }}
                className="text-xs text-ink-500 hover:text-red-600"
              >
                remove
              </button>
            </div>
            {itemFields.map((f) => (
              <div key={f} className="mt-1.5">
                <Field
                  label={f}
                  value={it[f] ?? ''}
                  onChange={(v) => {
                    const next = [...c.items];
                    next[i] = { ...it, [f]: v };
                    setC({ ...c, items: next });
                  }}
                  multiline={f === 'body' || f === 'a' || f === 'quote' || f === 'scenario'}
                />
              </div>
            ))}
          </div>
        ))}
        <button
          onClick={() => {
            const empty: any = {};
            itemFields.forEach((f) => (empty[f] = ''));
            setC({ ...c, items: [...c.items, empty] });
          }}
          className="btn btn-secondary w-full text-xs"
        >
          + Add item
        </button>
      </div>
    </>
  );
}

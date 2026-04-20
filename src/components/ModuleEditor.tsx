'use client';
import { useTranslations } from 'next-intl';
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
  ProductShowcaseContent,
  VideoEmbedContent,
  MediaRef,
} from '@/lib/types';
import { resolveSocialProofLogo } from '@/lib/types';
import MediaField from './MediaField';
import UploadButton from './UploadButton';

type Props = {
  module: PageModule;
  onChange: (patch: Partial<PageModule>) => void;
  onRegenerate: () => void;
  // When Claude isn't configured (no ANTHROPIC_API_KEY), the regenerate
  // button is greyed out + carries a tooltip instead of letting the user
  // click and then see a 503 banner. Undefined = no gating info from
  // parent (treat as "allow" — backward compat).
  regenerateDisabledReason?: string | null;
};

export default function ModuleEditor({
  module,
  onChange,
  onRegenerate,
  regenerateDisabledReason,
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
        {module.type === 'hero' && <HeroEditor c={module.content as HeroContent} setC={setContent} />}
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
];

const BENEFITS_LAYOUTS: { id: import('@/lib/types').BenefitsLayout; name: string; desc: string }[] = [
  { id: 'cards', name: '三列卡片', desc: '每个收益一张卡，简洁并列。适合 3 个核心卖点。' },
  { id: 'alternating', name: '左右交替', desc: '文案 + 配图交替排版。有截图时视觉更强。' },
  { id: 'compact', name: '紧凑列表', desc: '序号 + 标题 + 一行描述。信息密度高，适合 CN 市场。' },
];

function HeroEditor({ c, setC }: { c: HeroContent; setC: (c: HeroContent) => void }) {
  return (
    <>
      <LayoutPicker
        label="布局"
        value={c.layout ?? 'split'}
        options={HERO_LAYOUTS}
        onChange={(v) => setC({ ...c, layout: v })}
      />
      <Field label="Eyebrow" value={c.eyebrow} onChange={(v) => setC({ ...c, eyebrow: v })} />
      <Field label="Headline" value={c.headline} onChange={(v) => setC({ ...c, headline: v })} multiline />
      <Field label="Subhead" value={c.subhead} onChange={(v) => setC({ ...c, subhead: v })} multiline />
      <Field label="Primary CTA" value={c.primaryCta} onChange={(v) => setC({ ...c, primaryCta: v })} />
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
        <LogosEditor
          logos={c.logos}
          setLogos={(next) => setC({ ...c, logos: next })}
        />
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
      <button
        type="button"
        className="btn btn-secondary mt-2 text-xs"
        onClick={() => setLogos([...logos, ''])}
      >
        + 加 logo
      </button>
      <p className="mt-2 text-xs text-ink-500">
        文字会渲染成品牌名卡片；URL / data: 会渲染成图片。上传经
        <code className="mx-1">/api/assets/upload</code>
        走 Vercel Blob（本地无 <code className="mx-0.5">BLOB_READ_WRITE_TOKEN</code>{' '}
        时以 base64 内嵌，仅限本地调试）。
      </p>
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
      <Field label="Headline" value={c.headline} onChange={(v) => setC({ ...c, headline: v })} />
      <Field label="Subhead" value={c.subhead} onChange={(v) => setC({ ...c, subhead: v })} />
      <Field label="Button" value={c.button} onChange={(v) => setC({ ...c, button: v })} />
    </>
  );
}

function FormEditor({ c, setC }: { c: FormContent; setC: (c: FormContent) => void }) {
  const mode = c.mode ?? 'inline';
  const toggle = (f: FormContent['fields'][number]) => {
    const has = c.fields.includes(f);
    setC({ ...c, fields: has ? c.fields.filter((x) => x !== f) : [...c.fields, f] });
  };
  const all: FormContent['fields'] = ['name', 'email', 'company', 'phone', 'message'];
  const urlLooksValid = !c.externalUrl || /^https?:\/\//i.test(c.externalUrl);
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
        <div>
          <div className="label mb-1.5">Fields</div>
          <div className="flex flex-wrap gap-1.5">
            {all.map((f) => (
              <button
                key={f}
                onClick={() => toggle(f)}
                className={`pill ${c.fields.includes(f) ? 'border-brand-200 bg-brand-50 text-brand-700' : ''}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
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

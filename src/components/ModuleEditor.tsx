'use client';
import { useTranslations } from 'next-intl';
import type {
  PageModule,
  HeroContent,
  SocialProofContent,
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
import MediaField from './MediaField';

type Props = {
  module: PageModule;
  onChange: (patch: Partial<PageModule>) => void;
  onRegenerate: () => void;
};

export default function ModuleEditor({ module, onChange, onRegenerate }: Props) {
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
        className="btn btn-secondary w-full text-xs"
        onClick={onRegenerate}
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
        {module.type === 'pain' && <ListItemsEditor c={module.content as PainContent} setC={setContent} itemFields={['title', 'body']} />}
        {module.type === 'solution' && <SolutionEditor c={module.content as SolutionContent} setC={setContent} />}
        {module.type === 'benefits' && <BenefitsEditor c={module.content as BenefitsContent} setC={setContent} />}
        {module.type === 'useCase' && <ListItemsEditor c={module.content as UseCaseContent} setC={setContent} itemFields={['role', 'scenario']} />}
        {module.type === 'testimonial' && <ListItemsEditor c={module.content as TestimonialContent} setC={setContent} itemFields={['quote', 'author', 'company']} />}
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
  return (
    <>
      <Field label="Title" value={c.title} onChange={(v) => setC({ ...c, title: v })} />
      <Field label="Logos (comma separated)" value={c.logos.join(', ')} onChange={(v) => setC({ ...c, logos: v.split(',').map((s) => s.trim()).filter(Boolean) })} multiline />
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
    </>
  );
}

function SolutionEditor({ c, setC }: { c: SolutionContent; setC: (c: SolutionContent) => void }) {
  return (
    <>
      <Field label="Title" value={c.title} onChange={(v) => setC({ ...c, title: v })} />
      <Field label="Subtitle" value={c.subtitle} onChange={(v) => setC({ ...c, subtitle: v })} />
      <Field label="Body" value={c.body} onChange={(v) => setC({ ...c, body: v })} multiline />
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
  const toggle = (f: FormContent['fields'][number]) => {
    const has = c.fields.includes(f);
    setC({ ...c, fields: has ? c.fields.filter((x) => x !== f) : [...c.fields, f] });
  };
  const all: FormContent['fields'] = ['name', 'email', 'company', 'phone', 'message'];
  return (
    <>
      <Field label="Title" value={c.title} onChange={(v) => setC({ ...c, title: v })} />
      <Field label="Subtitle" value={c.subtitle} onChange={(v) => setC({ ...c, subtitle: v })} />
      <Field label="Submit Label" value={c.submitLabel} onChange={(v) => setC({ ...c, submitLabel: v })} />
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

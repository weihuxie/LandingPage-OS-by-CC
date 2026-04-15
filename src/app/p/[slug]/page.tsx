import { notFound } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { getProjectBySlug } from '@/lib/storage';
import PageRenderer from '@/components/PageRenderer';
import TrackView from '@/components/TrackView';
import type { Metadata } from 'next';
import type { NarrativeVariant } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const p = await getProjectBySlug(params.slug);
  if (!p) return { title: 'Not found' };
  return {
    title: `${p.inputs.name} — ${p.inputs.tagline}`,
    description: p.inputs.value || p.inputs.tagline,
    openGraph: {
      title: p.inputs.name,
      description: p.inputs.tagline,
      locale: p.inputs.locale,
    },
  };
}

export default async function PublicPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { v?: string };
}) {
  const project = await getProjectBySlug(params.slug);
  if (!project) notFound();
  if (!project.published) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">This page is not published yet.</h1>
        <p className="mt-2 text-ink-500">
          The owner needs to click Publish in the editor.
        </p>
      </div>
    );
  }

  // A/B split logic (PRD §6):
  // - ?v=a or ?v=b → explicit override (used in editor "preview as")
  // - sticky cookie `lp_v` → return visitors see the same variant
  // - random 50/50 if publishMode=ab-split AND no cookie
  // - otherwise activeVariant
  let variant: NarrativeVariant = project.activeVariant ?? 'A';
  const cookieJar = cookies();
  const forced = searchParams.v?.toUpperCase();
  if (forced === 'A' || forced === 'B') {
    variant = forced as NarrativeVariant;
  } else if (project.publishMode === 'ab-split') {
    const stored = cookieJar.get('lp_v')?.value?.toUpperCase();
    if (stored === 'A' || stored === 'B') {
      variant = stored as NarrativeVariant;
    } else {
      variant = Math.random() < 0.5 ? 'A' : 'B';
      // Server components can't set cookies, client TrackView will persist.
    }
  }

  const displayModules = project.variants?.[variant] ?? project.modules;
  const displayProject = { ...project, modules: displayModules, activeVariant: variant };

  const referrer = headers().get('referer') ?? undefined;

  return (
    <div className="bg-white">
      <TrackView slug={project.slug} variant={variant} locale={project.inputs.locale} referrer={referrer} />
      <PageRenderer
        project={displayProject}
        device="desktop"
        interactive
        locale={project.inputs.locale}
        variant={variant}
      />
    </div>
  );
}

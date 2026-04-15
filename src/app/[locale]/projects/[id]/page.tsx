import { notFound } from 'next/navigation';
import { getProject, readLeads } from '@/lib/storage';
import Editor from '@/components/Editor';
import { unstable_setRequestLocale } from 'next-intl/server';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  unstable_setRequestLocale(params.locale);
  const project = await getProject(params.id);
  if (!project) notFound();
  const leads = await readLeads(project.id);
  return <Editor locale={params.locale} initialProject={project} initialLeads={leads} />;
}

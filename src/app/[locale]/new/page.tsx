import Wizard from '@/components/Wizard';
import { unstable_setRequestLocale } from 'next-intl/server';
import { requireUserAndTenant } from '@/lib/server-auth';

export default async function NewProjectPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  unstable_setRequestLocale(locale);
  // S2: gate behind login. Wizard creates the product server-side via
  // /api/projects POST — that endpoint will also require auth in C3 so
  // both sides are consistent.
  await requireUserAndTenant(`/${locale}/new`);
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Wizard locale={locale} />
    </div>
  );
}

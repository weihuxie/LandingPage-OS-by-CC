import Wizard from '@/components/Wizard';
import { unstable_setRequestLocale } from 'next-intl/server';

export default function NewProjectPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  unstable_setRequestLocale(locale);
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Wizard locale={locale} />
    </div>
  );
}

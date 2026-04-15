import { nanoid } from 'nanoid';

export function makeSlug(name: string): string {
  const base = (name || 'page')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 32);
  const suffix = nanoid(6).toLowerCase();
  return base ? `${base}-${suffix}` : suffix;
}

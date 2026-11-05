import { basename } from 'node:path';

const MAX_SLUG_LENGTH = 40;

export function slugify(title: string): string {
  const ascii = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (ascii.length <= MAX_SLUG_LENGTH) return ascii || 'task';
  const lastDash = ascii.slice(0, MAX_SLUG_LENGTH + 1).lastIndexOf('-');
  return lastDash > 0 ? ascii.slice(0, lastDash) : ascii.slice(0, MAX_SLUG_LENGTH);
}

export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function sessionName(projectDir: string, slug: string): string {
  return `${slugify(basename(projectDir))}-${slug}`;
}

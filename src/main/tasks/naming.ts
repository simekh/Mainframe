import { createHash } from 'node:crypto';
import { basename } from 'node:path';

const MAX_SLUG_LENGTH = 40;

/** The manager's slug in its session name, which no task may take: `claude --resume` finds a chat by its name. */
export const MANAGER_SLUG = 'manager';

const DIGITS = Array.from({ length: 9 }, (_, i) => i + 1);

/** Device names no file or folder may take on Windows, in the lower case slugs are in. */
export const WINDOWS_RESERVED_NAMES: readonly string[] = [
  'con', 'prn', 'aux', 'nul', ...DIGITS.map((n) => `com${n}`), ...DIGITS.map((n) => `lpt${n}`),
];

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

/** A project's folder name in the data folder: its name, and a hash of its path so two folders of one name stay apart. */
export function projectKey(projectDir: string): string {
  const hash = createHash('sha256').update(projectDir).digest('hex').slice(0, 8);
  return `${slugify(basename(projectDir))}-${hash}`;
}

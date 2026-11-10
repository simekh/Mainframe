import { createHash } from 'node:crypto';
import { it, expect } from 'vitest';
import { projectKey, sessionName, slugify, uniqueSlug, WINDOWS_RESERVED_NAMES } from './naming';

it.each([
  ['Fix login on iOS', 'fix-login-on-ios'],
  ['Åtgärda växeln för öl', 'atgarda-vaxeln-for-ol'],
  ['Add 🍎 emoji / support!!', 'add-emoji-support'],
  ['  --Trim--  ', 'trim'],
  ['!!!', 'task'],
  ['Make the board show every session that needs the owner first', 'make-the-board-show-every-session-that'],
  ['x'.repeat(50), 'x'.repeat(40)],
])('slugify(%j) is %j', (title, slug) => {
  expect(slugify(title)).toBe(slug);
});

it('uniqueSlug adds the first free number', () => {
  expect(uniqueSlug('fix', new Set())).toBe('fix');
  expect(uniqueSlug('fix', new Set(['fix']))).toBe('fix-2');
  expect(uniqueSlug('fix', new Set(['fix', 'fix-2', 'fix-3']))).toBe('fix-4');
});

it('WINDOWS_RESERVED_NAMES are the device names Windows reserves, as slugs spell them', () => {
  expect([...WINDOWS_RESERVED_NAMES].sort()).toEqual([
    'aux', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'con',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9', 'nul', 'prn',
  ]);
});

it('sessionName prefixes the slug with the project folder', () => {
  expect(sessionName('/Users/x/Developer/Acme', 'fix-login')).toBe('acme-fix-login');
});

it('projectKey is the folder name the manager uses: the slug of the basename and 8 hex of the path hash', () => {
  const hash = createHash('sha256').update('/Users/a/My Project').digest('hex').slice(0, 8);
  expect(projectKey('/Users/a/My Project')).toBe(`my-project-${hash}`);
});

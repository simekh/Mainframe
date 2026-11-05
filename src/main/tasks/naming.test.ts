import { it, expect } from 'vitest';
import { sessionName, slugify, uniqueSlug } from './naming';

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

it('sessionName prefixes the slug with the project folder', () => {
  expect(sessionName('/Users/x/Developer/Damela', 'fix-login')).toBe('damela-fix-login');
});

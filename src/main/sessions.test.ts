import { it, expect } from 'vitest';
import { SessionRegistry } from './sessions';

it('creates sessions with fresh ids, numbered names and the project dir', () => {
  const reg = new SessionRegistry({ projectDir: '/repo', sessionArgv: ['claude'] });
  const a = reg.create();
  const b = reg.create();
  expect(a).toMatchObject({ name: 'Session 1', cwd: '/repo' });
  expect(b.name).toBe('Session 2');
  expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(a.id).not.toBe(b.id);
  expect(reg.launchSpec(a.id)).toEqual({ argv: ['claude'], cwd: '/repo' });
});

it('launchSpec of an unknown id throws', () => {
  expect(() => new SessionRegistry({ projectDir: '/r', sessionArgv: ['claude'] }).launchSpec('nope')).toThrow('nope');
});

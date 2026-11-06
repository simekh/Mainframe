import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { hookSettings, readSessionStart, reopenArgv, startArgv } from './launch';

const U = '0b7e8a52-2f4c-4f7e-9a51-6d2c3c1b9e10';
const S = '/data/tasks/t1/settings.json';

it('starts claude in a named worktree with a fixed session id, the hooks file and the prompt', () => {
  expect(startArgv({ claudeBin: 'claude', slug: 'fix-login', name: 'damela-fix-login', claudeSessionId: U, settingsPath: S, prompt: 'P' }))
    .toEqual(['claude', '-w', 'fix-login', '-n', 'damela-fix-login', '--session-id', U, '--settings', S, 'P']);
});

it('reopens in the worktree while its branch exists, and in the main checkout once it is gone', () => {
  const o = { claudeBin: 'claude', slug: 'fix-login', claudeSessionId: U, settingsPath: S };
  expect(reopenArgv({ ...o, branchExists: true })).toEqual(['claude', '--worktree', 'fix-login', '--resume', U, '--settings', S]);
  expect(reopenArgv({ ...o, branchExists: false })).toEqual(['claude', '--resume', U, '--settings', S]);
});

it('reopens with a prompt as the last argument when given one', () => {
  const o = { claudeBin: 'claude', slug: 'fix-login', claudeSessionId: U, settingsPath: S, prompt: 'P' };
  expect(reopenArgv({ ...o, branchExists: true })).toEqual(['claude', '--worktree', 'fix-login', '--resume', U, '--settings', S, 'P']);
  expect(reopenArgv({ ...o, branchExists: false })).toEqual(['claude', '--resume', U, '--settings', S, 'P']);
});

it('refuses to resume an id that is not a UUID', () => {
  expect(() => reopenArgv({ claudeBin: 'claude', slug: 's', claudeSessionId: '--evil', settingsPath: S, branchExists: false })).toThrow('--evil');
});

it('registers one SessionStart command hook', () => {
  const hooks = JSON.parse(hookSettings('/d/t1')).hooks;
  expect(Object.keys(hooks)).toEqual(['SessionStart']);
  expect(hooks.SessionStart).toEqual([{ hooks: [{ type: 'command', command: expect.any(String), timeout: 10 }] }]);
});

it('the hook command saves its input silently, also in a folder whose path has a space and a quote', () => {
  const dir = mkdtempSync(join(tmpdir(), "hook dir 'q' "));
  const command = JSON.parse(hookSettings(dir)).hooks.SessionStart[0].hooks[0].command;
  const out = execFileSync('/bin/sh', ['-c', command], { input: `{"session_id":"${U}","source":"clear"}` });
  expect(out.toString()).toBe('');
  expect(readFileSync(join(dir, 'session-start.json'), 'utf8')).toBe(`{"session_id":"${U}","source":"clear"}`);
});

it.each([
  [`{"session_id":"${U}"}`, U],
  [null, null],
  ['{', null],
  ['{"session_id":"--evil"}', null],
  ['[]', null],
])('readSessionStart(%j) is %j', (text, id) => {
  expect(readSessionStart(text)).toBe(id);
});

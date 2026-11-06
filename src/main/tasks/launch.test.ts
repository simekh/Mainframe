import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { hookSettings, managerArgv, readSessionStart, reopenArgv, startArgv } from './launch';

const U = '0b7e8a52-2f4c-4f7e-9a51-6d2c3c1b9e10';
const S = '/data/tasks/t1/settings.json';
const MCP = '/data/managers/damela-0a1b2c3d/mcp.json';
const MS = '/data/managers/damela-0a1b2c3d/settings.json';
const M = { claudeBin: 'claude', name: 'damela-manager', claudeSessionId: U, mcpConfigPath: MCP, settingsPath: MS, rolePrompt: 'ROLE' };

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

it('starts the manager in the main checkout, named, with a fixed session id, its MCP config, hooks file and role prompt', () => {
  expect(managerArgv({ ...M, resume: false })).toEqual([
    'claude', '-n', 'damela-manager', '--session-id', U, '--mcp-config', MCP, '--settings', MS, '--append-system-prompt', 'ROLE',
  ]);
});

it('resumes the manager with the same config, hooks file and role prompt', () => {
  expect(managerArgv({ ...M, resume: true })).toEqual([
    'claude', '--resume', U, '--mcp-config', MCP, '--settings', MS, '--append-system-prompt', 'ROLE',
  ]);
});

it.each([false, true])('the manager carry-on prompt comes last, and --mcp-config never directly before it (resume %s)', (resume) => {
  // --mcp-config takes several values, so a positional prompt after it would be read as a config file.
  const argv = managerArgv({ ...M, resume, prompt: 'P' });
  expect(argv.at(-1)).toBe('P');
  expect(argv.at(-2)).toBe('ROLE');
});

it('refuses to resume the manager on an id that is not a UUID', () => {
  expect(() => managerArgv({ ...M, resume: true, claudeSessionId: 'not-a-uuid' })).toThrow('not-a-uuid');
});

it('gives a task the hooks file it has always had, byte for byte', () => {
  const command = "cat > '/d/t1/session-start.json.tmp' && mv '/d/t1/session-start.json.tmp' '/d/t1/session-start.json'";
  const expected = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command, timeout: 10 }] }] } });
  expect(hookSettings('/d/t1')).toBe(expected);
  expect(hookSettings('/d/t1', [])).toBe(expected);
});

it('adds the allow rules it is given as permissions.allow, beside the hook', () => {
  const settings = JSON.parse(hookSettings('/d/m', ['mcp__mainframe__*']));
  expect(settings.permissions).toEqual({ allow: ['mcp__mainframe__*'] });
  expect(Object.keys(settings.hooks)).toEqual(['SessionStart']);
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

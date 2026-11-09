import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { hookSettings, managerArgv, readRecordedSession, readSessionStart, reopenArgv, SESSION_START_FILE, startArgv } from './launch';

/** Where nothing runs: the path is only written into settings. */
const NODE = '/usr/local/bin/node';
const U = '0b7e8a52-2f4c-4f7e-9a51-6d2c3c1b9e10';
const S = '/data/tasks/t1/settings.json';
const MCP = '/data/managers/acme-0a1b2c3d/mcp.json';
const MS = '/data/managers/acme-0a1b2c3d/settings.json';
const M = { claudeBin: 'claude', name: 'acme-manager', claudeSessionId: U, mcpConfigPath: MCP, settingsPath: MS, rolePrompt: 'ROLE' };

it('starts claude in a named worktree with a fixed session id, the hooks file and the prompt', () => {
  expect(startArgv({ claudeBin: 'claude', slug: 'fix-login', name: 'acme-fix-login', claudeSessionId: U, settingsPath: S, prompt: 'P' }))
    .toEqual(['claude', '-w', 'fix-login', '-n', 'acme-fix-login', '--session-id', U, '--settings', S, 'P']);
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
    'claude', '-n', 'acme-manager', '--session-id', U, '--mcp-config', MCP, '--settings', MS, '--append-system-prompt', 'ROLE',
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

it("a task's SessionStart hook runs node with no shell", () => {
  for (const settings of [hookSettings('/d/t1', NODE), hookSettings('/d/t1', NODE, [])]) {
    const parsed = JSON.parse(settings);
    expect(Object.keys(parsed)).toEqual(['hooks']);
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    expect(parsed.hooks.SessionStart[0].hooks).toEqual([
      { type: 'command', command: NODE, args: ['-e', expect.any(String), join('/d/t1', 'session-start.json')], timeout: 10 },
    ]);
  }
});

it('adds the allow rules it is given as permissions.allow, beside the hook', () => {
  const settings = JSON.parse(hookSettings('/d/m', NODE, ['mcp__mainframe__*']));
  expect(settings.permissions).toEqual({ allow: ['mcp__mainframe__*'] });
  expect(Object.keys(settings.hooks)).toEqual(['SessionStart']);
});

it("the node path is the hook's command as it is, spaces and all", () => {
  const node = 'C:\\Program Files\\nodejs\\node.exe';
  expect(JSON.parse(hookSettings('/d', node)).hooks.SessionStart[0].hooks[0].command).toBe(node);
});

it('the hook command saves its input silently, also in a folder whose path has a space, a quote and non-ASCII letters', () => {
  const dir = mkdtempSync(join(tmpdir(), "hook dir 'q' åäö "));
  const hook = JSON.parse(hookSettings(dir, process.execPath)).hooks.SessionStart[0].hooks[0];
  const first = `{"session_id":"${U}","source":"clear"}`;
  expect(execFileSync(hook.command, hook.args, { input: first }).toString()).toBe('');
  expect(readFileSync(join(dir, 'session-start.json'), 'utf8')).toBe(first);
  // The second run replaces the file the first left, as the rename must on Windows too.
  const second = `{"session_id":"${U}","source":"compact"}`;
  expect(execFileSync(hook.command, hook.args, { input: second }).toString()).toBe('');
  expect(readFileSync(join(dir, 'session-start.json'), 'utf8')).toBe(second);
  expect(readdirSync(dir)).toEqual(['session-start.json']);
});

it.each([
  [`{"session_id":"${U}","source":"startup","transcript_path":"/t/${U}.jsonl"}`, { id: U, source: 'startup', transcriptPath: `/t/${U}.jsonl` }],
  [`{"session_id":"${U}"}`, { id: U }],
  [`{"session_id":"${U}","source":1,"transcript_path":7}`, { id: U }],
  [null, null],
  ['{', null],
  ['{"session_id":"--evil","source":"startup"}', null],
  ['[]', null],
])('readSessionStart(%j) is %j', (text, start) => {
  expect(readSessionStart(text)).toEqual(start);
});

it('the recorded session is the id SessionStart gave, whether or not Claude Code has saved the chat', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mainframe-recorded-'));
  const unsaved = join(dir, 'projects', '-main', `${U}.jsonl`);
  writeFileSync(join(dir, SESSION_START_FILE), JSON.stringify({ session_id: U, source: 'startup', transcript_path: unsaved }));
  expect(readRecordedSession(dir)).toBe(U);
});

it('there is no recorded session while SessionStart has not fired', () => {
  expect(readRecordedSession(mkdtempSync(join(tmpdir(), 'mainframe-recorded-')))).toBeNull();
});

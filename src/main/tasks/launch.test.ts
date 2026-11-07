import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { hookSettings, managerArgv, readRecordedSession, readSessionStart, reopenArgv, SESSION_START_FILE, startArgv } from './launch';

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
  [`{"session_id":"${U}","transcript_path":"/t/${U}.jsonl"}`, { id: U, transcriptPath: `/t/${U}.jsonl` }],
  [`{"session_id":"${U}"}`, null],
  [`{"session_id":"${U}","transcript_path":7}`, null],
  [null, null],
  ['{', null],
  ['{"session_id":"--evil","transcript_path":"/t/x.jsonl"}', null],
  ['[]', null],
])('readSessionStart(%j) is %j', (text, start) => {
  expect(readSessionStart(text)).toEqual(start);
});

/**
 * A session folder whose SessionStart payload names `<projects>/-main/<U>.jsonl`, beside Claude Code's projects
 * folder with a project folder for the main checkout and one for a worktree. `saveIn` writes the chat's transcript.
 */
function recordedIn(payload: (transcriptPath: string) => object = (transcript_path) => ({ session_id: U, transcript_path })) {
  const root = mkdtempSync(join(tmpdir(), 'mainframe-recorded-'));
  const dir = join(root, 'session');
  const projects = join(root, 'projects');
  mkdirSync(dir);
  mkdirSync(join(projects, '-main'), { recursive: true });
  mkdirSync(join(projects, '-worktree'));
  writeFileSync(join(dir, SESSION_START_FILE), JSON.stringify(payload(join(projects, '-main', `${U}.jsonl`))));
  const saveIn = (folder: string, id = U) => writeFileSync(join(projects, folder, `${id}.jsonl`), '');
  return { dir, saveIn };
}

it('the recorded session is the one SessionStart named, once Claude Code has saved its transcript', () => {
  const { dir, saveIn } = recordedIn();
  saveIn('-main');
  expect(readRecordedSession(dir)).toBe(U);
});

// A task resumed from the main checkout, as when its worktree branch is gone, records the main checkout's
// project folder, but Claude Code finds the chat in the worktree's and keeps writing it there.
it('the recorded session is also saved when its transcript is in another project folder than the one named', () => {
  const { dir, saveIn } = recordedIn();
  saveIn('-worktree');
  expect(readRecordedSession(dir)).toBe(U);
});

it('there is no recorded session while no project folder holds the transcript, whatever others hold', () => {
  const { dir, saveIn } = recordedIn();
  saveIn('-worktree', '11111111-1111-4111-8111-111111111111');
  expect(readRecordedSession(dir)).toBeNull();
});

it('there is no recorded session when the projects folder cannot be read', () => {
  const { dir } = recordedIn((transcript_path) => ({ session_id: U, transcript_path: transcript_path.replace('projects', 'gone') }));
  expect(readRecordedSession(dir)).toBeNull();
});

it('there is no recorded session when SessionStart named no transcript', () => {
  const { dir, saveIn } = recordedIn(() => ({ session_id: U }));
  saveIn('-main');
  expect(readRecordedSession(dir)).toBeNull();
});

it('there is no recorded session while SessionStart has not fired', () => {
  expect(readRecordedSession(mkdtempSync(join(tmpdir(), 'mainframe-recorded-')))).toBeNull();
});

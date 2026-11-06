import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { ManagerView, ProgramState } from '../../shared/types';
import { ASK_AGAIN_PROMPT, RESUME_PROMPT } from '../tasks/carryOn';
import { hookSettings, managerArgv, SESSION_START_FILE } from '../tasks/launch';
import { ManagerService } from './managerService';
import { ROLE_PROMPT } from './rolePrompt';

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MCP_CONFIG = '{"mcpServers":{"mainframe":{"type":"http","url":"http://127.0.0.1:5555/mcp"}}}';
const U2 = '11111111-1111-4111-8111-111111111111';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'mainframe-manager-'));
  cleanup.push(root);
  const projectDir = join(root, 'Damela');
  mkdirSync(projectDir);
  const dataDir = mkdtempSync(join(tmpdir(), 'mainframe-data-'));
  cleanup.push(dataDir);

  const killed: string[] = [];
  const changes: ManagerView[] = [];
  const warnings: string[] = [];
  let counter = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

  const make = (mcpConfig = MCP_CONFIG) =>
    new ManagerService({
      projectDir,
      dataDir,
      claudeBin: 'claude',
      mcpConfig,
      kill: (id) => killed.push(id),
      onChange: (view) => changes.push(view),
      newId,
      warn: (msg) => warnings.push(msg),
    });

  const dir = join(dataDir, 'managers', `damela-${createHash('sha256').update(projectDir).digest('hex').slice(0, 8)}`);
  const file = (name: string) => join(dir, name);
  const readRecord = () => JSON.parse(readFileSync(file('manager.json'), 'utf8'));
  /** What the SessionStart hook leaves once claude has begun the manager's conversation. */
  const sessionStarted = (claudeSessionId: string) =>
    writeFileSync(file(SESSION_START_FILE), JSON.stringify({ session_id: claudeSessionId, source: 'startup' }));
  /** The launch the manager's files lead to, for the conversation `claudeSessionId`. */
  const argvOf = (claudeSessionId: string, resume: boolean, prompt?: string) =>
    managerArgv({
      claudeBin: 'claude',
      name: 'damela-manager',
      claudeSessionId,
      resume,
      mcpConfigPath: file('mcp.json'),
      settingsPath: file('settings.json'),
      rolePrompt: ROLE_PROMPT,
      prompt,
    });

  return { projectDir, dataDir, dir, file, make, service: make(), killed, changes, warnings, readRecord, sessionStarted, argvOf };
}

type Setup = ReturnType<typeof setup>;

/** Starts the manager, has its conversation begin and its session report `states` in order. */
function started(t: Setup, ...states: (ProgramState | null)[]): ManagerView {
  const view = t.service.start();
  t.sessionStarted(t.readRecord().claudeSessionId);
  for (const state of states) t.service.noteStatus(view.session!.id, state);
  return view;
}

it('has no session before it is started', () => {
  const { service, changes, dataDir } = setup();
  expect(service.view()).toEqual({ session: null });
  expect(changes).toEqual([]);
  expect(existsSync(join(dataDir, 'managers'))).toBe(false);
});

it('the first start launches claude in the main checkout, under a fresh id and without a prompt', () => {
  const { service, projectDir, readRecord, changes, argvOf } = setup();
  const view = service.start();

  expect(view).toEqual({ session: { id: expect.any(String), startedWithPrompt: false } });
  const record = readRecord();
  expect(new Set([record.claudeSessionId, view.session!.id]).size).toBe(2);
  expect(service.launchSpec(view.session!.id)).toEqual({ cwd: projectDir, argv: argvOf(record.claudeSessionId, false) });
  expect(service.launchSpec(view.session!.id).argv).toContain('damela-manager');
  expect(service.view()).toEqual(view);
  expect(changes).toEqual([view]);
});

it('start writes manager.json, the hooks and permissions in settings.json, and mcp.json, which only the owner can read', () => {
  const { service, projectDir, file, readRecord, dir } = setup();
  service.start();

  expect(readRecord()).toEqual({ version: 1, projectDir, claudeSessionId: expect.any(String), midTurn: false });
  expect(readFileSync(file('settings.json'), 'utf8')).toBe(hookSettings(dir, ['mcp__mainframe__*']));
  expect(readFileSync(file('mcp.json'), 'utf8')).toBe(MCP_CONFIG);
  expect(statSync(file('mcp.json')).mode & 0o777).toBe(0o600);
});

it('a later run writes mcp.json again, with its own port and token, and keeps it to the owner', () => {
  const { service, make, file } = setup();
  service.start();
  // Loosened, as by an editor or a restore from backup: the new token must not land in a readable file.
  chmodSync(file('mcp.json'), 0o644);

  const next = '{"mcpServers":{"mainframe":{"type":"http","url":"http://127.0.0.1:6666/mcp"}}}';
  make(next).start();

  expect(readFileSync(file('mcp.json'), 'utf8')).toBe(next);
  expect(statSync(file('mcp.json')).mode & 0o777).toBe(0o600);
});

it('start while a session runs returns the same view and launches nothing', () => {
  const { service, changes, killed, file } = setup();
  const first = service.start();
  const argv = service.launchSpec(first.session!.id).argv;
  rmSync(file('mcp.json'));

  expect(service.start()).toEqual(first);

  expect(service.launchSpec(first.session!.id).argv).toBe(argv);
  expect(changes).toEqual([first]);
  expect(killed).toEqual([]);
  expect(existsSync(file('mcp.json'))).toBe(false);
});

it('start resumes the conversation SessionStart last recorded', () => {
  const t = setup();
  mkdirSync(t.dir, { recursive: true });
  t.sessionStarted(U2);

  const view = t.service.start();
  expect(view.session).toEqual({ id: expect.any(String), startedWithPrompt: false });
  expect(t.service.launchSpec(view.session!.id).argv).toEqual(t.argvOf(U2, true));
  expect(t.readRecord().claudeSessionId).toBe(U2);
});

it('a /clear or a compaction moves the conversation the next start resumes', () => {
  const t = setup();
  const view = started(t);
  const first = t.readRecord().claudeSessionId;
  writeFileSync(t.file(SESSION_START_FILE), JSON.stringify({ session_id: U2, source: 'clear' }));

  t.service.onSessionExit(view.session!.id);
  expect(t.readRecord().claudeSessionId).toBe(U2);

  const again = t.service.start();
  expect(t.service.launchSpec(again.session!.id).argv).toEqual(t.argvOf(U2, true));
  expect(first).not.toBe(U2);
});

it('a launch whose conversation never began starts one again, under a fresh id', () => {
  const t = setup();
  const first = t.service.start();
  const firstId = t.readRecord().claudeSessionId;
  // claude was missing or quit at once: SessionStart never fired.
  t.service.noteStatus(first.session!.id, 'working');
  t.service.onSessionExit(first.session!.id);

  const again = t.service.start();
  const { claudeSessionId } = t.readRecord();
  expect(claudeSessionId).not.toBe(firstId);
  expect(again.session!.startedWithPrompt).toBe(false);
  expect(t.service.launchSpec(again.session!.id).argv).toEqual(t.argvOf(claudeSessionId, false));
});

// Working, it carries on; waiting for the owner's answer, Claude is asked to ask again, never to
// pick an answer itself. Done with its turn, it is sent nothing.
it.each([
  ['working', RESUME_PROMPT],
  ['blocked', ASK_AGAIN_PROMPT],
  ['idle', undefined],
  ['done', undefined],
  ['error', undefined],
  [null, undefined],
] as const)('a session that exits while %s is resumed with %j', (state, prompt) => {
  const t = setup();
  const view = started(t, state);

  t.service.onSessionExit(view.session!.id);
  const again = t.service.start();

  expect(again.session).toEqual({ id: expect.any(String), startedWithPrompt: prompt !== undefined });
  expect(t.service.launchSpec(again.session!.id).argv).toEqual(t.argvOf(t.readRecord().claudeSessionId, true, prompt));
});

it.each([
  [['working'], RESUME_PROMPT],
  [['blocked'], ASK_AGAIN_PROMPT],
  [['working', 'idle'], undefined],
] as const)('a quit while the session reported %j resumes it at the next start with %j', (states, prompt) => {
  const t = setup();
  const view = started(t, ...states);

  t.service.beginQuit();
  // Written before the exit arrives: the app may be gone before it does.
  expect(t.readRecord()).toMatchObject({ midTurn: prompt !== undefined });
  t.service.onSessionExit(view.session!.id);

  const second = t.make();
  const again = second.start();
  expect(again.session).toEqual({ id: expect.any(String), startedWithPrompt: prompt !== undefined });
  expect(second.launchSpec(again.session!.id).argv).toEqual(t.argvOf(t.readRecord().claudeSessionId, true, prompt));
});

it('the state a session reports as it ends does not change what it was doing', () => {
  const t = setup();
  const view = started(t, 'working');

  t.service.beginQuit();
  // A clear on the way out, and the trailing status the host sends once the process has gone.
  t.service.noteStatus(view.session!.id, null);
  t.service.onSessionExit(view.session!.id);
  t.service.noteStatus(view.session!.id, null);

  expect(t.readRecord().midTurn).toBe(true);
});

it.each([
  ['working', RESUME_PROMPT],
  ['blocked', ASK_AGAIN_PROMPT],
] as const)('a carry-on prompt that never took is owed again, the same one: ended while %s', (state, prompt) => {
  const t = setup();
  const view = started(t, state);
  t.service.onSessionExit(view.session!.id);

  const resumed = t.service.start();
  expect(t.readRecord().midTurn).toBe(false);
  expect(t.service.launchSpec(resumed.session!.id).argv.at(-1)).toBe(prompt);

  // The launch failed, or the app quit at once: Claude never began the turn it was asked to.
  t.service.onSessionExit(resumed.session!.id);
  expect(t.readRecord().midTurn).toBe(true);

  const again = t.service.start();
  expect(t.service.launchSpec(again.session!.id).argv.at(-1)).toBe(prompt);
  expect(again.session!.startedWithPrompt).toBe(true);
});

it('a carry-on prompt that has only met an idle report has not taken either', () => {
  const t = setup();
  const view = started(t, 'working');
  t.service.onSessionExit(view.session!.id);

  const resumed = t.service.start();
  // Claude Code is idle until it submits the prompt.
  t.service.noteStatus(resumed.session!.id, 'idle');
  t.service.onSessionExit(resumed.session!.id);

  expect(t.readRecord().midTurn).toBe(true);
});

it('an ask-again from an earlier turn does not outlive it: a resumed session that worked gets Continue next', () => {
  const t = setup();
  const view = started(t, 'blocked');
  t.service.onSessionExit(view.session!.id);

  const resumed = t.service.start();
  t.service.noteStatus(resumed.session!.id, 'working');
  t.service.onSessionExit(resumed.session!.id);

  const next = t.service.start();
  expect(t.service.launchSpec(next.session!.id).argv.at(-1)).toBe(RESUME_PROMPT);
});

it('an exit sends the view with no session, and the session is no longer the manager', () => {
  const { service, changes, killed, readRecord, sessionStarted } = setup();
  const view = service.start();
  sessionStarted(readRecord().claudeSessionId);
  expect(service.owns(view.session!.id)).toBe(true);

  service.onSessionExit(view.session!.id);

  expect(changes.at(-1)).toEqual({ session: null });
  expect(changes).toHaveLength(2);
  expect(service.view()).toEqual({ session: null });
  expect(service.owns(view.session!.id)).toBe(false);
  expect(() => service.launchSpec(view.session!.id)).toThrow(view.session!.id);
  expect(killed).toEqual([]);
});

it('owns only its own session: not a task session, not one that is unknown', () => {
  const { service } = setup();
  expect(service.owns('a-task-session')).toBe(false);
  service.start();
  expect(service.owns('a-task-session')).toBe(false);
});

it('a status or an exit for another session, or after the end, changes nothing', () => {
  const t = setup();
  const view = started(t, 'idle');
  t.service.noteStatus('nobody', 'working');
  t.service.onSessionExit('nobody');
  expect(t.service.view()).toEqual(view);
  expect(t.changes).toEqual([view]);

  t.service.onSessionExit(view.session!.id);
  t.service.noteStatus(view.session!.id, 'working');
  t.service.onSessionExit(view.session!.id);
  expect(t.readRecord().midTurn).toBe(false);
  expect(t.changes).toHaveLength(2);
});

it('a quit with no session records nothing', () => {
  const { service, dataDir } = setup();
  service.beginQuit();
  expect(existsSync(join(dataDir, 'managers'))).toBe(false);
});

it.each([
  ['is not JSON', '{'],
  ['is not a record of this version', JSON.stringify({ version: 1, midTurn: 'yes' })],
  ['is an older version', JSON.stringify({ version: 0, midTurn: true })],
])('a manager.json that %s is reported and treated as missing, so a new chat starts', (_why, text) => {
  const t = setup();
  mkdirSync(t.dir, { recursive: true });
  writeFileSync(t.file('manager.json'), text);

  const view = t.service.start();

  expect(t.warnings).toHaveLength(1);
  expect(t.warnings[0]).toContain(t.file('manager.json'));
  expect(t.service.launchSpec(view.session!.id).argv).toEqual(t.argvOf(t.readRecord().claudeSessionId, false));
  expect(t.readRecord()).toMatchObject({ version: 1, midTurn: false });
});

it('a manager.json from a newer Mainframe is left as it is: start throws, and neither it nor a quit touches it', () => {
  const t = setup();
  mkdirSync(t.dir, { recursive: true });
  const text = JSON.stringify({ version: 2, claudeSessionId: U2, somethingNew: true });
  writeFileSync(t.file('manager.json'), text);

  expect(() => t.service.start()).toThrow(/newer Mainframe/);
  t.service.beginQuit();

  expect(readFileSync(t.file('manager.json'), 'utf8')).toBe(text);
  expect(t.service.view()).toEqual({ session: null });
  expect(t.changes).toEqual([]);
  expect(existsSync(t.file('mcp.json'))).toBe(false);
  expect(t.warnings).toEqual([]);
});

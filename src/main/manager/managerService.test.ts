import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { ManagerView, ProgramState } from '../../shared/types';
import { ASK_AGAIN_PROMPT, RESUME_PROMPT } from '../tasks/carryOn';
import type { AgentInUse, LaunchArgs } from '../agents/agent';
import { ADAPTERS } from '../agents/adapters';
import { hookSettings, managerArgv, mcpConfigJson, SESSION_START_FILE } from '../agents/claude';
import { isOpencodeSessionId, makeOpencodeAgent } from '../agents/opencode';
import { NODE } from '../testing/lookups';
import { ManagerService } from './managerService';
import { rolePrompt } from './rolePrompt';

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MCP = { url: 'http://127.0.0.1:5555/mcp', token: 'token-1' };
const U2 = '11111111-1111-4111-8111-111111111111';
const CLAUDE: AgentInUse = { adapter: ADAPTERS.claude, bin: 'claude', setting: {} };
/** OpenCode, whose agent list is the fixture's: its lookup runs no program. */
const OPENCODE: AgentInUse = {
  adapter: makeOpencodeAgent({ run: async () => JSON.stringify({ data: [{ id: 'build', mode: 'primary', hidden: false }] }) }),
  bin: 'oc',
  setting: {},
};

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'mainframe-manager-'));
  cleanup.push(root);
  const projectDir = join(root, 'Acme');
  mkdirSync(projectDir);
  const dataDir = mkdtempSync(join(tmpdir(), 'mainframe-data-'));
  cleanup.push(dataDir);

  const changes: ManagerView[] = [];
  const warnings: string[] = [];
  let counter = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  /** The agent the next start runs: switched as Settings switches the default. */
  let inUse: AgentInUse = CLAUDE;
  const use = (agent: AgentInUse) => (inUse = agent);

  const make = (mcp = MCP) =>
    new ManagerService({
      projectDir,
      dataDir,
      nodeBin: NODE,
      env: {},
      mcp,
      agent: () => inUse,
      onChange: (view) => changes.push(view),
      newId,
      warn: (msg) => warnings.push(msg),
    });

  const dir = join(dataDir, 'managers', `acme-${createHash('sha256').update(projectDir).digest('hex').slice(0, 8)}`);
  const file = (name: string) => join(dir, name);
  const readRecord = () => JSON.parse(readFileSync(file('manager.json'), 'utf8'));
  /**
   * What the SessionStart hook leaves once claude has begun the manager's conversation. Claude Code has saved
   * that conversation, its transcript is there, in a project folder under Claude Code's projects folder, unless
   * `saved` says it has not (nobody has typed to it yet).
   */
  const sessionStarted = (claudeSessionId: string, { source = 'startup', saved = true } = {}) => {
    mkdirSync(dir, { recursive: true });
    const folder = join(dataDir, 'projects', '-acme');
    mkdirSync(folder, { recursive: true });
    const transcript = join(folder, `${claudeSessionId}.jsonl`);
    if (saved) writeFileSync(transcript, '');
    writeFileSync(file(SESSION_START_FILE), JSON.stringify({ session_id: claudeSessionId, source, transcript_path: transcript }));
  };
  /** The launch the manager's files lead to, for the conversation `claudeSessionId`. */
  const argvOf = (claudeSessionId: string, resume: boolean, prompt?: string) =>
    managerArgv({
      claudeBin: 'claude',
      name: 'acme-manager',
      claudeSessionId,
      resume,
      mcpConfigPath: file('mcp.json'),
      settingsPath: file('settings.json'),
      rolePrompt: rolePrompt(ADAPTERS.claude.instructions),
      prompt,
    });

  const service = make();
  /** The conversation a session of `s` launched with: begun under `--session-id`, or resumed. */
  const chatOf = (view: ManagerView, s = service) => {
    const { argv } = s.launchSpec(view.session!.id);
    return argv[argv.findIndex((arg) => arg === '--session-id' || arg === '--resume') + 1];
  };

  return { projectDir, dataDir, dir, file, make, service, changes, warnings, readRecord, sessionStarted, argvOf, chatOf, use };
}

type Setup = ReturnType<typeof setup>;

/** Starts the manager, has its conversation begin and its session report `states` in order. */
async function started(t: Setup, ...states: (ProgramState | null)[]): Promise<ManagerView> {
  const view = await t.service.start();
  t.sessionStarted(t.chatOf(view));
  for (const state of states) t.service.noteStatus(view.session!.id, state);
  return view;
}

it('has no session before it is started', async () => {
  const { service, changes, dataDir } = setup();
  expect(service.view()).toEqual({ session: null });
  expect(changes).toEqual([]);
  expect(existsSync(join(dataDir, 'managers'))).toBe(false);
});

it('the first start launches claude in the main checkout, under a fresh id and without a prompt', async () => {
  const { service, projectDir, changes, argvOf, chatOf } = setup();
  const view = await service.start();

  expect(view).toEqual({ session: { id: expect.any(String), startedWithPrompt: false } });
  const chat = chatOf(view);
  expect(new Set([chat, view.session!.id]).size).toBe(2);
  expect(service.launchSpec(view.session!.id)).toEqual({ cwd: projectDir, argv: argvOf(chat, false) });
  expect(service.view()).toEqual(view);
  expect(changes).toEqual([view]);
});

it('start writes manager.json, the hooks and permissions in settings.json, and mcp.json, which only the owner can read', async () => {
  const { service, file, readRecord, dir, chatOf } = setup();
  const view = await service.start();

  expect(readRecord()).toEqual({ version: 1, midTurn: false, agent: 'claude', chats: { claude: chatOf(view) } });
  expect(readFileSync(file('settings.json'), 'utf8')).toBe(hookSettings(dir, NODE, ['mcp__mainframe__list_sessions', 'mcp__mainframe__sync_todo']));
  expect(readFileSync(file('mcp.json'), 'utf8')).toBe(mcpConfigJson(MCP.url, MCP.token));
  // Windows has no owner-only mode bits (spec §10.2).
  if (process.platform !== 'win32') expect(statSync(file('mcp.json')).mode & 0o777).toBe(0o600);
});

it('a later run writes mcp.json again, with its own port and token, and keeps it to the owner', async () => {
  const { service, make, file } = setup();
  await service.start();
  // Loosened, as by an editor or a restore from backup: the new token must not land in a readable file.
  chmodSync(file('mcp.json'), 0o644);

  const next = { url: 'http://127.0.0.1:6666/mcp', token: 'token-2' };
  await make(next).start();

  expect(readFileSync(file('mcp.json'), 'utf8')).toBe(mcpConfigJson(next.url, next.token));
  // Windows has no owner-only mode bits (spec §10.2).
  if (process.platform !== 'win32') expect(statSync(file('mcp.json')).mode & 0o777).toBe(0o600);
});

it('start while a session runs returns the same view and launches nothing', async () => {
  const { service, changes, file } = setup();
  const first = await service.start();
  const argv = service.launchSpec(first.session!.id).argv;
  rmSync(file('mcp.json'));

  expect(await service.start()).toEqual(first);

  expect(service.launchSpec(first.session!.id).argv).toBe(argv);
  expect(changes).toEqual([first]);
  expect(existsSync(file('mcp.json'))).toBe(false);
});

it('two starts at once launch one session', async () => {
  const { service, changes } = setup();
  const [a, b] = await Promise.all([service.start(), service.start()]);

  expect(a.session!.id).toBe(b.session!.id);
  expect(changes).toHaveLength(1);
});

it('a manager.json from before this branch resumes its Claude chat', async () => {
  const t = setup();
  mkdirSync(t.dir, { recursive: true });
  writeFileSync(t.file('manager.json'), JSON.stringify({ version: 1, midTurn: true }));
  t.sessionStarted(U2, { source: 'resume' });

  const view = await t.service.start();
  expect(t.service.launchSpec(view.session!.id).argv).toEqual(
    managerArgv({
      claudeBin: 'claude',
      name: 'acme-manager',
      claudeSessionId: U2,
      resume: true,
      mcpConfigPath: t.file('mcp.json'),
      settingsPath: t.file('settings.json'),
      rolePrompt: rolePrompt(ADAPTERS.claude.instructions),
      prompt: 'Continue where you left off.',
    }),
  );
});

it('manager.json keeps the chat of the agent it ran', async () => {
  const t = setup();
  const view = await t.service.start();

  expect(t.readRecord()).toMatchObject({ agent: 'claude', chats: { claude: t.chatOf(view) } });
});

it('a carry-on prompt is the same agent\'s only', async () => {
  const t = setup();
  mkdirSync(t.dir, { recursive: true });
  writeFileSync(t.file('manager.json'), JSON.stringify({ version: 1, midTurn: true, agent: 'opencode' }));
  t.sessionStarted(U2);

  const view = await t.service.start();
  expect(view.session!.startedWithPrompt).toBe(false);
  expect(t.service.launchSpec(view.session!.id).argv).toEqual(t.argvOf(U2, true));
});

it('start resumes the conversation SessionStart last recorded', async () => {
  const t = setup();
  t.sessionStarted(U2);

  const view = await t.service.start();
  expect(view.session).toEqual({ id: expect.any(String), startedWithPrompt: false });
  expect(t.service.launchSpec(view.session!.id).argv).toEqual(t.argvOf(U2, true));
});

it('a /clear or a compaction moves the conversation the next start resumes', async () => {
  const t = setup();
  const view = await started(t);
  const first = t.chatOf(view);
  t.sessionStarted(U2, { source: 'clear' });
  t.service.onSessionExit(view.session!.id);

  const again = await t.service.start();
  expect(t.service.launchSpec(again.session!.id).argv).toEqual(t.argvOf(U2, true));
  expect(first).not.toBe(U2);
});

it('a launch whose conversation never began starts one again, under a fresh id', async () => {
  const t = setup();
  const first = await t.service.start();
  const firstChat = t.chatOf(first);
  // claude was missing or quit at once: SessionStart never fired.
  t.service.noteStatus(first.session!.id, 'working');
  t.service.onSessionExit(first.session!.id);

  const again = await t.service.start();
  const chat = t.chatOf(again);
  expect(chat).not.toBe(firstChat);
  expect(again.session!.startedWithPrompt).toBe(false);
  expect(t.service.launchSpec(again.session!.id).argv).toEqual(t.argvOf(chat, false));
});

it('a startup record whose chat Claude Code never saved is not resumed: the next start begins a new one, under a fresh id', async () => {
  const t = setup();
  // Launched, SessionStart fired, and nobody typed: the transcript was never written.
  const first = await t.service.start();
  const firstChat = t.chatOf(first);
  t.sessionStarted(firstChat, { source: 'startup', saved: false });
  t.service.onSessionExit(first.session!.id);

  const again = await t.service.start();
  const chat = t.chatOf(again);
  expect(chat).not.toBe(firstChat);
  expect(again.session!.startedWithPrompt).toBe(false);
  expect(t.service.launchSpec(again.session!.id).argv).toEqual(t.argvOf(chat, false));
});

// A resumed chat exists, wherever Claude Code keeps it: Mainframe does not look for its file.
it('a resume record is resumed although no transcript of it can be found', async () => {
  const t = setup();
  t.sessionStarted(U2, { source: 'resume', saved: false });

  const view = await t.service.start();
  expect(t.service.launchSpec(view.session!.id).argv).toEqual(t.argvOf(U2, true));
});

// Working, it carries on; waiting for the owner's answer, Claude is asked to ask again, never to
// pick an answer itself. Done with its turn, it is sent nothing.
it.each([
  ['working', RESUME_PROMPT],
  ['blocked', ASK_AGAIN_PROMPT],
  ['idle', undefined],
] as const)('a session that exits while %s is resumed with %j', async (state, prompt) => {
  const t = setup();
  const view = await started(t, state);
  const chat = t.chatOf(view);

  t.service.onSessionExit(view.session!.id);
  const again = await t.service.start();

  expect(again.session).toEqual({ id: expect.any(String), startedWithPrompt: prompt !== undefined });
  expect(t.service.launchSpec(again.session!.id).argv).toEqual(t.argvOf(chat, true, prompt));
});

it.each([
  [['working'], RESUME_PROMPT],
  [['working', 'idle'], undefined],
] as const)('a quit while the session reported %j resumes it at the next start with %j', async (states, prompt) => {
  const t = setup();
  const view = await started(t, ...states);
  const chat = t.chatOf(view);

  t.service.beginQuit();
  // Written before the exit arrives: the app may be gone before it does.
  expect(t.readRecord()).toMatchObject({ midTurn: prompt !== undefined });
  t.service.onSessionExit(view.session!.id);

  const second = t.make();
  const again = await second.start();
  expect(again.session).toEqual({ id: expect.any(String), startedWithPrompt: prompt !== undefined });
  expect(second.launchSpec(again.session!.id).argv).toEqual(t.argvOf(chat, true, prompt));
});

it.each([
  ['working', RESUME_PROMPT],
  ['blocked', ASK_AGAIN_PROMPT],
] as const)('a carry-on prompt that never took is owed again, the same one: ended while %s', async (state, prompt) => {
  const t = setup();
  const view = await started(t, state);
  t.service.onSessionExit(view.session!.id);

  const resumed = await t.service.start();
  expect(t.readRecord().midTurn).toBe(false);
  expect(t.service.launchSpec(resumed.session!.id).argv.at(-1)).toBe(prompt);

  // The launch failed, or the app quit at once: Claude never began the turn it was asked to.
  t.service.onSessionExit(resumed.session!.id);
  expect(t.readRecord().midTurn).toBe(true);

  const again = await t.service.start();
  expect(t.service.launchSpec(again.session!.id).argv.at(-1)).toBe(prompt);
  expect(again.session!.startedWithPrompt).toBe(true);
});

it('an exit sends the view with no session and lets that go too', async () => {
  const { service, changes, sessionStarted, chatOf } = setup();
  const view = await service.start();
  sessionStarted(chatOf(view));

  service.onSessionExit(view.session!.id);

  expect(changes.at(-1)).toEqual({ session: null });
  expect(changes).toHaveLength(2);
  expect(service.view()).toEqual({ session: null });
  expect(service.sessionIds()).toEqual([]);
  expect(() => service.launchSpec(view.session!.id)).toThrow(view.session!.id);
});

it('a status or an exit for another session, or after the end, changes nothing', async () => {
  const t = setup();
  const view = await started(t, 'idle');
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

it('a start whose manager.json cannot be written holds no session, so the next start tries again', async () => {
  const t = setup();
  // A folder where the write's temporary file goes makes the write fail.
  mkdirSync(t.file('manager.json.tmp'), { recursive: true });

  await expect(t.service.start()).rejects.toThrow();
  expect(t.service.view()).toEqual({ session: null });

  rmSync(t.file('manager.json.tmp'), { recursive: true });
  const view = await t.service.start();
  expect(view.session).not.toBeNull();
  expect(t.changes).toEqual([view]);
});

it('a quit with no session records nothing', async () => {
  const { service, dataDir } = setup();
  service.beginQuit();
  expect(existsSync(join(dataDir, 'managers'))).toBe(false);
});

it.each([
  ['is not JSON', '{'],
  ['is not a record of this version', JSON.stringify({ version: 1, midTurn: 'yes' })],
  ['is an older version', JSON.stringify({ version: 0, midTurn: true })],
])('a manager.json that %s is reported and treated as missing, so a new chat starts', async (_why, text) => {
  const t = setup();
  mkdirSync(t.dir, { recursive: true });
  writeFileSync(t.file('manager.json'), text);

  const view = await t.service.start();

  expect(t.warnings).toHaveLength(1);
  expect(t.warnings[0]).toContain(t.file('manager.json'));
  expect(t.service.launchSpec(view.session!.id).argv).toEqual(t.argvOf(t.chatOf(view), false));
  expect(t.readRecord()).toMatchObject({ version: 1, midTurn: false });
});

it('a manager.json from a newer Mainframe is left as it is: start throws, and neither it nor a quit touches it', async () => {
  const t = setup();
  mkdirSync(t.dir, { recursive: true });
  const text = JSON.stringify({ version: 2, claudeSessionId: U2, somethingNew: true });
  writeFileSync(t.file('manager.json'), text);

  await expect(t.service.start()).rejects.toThrow(/newer Mainframe/);
  t.service.beginQuit();

  expect(readFileSync(t.file('manager.json'), 'utf8')).toBe(text);
  expect(t.service.view()).toEqual({ session: null });
  expect(t.changes).toEqual([]);
  expect(existsSync(t.file('mcp.json'))).toBe(false);
  expect(t.warnings).toEqual([]);
});

it('names its one session while it runs, and none once it has ended', async () => {
  const { service } = setup();
  expect(service.sessionIds()).toEqual([]);
  const { session } = await service.start();
  expect(service.sessionIds()).toEqual([session!.id]);
  service.onSessionExit(session!.id);
  expect(service.sessionIds()).toEqual([]);
});

it('the manager on OpenCode keeps its chat in manager.json and carries it on', async () => {
  const t = setup();
  t.use(OPENCODE);
  const view = await t.service.start();
  const { argv } = t.service.launchSpec(view.session!.id);
  expect(argv.slice(0, 3)).toEqual(['oc', '--standalone', '-s']);
  expect(argv).toHaveLength(4);
  const chat = argv[3];
  expect(isOpencodeSessionId(chat)).toBe(true);
  expect(t.readRecord()).toMatchObject({ agent: 'opencode', chats: { opencode: chat } });

  t.service.noteStatus(view.session!.id, 'working');
  t.service.onSessionExit(view.session!.id);
  const again = await t.service.start();
  expect(again.session!.startedWithPrompt).toBe(true);
  expect(t.service.launchSpec(again.session!.id).argv).toEqual(['oc', '--standalone', '-s', chat, '--prompt', RESUME_PROMPT]);
});

it('the manager switches agent only at its next start, and switching back carries on the old chat', async () => {
  const t = setup();
  const claudeView = await started(t);
  const claudeChat = t.chatOf(claudeView);
  const spec = t.service.launchSpec(claudeView.session!.id);

  t.use(OPENCODE);
  expect(t.service.launchSpec(claudeView.session!.id)).toEqual(spec);
  t.service.onSessionExit(claudeView.session!.id);

  const ocView = await t.service.start();
  const ocArgv = t.service.launchSpec(ocView.session!.id).argv;
  expect(ocArgv).toEqual(['oc', '--standalone', '-s', expect.stringMatching(/^ses_/)]);
  t.service.onSessionExit(ocView.session!.id);
  expect(t.readRecord()).toMatchObject({ agent: 'opencode', chats: { claude: claudeChat, opencode: ocArgv[3] } });

  t.use(CLAUDE);
  const back = await t.service.start();
  expect(t.service.launchSpec(back.session!.id).argv).toEqual(t.argvOf(claudeChat, true));
});

it('a start whose launch resolves after a quit or a close saves nothing and holds no session', async () => {
  const t = setup();
  let resolve!: (args: LaunchArgs) => void;
  t.use({ ...CLAUDE, adapter: { ...ADAPTERS.claude, managerLaunch: () => new Promise((r) => (resolve = r)) } });
  const starting = t.service.start();
  await Promise.resolve();

  t.service.beginQuit();
  resolve({ argv: ['agent'] });

  expect(await starting).toEqual({ session: null });
  expect(t.service.sessionIds()).toEqual([]);
  expect(existsSync(t.file('manager.json'))).toBe(false);
  expect(t.changes).toEqual([]);
});

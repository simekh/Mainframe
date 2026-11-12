import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { GitQueries } from '../git';
import type { AgentName, ChangedFile, ProgramState, ProgramStatus, TaskCardRef, TaskView } from '../../shared/types';
import { NODE } from '../testing/lookups';
import { hookSettings, reopenArgv, SESSION_START_FILE, startArgv } from '../agents/claude';
import { isOpencodeSessionId, OPENCODE_ENV } from '../agents/opencode';
import { openingPrompt } from './openingPrompt';
import { TaskRecords, type TaskRecord } from './taskStore';
import { TaskService } from './taskService';

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * The agents Mainframe found at start, as every open project shares them; change its fields to change what the next
 * start sees. Both agents are found and ticked, and Claude Code is the default.
 */
function fakeAgents() {
  return {
    bins: { claude: 'claude', opencode: '/bin/opencode' } as Record<AgentName, string | null>,
    on: ['claude', 'opencode'] as AgentName[],
    default: 'claude' as AgentName,
    bin(name: AgentName) {
      return this.bins[name];
    },
    ticked() {
      return this.on.filter((name) => this.bins[name] !== null);
    },
    defaultAgent() {
      return this.default;
    },
  };
}

function setup(gitOverrides: Partial<GitQueries> = {}, platform: NodeJS.Platform = 'darwin', agents = fakeAgents()) {
  const root = mkdtempSync(join(tmpdir(), 'mainframe-service-'));
  cleanup.push(root);
  const projectDir = join(root, 'Acme');
  mkdirSync(projectDir);
  const dataDir = mkdtempSync(join(tmpdir(), 'mainframe-data-'));
  cleanup.push(dataDir);

  const git: GitQueries = {
    startCheck: async () => null,
    branchExists: async () => false,
    worktreeBranchNames: async () => [],
    changedFiles: async () => [],
    addWorktree: async () => {},
    ...gitOverrides,
  };
  const killed: string[] = [];
  /** What the session host holds as each session's last report. */
  const statuses = new Map<string, ProgramStatus>();
  const changes: TaskView[][] = [];
  const warnings: string[] = [];
  let counter = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

  const stateFile = join(dataDir, 'state.json');
  /** A service as a new run of the app makes it: it reads state.json afresh, unless it is handed the run's records. */
  const make = (records = new TaskRecords(stateFile, 1000, (msg) => warnings.push(msg)), dir = projectDir) =>
    new TaskService({
      projectDir: dir,
      dataDir,
      records,
      agents,
      nodeBin: NODE,
      platform,
      git,
      kill: (id) => killed.push(id),
      status: (id) => statuses.get(id) ?? null,
      onChange: (tasks) => changes.push(tasks),
      newId,
      now: () => 1000,
      warn: (msg) => warnings.push(msg),
    });

  const readState = (): TaskRecord[] => JSON.parse(readFileSync(stateFile, 'utf8')).tasks;
  const taskDir = (taskId: string) => join(dataDir, 'tasks', taskId);
  /** What the SessionStart hook leaves once claude has begun the task's conversation. */
  const sessionStarted = (taskId: string, claudeSessionId: string) =>
    writeFileSync(join(taskDir(taskId), SESSION_START_FILE), JSON.stringify({ session_id: claudeSessionId, source: 'startup' }));

  return {
    root, projectDir, dataDir, stateFile, make, service: make(), agents, killed, statuses, changes, warnings, readState, taskDir, sessionStarted,
  };
}

const NEW_TASK = { title: 'Fix login', description: 'Users get logged out', noQuestions: false };

it('start records the task, writes its hooks file and launches claude -w with the opening prompt', async () => {
  const { service, projectDir, readState, taskDir, changes } = setup();
  const view = await service.start(NEW_TASK);

  expect(view).toMatchObject({
    title: 'Fix login',
    description: 'Users get logged out',
    slug: 'fix-login',
    branch: 'worktree-fix-login',
    worktreePath: join(projectDir, '.claude', 'worktrees', 'fix-login'),
    createdAt: 1000,
    closedAt: null,
    session: { startedWithPrompt: true },
  });

  const [record] = readState();
  expect(record).toMatchObject({
    id: view.id,
    projectDir,
    name: 'acme-fix-login',
    worktreePath: view.worktreePath,
    branch: 'worktree-fix-login',
    noQuestions: false,
    open: true,
    closedAt: null,
  });
  expect(new Set([record.id, record.claudeSessionId, view.session!.id]).size).toBe(3);

  const settingsPath = join(taskDir(record.id), 'settings.json');
  expect(readFileSync(settingsPath, 'utf8')).toBe(hookSettings(taskDir(record.id), NODE));
  expect(service.launchSpec(view.session!.id)).toEqual({
    cwd: projectDir,
    argv: startArgv({
      claudeBin: 'claude',
      slug: 'fix-login',
      name: 'acme-fix-login',
      claudeSessionId: record.claudeSessionId,
      settingsPath,
      prompt: openingPrompt({ agent: 'claude', projectDir: '', worktreePath: '', title: 'Fix login', description: 'Users get logged out', branch: 'worktree-fix-login', noQuestions: false }),
    }),
  });
  expect(changes.at(-1)).toEqual([view]);
  expect(service.list()).toEqual([view]);
});

it('start trims the title and passes noQuestions on to the opening prompt', async () => {
  const { service, readState } = setup();
  const view = await service.start({ title: '  Fix login  ', description: '', noQuestions: true });
  expect(view.title).toBe('Fix login');
  expect(readState()[0].noQuestions).toBe(true);
  const prompt = service.launchSpec(view.session!.id).argv.at(-1);
  expect(prompt).toBe(openingPrompt({ agent: 'claude', projectDir: '', worktreePath: '', title: 'Fix login', description: '', branch: 'worktree-fix-login', noQuestions: true }));
});

/** Over 32,000 characters once quoted, as typed: with leading spaces and a trailing newline. */
const LONG = `  ${'Users get logged out. '.repeat(1000)}\n`;

/** The launch of "Fix login" with `description`, as `start` builds it for a session whose folder is `taskDir`. */
function expectedStart(claudeSessionId: string, taskDir: string, description: string, brief?: { dir: string; file: string }): string[] {
  return startArgv({
    claudeBin: 'claude',
    slug: 'fix-login',
    name: 'acme-fix-login',
    claudeSessionId,
    settingsPath: join(taskDir, 'settings.json'),
    ...(brief && { addDir: brief.dir }),
    prompt: openingPrompt({
      agent: 'claude',
      projectDir: '',
      worktreePath: '',
      title: 'Fix login',
      description,
      branch: 'worktree-fix-login',
      noQuestions: false,
      ...(brief && { descriptionFile: brief.file }),
    }),
  });
}

it('on Windows, a description too long for the command line goes to a file the session is given the folder of', async () => {
  const { service, readState, taskDir } = setup({}, 'win32');
  const view = await service.start({ ...NEW_TASK, description: LONG });

  const brief = { dir: join(taskDir(view.id), 'brief'), file: join(taskDir(view.id), 'brief', 'description.md') };
  const { argv } = service.launchSpec(view.session!.id);
  expect(argv).toEqual(expectedStart(readState()[0].claudeSessionId, taskDir(view.id), LONG, brief));
  expect(argv.at(-1)).toContain(brief.file);
  expect(argv.at(-1)).not.toContain('Users get logged out.');
  expect(argv.indexOf('--add-dir')).toBe(argv.indexOf('--settings') - 2);
  expect(argv[argv.indexOf('--add-dir') + 1]).toBe(brief.dir);
  expect(readFileSync(brief.file, 'utf8')).toBe(LONG);
  expect(view.description).toBe(LONG);
});

it('on Windows, a description that fits launches as it does anywhere, with no file', async () => {
  const { service, readState, taskDir } = setup({}, 'win32');
  const view = await service.start(NEW_TASK);

  expect(service.launchSpec(view.session!.id).argv).toEqual(
    expectedStart(readState()[0].claudeSessionId, taskDir(view.id), NEW_TASK.description),
  );
  expect(existsSync(join(taskDir(view.id), 'brief'))).toBe(false);
});

it('on the Mac, a long description stays in the prompt, with no file', async () => {
  const { service, readState, taskDir } = setup();
  const view = await service.start({ ...NEW_TASK, description: LONG });

  expect(service.launchSpec(view.session!.id).argv).toEqual(expectedStart(readState()[0].claudeSessionId, taskDir(view.id), LONG));
  expect(existsSync(join(taskDir(view.id), 'brief'))).toBe(false);
});

it('on Windows, a reopen that must begin the conversation again moves a long description to its file too', async () => {
  const { service, readState, taskDir } = setup({}, 'win32');
  const view = await service.start({ ...NEW_TASK, description: LONG });
  // claude was missing or quit at once: SessionStart never fired.
  service.onSessionExit(view.session!.id);

  const reopened = await service.reopen(view.id);
  const brief = { dir: join(taskDir(view.id), 'brief'), file: join(taskDir(view.id), 'brief', 'description.md') };
  expect(service.launchSpec(reopened.session!.id).argv).toEqual(expectedStart(readState()[0].claudeSessionId, taskDir(view.id), LONG, brief));
  expect(readFileSync(brief.file, 'utf8')).toBe(LONG);
});

const CARD: TaskCardRef = {
  sourceKind: 'Tracker',
  id: 'c128',
  number: '#128',
  url: 'https://tracker.example/c/128',
  labels: ['UI'],
  position: 2,
  urgent: false,
};

it("a task started from a card keeps it, shows it, and its launch carries the card's prompt", async () => {
  const { service, readState } = setup();
  const view = await service.start({ ...NEW_TASK, card: CARD });

  expect(view.card).toEqual(CARD);
  expect(service.list()[0].card).toEqual(CARD);
  expect(readState()[0].card).toEqual(CARD);
  expect(service.launchSpec(view.session!.id).argv.at(-1)).toBe(
    openingPrompt({ agent: 'claude', projectDir: '', worktreePath: '', title: 'Fix login', description: 'Users get logged out', branch: 'worktree-fix-login', noQuestions: false, card: CARD }),
  );
});

it('a task started without a card has none', async () => {
  const { service, readState } = setup();
  const view = await service.start(NEW_TASK);

  expect(view.card).toBeNull();
  expect(readState()[0]).not.toHaveProperty('card');
});

it('a second start of a card whose task is open is refused, and says which task has it', async () => {
  const { service, readState, changes } = setup();
  await service.start({ ...NEW_TASK, card: CARD });
  const before = changes.length;

  await expect(service.start({ ...NEW_TASK, title: 'Again', card: CARD })).rejects.toThrow('#128 is already open as the task "Fix login"');
  await expect(service.start({ ...NEW_TASK, title: 'Again', card: { ...CARD, number: null } })).rejects.toThrow(
    'Again is already open as the task "Fix login"',
  );
  expect(readState()).toHaveLength(1);
  expect(service.sessionIds()).toHaveLength(1);
  expect(changes.length).toBe(before);
});

it('two starts of a card at once start one task', async () => {
  const { service, readState } = setup();
  const results = await Promise.allSettled([service.start({ ...NEW_TASK, card: CARD }), service.start({ ...NEW_TASK, card: CARD })]);

  expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(readState()).toHaveLength(1);
});

it("a task of another card, or of another project, doesn't refuse a start", async () => {
  const { root, stateFile, service, make } = setup();
  await service.start({ ...NEW_TASK, card: CARD });

  await expect(service.start({ ...NEW_TASK, title: 'Other card', card: { ...CARD, id: 'c129' } })).resolves.toBeDefined();
  const globex = make(new TaskRecords(stateFile, 1000, () => {}), join(root, 'Globex'));
  await expect(globex.start({ ...NEW_TASK, title: 'Other project', card: CARD })).resolves.toBeDefined();
});

it("a second start of a card is refused whatever name the latest sync gave its source", async () => {
  const { service, readState } = setup();
  await service.start({ ...NEW_TASK, card: CARD });

  await expect(service.start({ ...NEW_TASK, title: 'Again', card: { ...CARD, sourceKind: 'Tracker Issues' } })).rejects.toThrow(
    '#128 is already open as the task "Fix login"',
  );
  expect(readState()).toHaveLength(1);
});

it('a start of a card whose task has closed is refused, and says to reopen it', async () => {
  const { service, readState, changes } = setup();
  const first = await service.start({ ...NEW_TASK, card: CARD });
  service.close(first.id);
  service.onSessionExit(first.session!.id);
  const before = changes.length;

  await expect(service.start({ ...NEW_TASK, title: 'Again', card: CARD })).rejects.toThrow(
    '#128 already has the task "Fix login"; reopen it instead',
  );
  await expect(service.start({ ...NEW_TASK, title: 'Again', card: { ...CARD, number: null } })).rejects.toThrow(
    'Again already has the task "Fix login"; reopen it instead',
  );
  expect(readState()).toHaveLength(1);
  expect(service.sessionIds()).toEqual([]);
  expect(changes.length).toBe(before);
});

it('start picks a slug that no task, worktree branch or worktree folder has taken', async () => {
  const { service, projectDir } = setup({ worktreeBranchNames: async () => ['fix-login-2'] });
  expect((await service.start(NEW_TASK)).slug).toBe('fix-login');
  mkdirSync(join(projectDir, '.claude', 'worktrees', 'fix-login-3'), { recursive: true });
  expect((await service.start(NEW_TASK)).slug).toBe('fix-login-4');
});

it('start counts a leftover branch or folder that differs only in case as taken', async () => {
  const branch = setup({ worktreeBranchNames: async () => ['Fix-Login'] });
  expect((await branch.service.start(NEW_TASK)).slug).toBe('fix-login-2');

  const folder = setup();
  mkdirSync(join(folder.projectDir, '.claude', 'worktrees', 'Fix-Login'), { recursive: true });
  expect((await folder.service.start(NEW_TASK)).slug).toBe('fix-login-2');
});

it("start keeps the manager's name for the manager: a task titled Manager gets another slug", async () => {
  const { service, readState } = setup();
  expect((await service.start({ ...NEW_TASK, title: 'Manager' })).slug).toBe('manager-2');
  expect(readState()[0].name).toBe('acme-manager-2');
});

it("on Windows, start keeps a task's folder off the names Windows reserves", async () => {
  const { service } = setup({}, 'win32');
  expect((await service.start({ ...NEW_TASK, title: 'Con' })).slug).toBe('con-2');
  expect((await service.start({ ...NEW_TASK, title: 'LPT1' })).slug).toBe('lpt1-2');
});

it('on the Mac, a task titled Con gets the slug con, as before', async () => {
  const { service } = setup({}, 'darwin');
  expect((await service.start({ ...NEW_TASK, title: 'Con' })).slug).toBe('con');
});

it('two starts at once get different slugs', async () => {
  const { service } = setup();
  const [a, b] = await Promise.all([service.start(NEW_TASK), service.start(NEW_TASK)]);
  expect([a.slug, b.slug].sort()).toEqual(['fix-login', 'fix-login-2']);
});

it('start refuses an empty title', async () => {
  const { service, changes, stateFile } = setup();
  await expect(service.start({ ...NEW_TASK, title: '   ' })).rejects.toThrow('title');
  expect(changes).toEqual([]);
  expect(existsSync(stateFile)).toBe(false);
});

it('close kills the session; its exit then closes the task', async () => {
  const { service, killed, readState, sessionStarted } = setup();
  const view = await service.start(NEW_TASK);
  sessionStarted(view.id, readState()[0].claudeSessionId);
  const sessionId = view.session!.id;

  service.close(view.id);
  expect(killed).toEqual([sessionId]);
  expect(service.list()[0].session).toEqual({ id: sessionId, startedWithPrompt: true });
  expect(service.list()[0].closedAt).toBeNull();
  expect(readState()[0]).toMatchObject({ open: false, closedAt: null });

  service.onSessionExit(sessionId);
  expect(service.list()[0]).toMatchObject({ session: null, closedAt: 1000 });
  expect(readState()[0]).toMatchObject({ open: false, closedAt: 1000 });
  expect(() => service.launchSpec(sessionId)).toThrow();

  const reopened = await service.reopen(view.id);
  expect(reopened).toMatchObject({ closedAt: null, session: { startedWithPrompt: false } });
  expect(readState()[0]).toMatchObject({ open: true, closedAt: null });
});

it('a task closed before the quit still closes when its exit arrives', async () => {
  const { service, readState } = setup();
  const view = await service.start(NEW_TASK);

  service.close(view.id);
  service.beginQuit();
  service.onSessionExit(view.session!.id);

  expect(readState()[0]).toMatchObject({ open: false, closedAt: 1000 });
  expect(service.list()[0]).toMatchObject({ session: null, closedAt: 1000 });
});

it('a session that exits by itself closes its task', async () => {
  const { service, killed, readState, changes } = setup();
  const view = await service.start(NEW_TASK);
  const before = changes.length;

  service.onSessionExit(view.session!.id);

  expect(killed).toEqual([]);
  expect(service.list()[0]).toMatchObject({ session: null, closedAt: 1000 });
  expect(readState()[0]).toMatchObject({ open: false, closedAt: 1000 });
  expect(changes.length).toBe(before + 1);
  expect(changes.at(-1)).toEqual(service.list());
});

it('exits during a quit leave tasks open, and restore reopens them', async () => {
  const { service, make, projectDir, readState, taskDir, sessionStarted } = setup();
  const view = await service.start(NEW_TASK);
  sessionStarted(view.id, readState()[0].claudeSessionId);

  service.beginQuit();
  service.onSessionExit(view.session!.id);
  expect(readState()[0]).toMatchObject({ open: true, closedAt: null });
  expect(service.list()[0]).toMatchObject({ session: null, closedAt: null });

  const second = make();
  await second.restore();
  const [restored] = second.list();
  expect(restored).toMatchObject({ id: view.id, closedAt: null, session: { startedWithPrompt: false } });
  expect(second.launchSpec(restored.session!.id)).toEqual({
    cwd: projectDir,
    argv: reopenArgv({
      claudeBin: 'claude',
      slug: 'fix-login',
      claudeSessionId: readState()[0].claudeSessionId,
      settingsPath: join(taskDir(view.id), 'settings.json'),
      branchExists: false,
    }),
  });
});

const RESUME_PROMPT = 'Continue where you left off.';
const ASK_AGAIN_PROMPT = 'The session stopped while you were waiting for my answer. Ask me again.';

/** Each state a session can last report, and whether ending in it leaves the turn owed. */
const END_STATES = [
  ['working', true],
  ['blocked', true],
  ['idle', false],
  ['done', false],
  ['error', false],
  [null, false],
] as const;

/** Starts a task whose conversation has begun, has its session report `states` in order, and closes it. */
async function closedAfter(t: ReturnType<typeof setup>, ...states: (ProgramState | null)[]): Promise<TaskView> {
  const view = await t.service.start(NEW_TASK);
  t.sessionStarted(view.id, t.readState()[0].claudeSessionId);
  for (const state of states) t.service.noteStatus(view.session!.id, state);
  t.service.close(view.id);
  t.service.onSessionExit(view.session!.id);
  return view;
}

it.each(END_STATES)('a session closed while %s leaves midTurn %s', async (state, midTurn) => {
  const { service, readState } = setup();
  const view = await service.start(NEW_TASK);
  service.noteStatus(view.session!.id, state);

  service.close(view.id);
  // Written before the kill, so it is kept if the app dies before the exit arrives.
  expect(readState()[0].midTurn).toBe(midTurn);

  service.onSessionExit(view.session!.id);
  expect(readState()[0].midTurn).toBe(midTurn);
});

it('a session that exits by itself while working leaves midTurn set, and one that finished does not', async () => {
  const { service, readState } = setup();
  const working = await service.start({ ...NEW_TASK, title: 'Working' });
  const done = await service.start({ ...NEW_TASK, title: 'Done' });
  service.noteStatus(working.session!.id, 'working');
  service.noteStatus(done.session!.id, 'working');
  service.noteStatus(done.session!.id, 'done');

  service.onSessionExit(working.session!.id);
  service.onSessionExit(done.session!.id);

  expect(readState().map((t) => [t.id, t.midTurn])).toEqual([[working.id, true], [done.id, false]]);
});

it('the state a session reports as it ends does not change what it was doing', async () => {
  const { service, readState } = setup();
  const closed = await service.start({ ...NEW_TASK, title: 'Closed' });
  const quit = await service.start({ ...NEW_TASK, title: 'Quit' });
  service.noteStatus(closed.session!.id, 'working');
  service.noteStatus(quit.session!.id, 'blocked');

  service.close(closed.id);
  service.beginQuit();
  // A clear on the way out, and the trailing status the host sends once the process has gone.
  service.noteStatus(closed.session!.id, null);
  service.noteStatus(quit.session!.id, null);
  service.onSessionExit(closed.session!.id);
  service.onSessionExit(quit.session!.id);
  service.noteStatus(quit.session!.id, null);

  expect(readState().map((t) => [t.id, t.midTurn])).toEqual([[closed.id, true], [quit.id, true]]);
});

it('quitting with a working session records it before the exit arrives, and restore resumes with the prompt', async () => {
  const { service, make, projectDir, readState, taskDir, sessionStarted } = setup();
  const view = await service.start(NEW_TASK);
  sessionStarted(view.id, readState()[0].claudeSessionId);
  service.noteStatus(view.session!.id, 'working');

  service.beginQuit();
  expect(readState()[0]).toMatchObject({ open: true, midTurn: true });
  service.onSessionExit(view.session!.id);
  expect(readState()[0]).toMatchObject({ open: true, midTurn: true });

  const second = make();
  await second.restore();
  const [restored] = second.list();
  expect(restored).toMatchObject({ id: view.id, closedAt: null, session: { startedWithPrompt: true } });
  expect(second.launchSpec(restored.session!.id)).toEqual({
    cwd: projectDir,
    argv: reopenArgv({
      claudeBin: 'claude',
      slug: 'fix-login',
      claudeSessionId: readState()[0].claudeSessionId,
      settingsPath: join(taskDir(view.id), 'settings.json'),
      branchExists: false,
      prompt: RESUME_PROMPT,
    }),
  });
  expect(second.launchSpec(restored.session!.id).argv.at(-1)).toBe(RESUME_PROMPT);
});

it('a project that closes while restore waits on git starts no session, and leaves the task as it was recorded', async () => {
  let answer!: (exists: boolean) => void;
  const { service, make, readState, sessionStarted } = setup({ branchExists: () => new Promise((resolve) => (answer = resolve)) });
  const view = await service.start(NEW_TASK);
  sessionStarted(view.id, readState()[0].claudeSessionId);
  service.noteStatus(view.session!.id, 'working');
  service.beginQuit();
  service.onSessionExit(view.session!.id);

  const second = make();
  const restoring = second.restore();
  second.beginQuit();
  answer(false);
  await restoring;
  expect(second.sessionIds()).toEqual([]);
  // Still owed its carry-on prompt when the project opens again.
  expect(readState()[0]).toMatchObject({ open: true, midTurn: true });
});

it('quitting with a session that was waiting restores it without the prompt', async () => {
  const { service, make, sessionStarted, readState } = setup();
  const view = await service.start(NEW_TASK);
  sessionStarted(view.id, readState()[0].claudeSessionId);
  service.noteStatus(view.session!.id, 'working');
  service.noteStatus(view.session!.id, 'idle');

  service.beginQuit();
  service.onSessionExit(view.session!.id);

  const second = make();
  await second.restore();
  const [restored] = second.list();
  expect(restored.session).toEqual({ id: expect.any(String), startedWithPrompt: false });
  expect(second.launchSpec(restored.session!.id).argv).not.toContain(RESUME_PROMPT);
});

// Working, it carries on; waiting for the owner's answer, Claude is asked to ask again, never to
// pick an answer itself. Either way the card stays in Working. Done with its turn, it has no prompt.
it.each([
  [['working'], RESUME_PROMPT],
  [['working', 'blocked'], ASK_AGAIN_PROMPT],
  [['working', 'idle'], null],
] as const)('reopen of a session closed after %j resumes with %j', async (states, prompt) => {
  const t = setup();
  const view = await closedAfter(t, ...states);

  const reopened = await t.service.reopen(view.id);
  expect(reopened.session).toEqual({ id: expect.any(String), startedWithPrompt: prompt !== null });
  expect(t.service.launchSpec(reopened.session!.id).argv).toEqual([
    'claude', '--resume', t.readState()[0].claudeSessionId, '--settings', join(t.taskDir(view.id), 'settings.json'),
    ...(prompt === null ? [] : [prompt]),
  ]);
});

it('a task saved before askAgain existed resumes mid-turn with Continue', async () => {
  const t = setup();
  const view = await closedAfter(t, 'working');
  const record = t.readState()[0];
  delete record.askAgain;
  writeFileSync(t.stateFile, JSON.stringify({ version: 1, tasks: [record] }));

  const second = t.make();
  const reopened = await second.reopen(view.id);
  expect(second.launchSpec(reopened.session!.id).argv.at(-1)).toBe(RESUME_PROMPT);
});

it.each([
  ['working', RESUME_PROMPT],
  ['blocked', ASK_AGAIN_PROMPT],
] as const)('a resume prompt that never took is owed again, the same one: closed while %s', async (state, prompt) => {
  const t = setup();
  const { service, readState } = t;
  const view = await closedAfter(t, state);
  expect(readState()[0].midTurn).toBe(true);

  const first = await service.reopen(view.id);
  expect(readState()[0].midTurn).toBe(false);
  expect(service.launchSpec(first.session!.id).argv.at(-1)).toBe(prompt);

  // The launch failed, or the app quit at once: Claude never began the turn it was asked to.
  service.onSessionExit(first.session!.id);
  expect(readState()[0].midTurn).toBe(true);

  const second = await service.reopen(view.id);
  expect(service.launchSpec(second.session!.id).argv.at(-1)).toBe(prompt);
  expect(second.session!.startedWithPrompt).toBe(true);
});

it('a resume prompt that has only met an idle report has not taken either', async () => {
  const t = setup();
  const { service, readState } = t;
  const view = await closedAfter(t, 'working');

  const first = await service.reopen(view.id);
  // Claude Code is idle until it submits the prompt.
  service.noteStatus(first.session!.id, 'idle');
  service.close(view.id);
  service.onSessionExit(first.session!.id);
  expect(readState()[0].midTurn).toBe(true);
});

it.each(END_STATES)('a resumed session that worked and then ended %s leaves midTurn %s', async (end, midTurn) => {
  const t = setup();
  const { service, readState } = t;
  const view = await closedAfter(t, 'working');

  const resumed = await service.reopen(view.id);
  service.noteStatus(resumed.session!.id, 'working');
  service.noteStatus(resumed.session!.id, end);
  service.close(view.id);
  service.onSessionExit(resumed.session!.id);

  expect(readState()[0].midTurn).toBe(midTurn);
  const next = await service.reopen(view.id);
  expect(next.session!.startedWithPrompt).toBe(midTurn);
});

it('an ask-again from an earlier turn does not outlive it: a resumed session that worked gets Continue next', async () => {
  const t = setup();
  const view = await closedAfter(t, 'blocked');
  const resumed = await t.service.reopen(view.id);
  t.service.noteStatus(resumed.session!.id, 'working');
  t.service.close(view.id);
  t.service.onSessionExit(resumed.session!.id);

  const next = await t.service.reopen(view.id);
  expect(t.service.launchSpec(next.session!.id).argv.at(-1)).toBe(RESUME_PROMPT);
});

it('quitting while Claude waits for the owner restores with the ask-again prompt', async () => {
  const { service, make, sessionStarted, readState } = setup();
  const view = await service.start(NEW_TASK);
  sessionStarted(view.id, readState()[0].claudeSessionId);
  service.noteStatus(view.session!.id, 'blocked');
  service.beginQuit();
  service.onSessionExit(view.session!.id);

  const second = make();
  await second.restore();
  const [restored] = second.list();
  expect(second.launchSpec(restored.session!.id).argv.at(-1)).toBe(ASK_AGAIN_PROMPT);
});

it('a quit before a restored session has reported anything keeps the turn owed, for the next restore', async () => {
  const { service, make, readState, sessionStarted } = setup();
  const view = await service.start(NEW_TASK);
  sessionStarted(view.id, readState()[0].claudeSessionId);
  service.noteStatus(view.session!.id, 'working');
  service.beginQuit();
  service.onSessionExit(view.session!.id);

  const second = make();
  await second.restore();
  const [restored] = second.list();
  expect(restored.session!.startedWithPrompt).toBe(true);
  expect(readState()[0].midTurn).toBe(false);

  // Quit again before the restored session has said anything, or has been spawned at all.
  second.beginQuit();
  expect(readState()[0]).toMatchObject({ open: true, midTurn: true });
  second.onSessionExit(restored.session!.id);
  expect(readState()[0]).toMatchObject({ open: true, midTurn: true });

  const third = make();
  await third.restore();
  const [again] = third.list();
  expect(again.session!.startedWithPrompt).toBe(true);
  expect(third.launchSpec(again.session!.id).argv.at(-1)).toBe(RESUME_PROMPT);
});

it('a reopen that starts the conversation over clears midTurn and gives it the opening prompt only', async () => {
  const { service, readState } = setup();
  const view = await service.start(NEW_TASK);
  service.noteStatus(view.session!.id, 'working');
  // SessionStart never fired, so there is no conversation to resume.
  service.onSessionExit(view.session!.id);
  expect(readState()[0].midTurn).toBe(true);

  const reopened = await service.reopen(view.id);
  expect(readState()[0].midTurn).toBe(false);
  expect(service.launchSpec(reopened.session!.id).argv).not.toContain(RESUME_PROMPT);
  expect(service.launchSpec(reopened.session!.id).argv).toContain('-w');
});

it('a task kept before midTurn was recorded reopens without the prompt', async () => {
  const { projectDir, stateFile, make, readState, taskDir, sessionStarted } = setup();
  const old: TaskRecord = {
    id: 'old',
    projectDir,
    title: 'Fix login',
    description: '',
    slug: 'fix-login',
    name: 'acme-fix-login',
    claudeSessionId: '0b7e8a52-2f4c-4f7e-9a51-6d2c3c1b9e10',
    worktreePath: join(projectDir, '.claude', 'worktrees', 'fix-login'),
    branch: 'worktree-fix-login',
    createdAt: 5,
    closedAt: 6,
    open: false,
  };
  writeFileSync(stateFile, JSON.stringify({ version: 1, tasks: [old] }));
  mkdirSync(taskDir(old.id), { recursive: true });
  sessionStarted(old.id, old.claudeSessionId);

  const service = make();
  const reopened = await service.reopen('old');
  expect(reopened.session).toEqual({ id: expect.any(String), startedWithPrompt: false });
  expect(service.launchSpec(reopened.session!.id).argv).not.toContain(RESUME_PROMPT);
  expect(readState()[0].midTurn).toBe(false);
});

it('a status that arrives after the session has ended, or for no session, changes nothing', async () => {
  const { service, readState } = setup();
  const view = await service.start(NEW_TASK);
  service.noteStatus(view.session!.id, 'idle');
  service.onSessionExit(view.session!.id);
  expect(readState()[0].midTurn).toBe(false);

  service.noteStatus(view.session!.id, 'working');
  service.noteStatus('nobody', 'working');
  expect(readState()[0].midTurn).toBe(false);
  expect(service.list()[0].session).toBeNull();
});

it("restore leaves closed tasks closed and other projects' tasks alone", async () => {
  const { service, make, stateFile, readState } = setup();
  const kept = await service.start({ ...NEW_TASK, title: 'Kept' });
  const closed = await service.start({ ...NEW_TASK, title: 'Closed' });
  service.close(closed.id);
  service.onSessionExit(closed.session!.id);
  service.beginQuit();
  service.onSessionExit(kept.session!.id);

  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const other = { ...state.tasks[0], id: 'other', projectDir: '/other', open: true };
  state.tasks.push(other);
  writeFileSync(stateFile, JSON.stringify(state));

  const second = make();
  await second.restore();
  expect(second.list().map((t) => [t.id, t.session !== null])).toEqual([
    [kept.id, true],
    [closed.id, false],
  ]);
  expect(readState().find((t) => t.id === 'other')).toEqual(other);
});

it('restore skips a task it cannot reopen, closes it, and reopens the rest', async () => {
  const { projectDir, stateFile, make, warnings, readState, taskDir, sessionStarted } = setup({
    branchExists: async (_dir, branch) => {
      if (branch === 'worktree-broken') throw new Error('git broke');
      return false;
    },
  });
  const record = (id: string, claudeSessionId: string): TaskRecord => ({
    id,
    projectDir,
    title: id,
    description: '',
    slug: id,
    name: `acme-${id}`,
    claudeSessionId,
    worktreePath: join(projectDir, '.claude', 'worktrees', id),
    branch: `worktree-${id}`,
    createdAt: 5,
    closedAt: null,
    open: true,
  });
  const seeded = [
    record('broken', '5d1f2c3a-8e4b-4c6d-9f0a-1b2c3d4e5f60'),
    record('fine', '0b7e8a52-2f4c-4f7e-9a51-6d2c3c1b9e10'),
  ];
  writeFileSync(stateFile, JSON.stringify({ version: 1, tasks: seeded }));
  for (const task of seeded) {
    mkdirSync(taskDir(task.id), { recursive: true });
    sessionStarted(task.id, task.claudeSessionId);
  }

  const service = make();
  await service.restore();

  const [broken, fine] = service.list();
  expect(broken).toMatchObject({ id: 'broken', session: null, closedAt: 1000 });
  expect(fine).toMatchObject({ id: 'fine', closedAt: null, session: { startedWithPrompt: false } });
  expect(readState().map((t) => [t.id, t.open])).toEqual([['broken', false], ['fine', true]]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('broken');
});

it('reopen resumes in the worktree while its branch exists, and in the main checkout once it is gone', async () => {
  let branchExists = true;
  const { service, readState, taskDir, sessionStarted } = setup({ branchExists: async () => branchExists });
  const view = await service.start(NEW_TASK);
  const { claudeSessionId } = readState()[0];
  sessionStarted(view.id, claudeSessionId);
  const settingsPath = join(taskDir(view.id), 'settings.json');

  service.onSessionExit(view.session!.id);
  const inWorktree = await service.reopen(view.id);
  expect(service.launchSpec(inWorktree.session!.id).argv).toEqual([
    'claude', '--worktree', 'fix-login', '--resume', claudeSessionId, '--settings', settingsPath,
  ]);

  branchExists = false;
  service.onSessionExit(inWorktree.session!.id);
  const inMain = await service.reopen(view.id);
  expect(service.launchSpec(inMain.session!.id).argv).toEqual([
    'claude', '--resume', claudeSessionId, '--settings', settingsPath,
  ]);
});

it("a reopen whose git can't run fails, and starts no session and leaves the task as recorded", async () => {
  const noGit = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
  const { service, readState, changes } = setup({ branchExists: async () => { throw noGit; } });
  const view = await service.start(NEW_TASK);
  service.onSessionExit(view.session!.id);
  const [recorded, listed, before] = [readState(), service.list(), changes.length];

  await expect(service.reopen(view.id)).rejects.toBe(noGit);
  expect(service.sessionIds()).toEqual([]);
  expect(readState()).toEqual(recorded);
  expect(service.list()).toEqual(listed);
  expect(changes.length).toBe(before);
});

it('reopen asks git about the main checkout and the real branch', async () => {
  const asked: unknown[][] = [];
  const { service, projectDir } = setup({ branchExists: async (...args) => (asked.push(args), true) });
  const view = await service.start(NEW_TASK);
  service.onSessionExit(view.session!.id);
  await service.reopen(view.id);
  expect(asked).toEqual([[projectDir, 'worktree-fix-login']]);
});

it('reopen continues the conversation SessionStart last recorded', async () => {
  const U2 = '11111111-1111-4111-8111-111111111111';
  const { service, readState, taskDir } = setup();
  const view = await service.start(NEW_TASK);
  expect(readState()[0].claudeSessionId).not.toBe(U2);

  writeFileSync(join(taskDir(view.id), SESSION_START_FILE), JSON.stringify({ session_id: U2, source: 'clear' }));
  service.onSessionExit(view.session!.id);
  expect(readState()[0].claudeSessionId).toBe(U2);

  const reopened = await service.reopen(view.id);
  expect(service.launchSpec(reopened.session!.id).argv).toEqual(
    reopenArgv({
      claudeBin: 'claude',
      slug: 'fix-login',
      claudeSessionId: U2,
      settingsPath: join(taskDir(view.id), 'settings.json'),
      branchExists: false,
    }),
  );
  expect(readState()[0].claudeSessionId).toBe(U2);
});

it('reopen reads the id SessionStart recorded after the exit, too', async () => {
  const U2 = '11111111-1111-4111-8111-111111111111';
  const { service, readState, taskDir } = setup();
  const view = await service.start(NEW_TASK);
  service.onSessionExit(view.session!.id);

  writeFileSync(join(taskDir(view.id), SESSION_START_FILE), JSON.stringify({ session_id: U2 }));
  const reopened = await service.reopen(view.id);
  expect(service.launchSpec(reopened.session!.id).argv).toContain(U2);
  expect(readState()[0].claudeSessionId).toBe(U2);
});

// A task is resumed whatever SessionStart recorded: Claude Code's chat files are not Mainframe's to look for, and a
// task restarted from its opening prompt would redo work its worktree already has.
it('reopen resumes the recorded conversation although no transcript of it can be found', async () => {
  const { service, readState, taskDir, dataDir } = setup();
  const view = await service.start(NEW_TASK);
  const { claudeSessionId } = readState()[0];
  const transcript_path = join(dataDir, 'projects', '-acme', `${claudeSessionId}.jsonl`);
  writeFileSync(join(taskDir(view.id), SESSION_START_FILE), JSON.stringify({ session_id: claudeSessionId, source: 'startup', transcript_path }));
  service.onSessionExit(view.session!.id);

  const reopened = await service.reopen(view.id);
  expect(service.launchSpec(reopened.session!.id).argv).toEqual(
    reopenArgv({
      claudeBin: 'claude',
      slug: 'fix-login',
      claudeSessionId,
      settingsPath: join(taskDir(view.id), 'settings.json'),
      branchExists: false,
    }),
  );
  expect(readState()[0].claudeSessionId).toBe(claudeSessionId);
});

it('reopen of a task whose first launch never began a conversation starts one, with a fresh id and the same prompt', async () => {
  const { service, readState, taskDir } = setup();
  const view = await service.start({ ...NEW_TASK, noQuestions: true });
  const first = readState()[0].claudeSessionId;
  // claude was missing or quit at once: SessionStart never fired.
  service.onSessionExit(view.session!.id);

  const reopened = await service.reopen(view.id);
  expect(reopened).toMatchObject({ closedAt: null, session: { startedWithPrompt: true } });
  const [record] = readState();
  expect(record).toMatchObject({ open: true, closedAt: null });
  expect(record.claudeSessionId).not.toBe(first);
  expect(service.launchSpec(reopened.session!.id).argv).toEqual(
    startArgv({
      claudeBin: 'claude',
      slug: 'fix-login',
      name: 'acme-fix-login',
      claudeSessionId: record.claudeSessionId,
      settingsPath: join(taskDir(view.id), 'settings.json'),
      prompt: openingPrompt({ agent: 'claude', projectDir: '', worktreePath: '', title: 'Fix login', description: 'Users get logged out', branch: 'worktree-fix-login', noQuestions: true }),
    }),
  );
});

it('a reopen that must begin the conversation again keeps the card in its prompt', async () => {
  const { service } = setup();
  const view = await service.start({ ...NEW_TASK, card: CARD });
  // claude was missing or quit at once: SessionStart never fired.
  service.onSessionExit(view.session!.id);

  const reopened = await service.reopen(view.id);
  expect(reopened.card).toEqual(CARD);
  expect(service.launchSpec(reopened.session!.id).argv.at(-1)).toBe(
    openingPrompt({ agent: 'claude', projectDir: '', worktreePath: '', title: 'Fix login', description: 'Users get logged out', branch: 'worktree-fix-login', noQuestions: false, card: CARD }),
  );
});

it('a task kept before its noQuestions was recorded reopens with the prompt that asks questions', async () => {
  const { projectDir, stateFile, make, readState } = setup();
  const old: TaskRecord = {
    id: 'old',
    projectDir,
    title: 'Fix login',
    description: '',
    slug: 'fix-login',
    name: 'acme-fix-login',
    claudeSessionId: '0b7e8a52-2f4c-4f7e-9a51-6d2c3c1b9e10',
    worktreePath: join(projectDir, '.claude', 'worktrees', 'fix-login'),
    branch: 'worktree-fix-login',
    createdAt: 5,
    closedAt: 6,
    open: false,
  };
  writeFileSync(stateFile, JSON.stringify({ version: 1, tasks: [old] }));

  const service = make();
  const reopened = await service.reopen('old');
  expect(service.launchSpec(reopened.session!.id).argv.at(-1)).toBe(
    openingPrompt({ agent: 'claude', projectDir: '', worktreePath: '', title: 'Fix login', description: '', branch: 'worktree-fix-login', noQuestions: false }),
  );
  expect(readState()[0]).not.toHaveProperty('noQuestions');
});

it('reopen writes the hooks file again, and its folder, if they have gone', async () => {
  const { service, taskDir } = setup();
  const view = await service.start(NEW_TASK);
  service.onSessionExit(view.session!.id);
  rmSync(taskDir(view.id), { recursive: true });

  await service.reopen(view.id);
  expect(readFileSync(join(taskDir(view.id), 'settings.json'), 'utf8')).toBe(hookSettings(taskDir(view.id), NODE));
});

it('reopen of a running task changes nothing', async () => {
  const { service, killed, changes } = setup();
  const view = await service.start(NEW_TASK);
  const before = changes.length;

  expect(await service.reopen(view.id)).toEqual(view);
  expect(service.list()).toEqual([view]);
  expect(killed).toEqual([]);
  expect(changes.length).toBe(before);
});

it('two reopens at once start one session', async () => {
  const { service } = setup();
  const view = await service.start(NEW_TASK);
  service.onSessionExit(view.session!.id);

  const [a, b] = await Promise.all([service.reopen(view.id), service.reopen(view.id)]);
  expect(a.session!.id).toBe(b.session!.id);
});

it('tasks of other projects are kept and not listed', async () => {
  const { service, stateFile, readState, make } = setup();
  const other = {
    id: 'other-task',
    projectDir: '/other',
    title: 'Elsewhere',
    description: '',
    slug: 'elsewhere',
    name: 'other-elsewhere',
    claudeSessionId: '0b7e8a52-2f4c-4f7e-9a51-6d2c3c1b9e10',
    worktreePath: '/other/.claude/worktrees/elsewhere',
    branch: 'worktree-elsewhere',
    createdAt: 5,
    closedAt: 6,
    open: false,
    keptAsIs: { nested: [1, 2] },
  };
  writeFileSync(stateFile, JSON.stringify({ version: 1, tasks: [other] }));

  const seeded = make();
  expect(seeded.list()).toEqual([]);
  const view = await seeded.start(NEW_TASK);

  expect(seeded.list()).toEqual([view]);
  expect(readState()).toHaveLength(2);
  expect(readState()[0]).toEqual(other);
  expect(service.list()).toEqual([]);
});

it("two projects open in one run keep each other's tasks in state.json", async () => {
  const { root, stateFile, make, readState } = setup();
  const records = new TaskRecords(stateFile, 1000, () => {});
  const acme = make(records);
  const globex = make(records, join(root, 'Globex'));

  const a = await acme.start(NEW_TASK);
  const g = await globex.start({ ...NEW_TASK, title: 'Ship it' });
  acme.close(a.id);

  expect(readState().map((t) => [t.id, t.open])).toEqual([[a.id, false], [g.id, true]]);
  expect(acme.list().map((t) => t.id)).toEqual([a.id]);
  expect(globex.list().map((t) => t.id)).toEqual([g.id]);
});

it('a task of another project is unknown to every call', async () => {
  const { service, stateFile, make, killed, changes } = setup();
  const view = await service.start(NEW_TASK);
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  state.tasks[0].projectDir = '/other';
  writeFileSync(stateFile, JSON.stringify(state));

  const second = make();
  const before = changes.length;
  await expect(second.reopen(view.id)).rejects.toThrow();
  expect(await second.changedFiles(view.id)).toBeNull();
  second.close(view.id);
  expect(killed).toEqual([]);
  expect(changes.length).toBe(before);
});

it('unknown ids are refused or ignored', async () => {
  const { service, killed, changes, stateFile } = setup();

  await expect(service.reopen('nope')).rejects.toThrow('nope');
  expect(await service.changedFiles('nope')).toBeNull();
  expect(() => service.launchSpec('nope')).toThrow('nope');
  service.close('nope');
  service.onSessionExit('nope');

  expect(killed).toEqual([]);
  expect(changes).toEqual([]);
  expect(existsSync(stateFile)).toBe(false);
});

it('close of a task with no running session does nothing', async () => {
  const { service, killed, changes } = setup();
  const view = await service.start(NEW_TASK);
  service.onSessionExit(view.session!.id);
  const before = changes.length;

  service.close(view.id);

  expect(killed).toEqual([]);
  expect(changes.length).toBe(before);
});

it('startCheck asks git about the project', async () => {
  const check = { ahead: 2, branch: 'stage', base: 'origin/stage' };
  const asked: string[] = [];
  const { service, projectDir } = setup({ startCheck: async (dir) => (asked.push(dir), check) });
  expect(await service.startCheck()).toEqual(check);
  expect(asked).toEqual([projectDir]);
});

it("changedFiles asks git about the task's worktree", async () => {
  const files: ChangedFile[] = [{ path: 'src/a.ts', status: 'M', added: 3, removed: 1 }];
  const asked: string[] = [];
  const { service } = setup({ changedFiles: async (dir) => (asked.push(dir), files) });
  const view = await service.start(NEW_TASK);

  expect(await service.changedFiles(view.id)).toEqual(files);
  expect(asked).toEqual([view.worktreePath]);
});

it('reports lists every task oldest first: a running one with its last state and message, a closed one as not running', async () => {
  const { service, projectDir, readState, statuses } = setup();
  const first = await service.start({ ...NEW_TASK, title: 'First' });
  const second = await service.start({ ...NEW_TASK, title: 'Second', card: CARD });
  statuses.set(first.session!.id, { id: '', state: 'blocked', msg: 'Run rm -rf build?', updatedAt: 1 });
  statuses.set(second.session!.id, { id: '', state: 'working', updatedAt: 1 });
  service.close(second.id);
  service.onSessionExit(second.session!.id);

  const [firstRecord, secondRecord] = readState();
  expect(service.reports()).toEqual([
    {
      taskId: first.id,
      title: 'First',
      branch: 'worktree-first',
      worktreePath: join(projectDir, '.claude', 'worktrees', 'first'),
      claudeSessionId: firstRecord.claudeSessionId,
      createdAt: 1000,
      closedAt: null,
      running: true,
      state: 'blocked',
      msg: 'Run rm -rf build?',
      card: null,
      agent: 'claude',
    },
    {
      taskId: second.id,
      title: 'Second',
      branch: 'worktree-second',
      worktreePath: join(projectDir, '.claude', 'worktrees', 'second'),
      claudeSessionId: secondRecord.claudeSessionId,
      createdAt: 1000,
      closedAt: 1000,
      running: false,
      state: null,
      msg: null,
      card: { number: '#128', url: 'https://tracker.example/c/128' },
      agent: 'claude',
    },
  ]);
});

it('names the sessions it runs', async () => {
  const { service } = setup();
  const a = await service.start(NEW_TASK);
  const b = await service.start({ ...NEW_TASK, title: 'Ship it' });
  service.onSessionExit(b.session!.id);

  expect(service.sessionIds()).toEqual([a.session!.id]);
});

const OPENCODE_TASK = { ...NEW_TASK, agent: 'opencode' as const };

/** Records each call to `git worktree add` the service makes. */
function recordingAdds(): { added: unknown[][]; addWorktree: GitQueries['addWorktree'] } {
  const added: unknown[][] = [];
  return { added, addWorktree: async (...args) => void added.push(args) };
}

it('an OpenCode task starts in its worktree', async () => {
  const { added, addWorktree } = recordingAdds();
  const { service, projectDir, readState, taskDir } = setup({ addWorktree });
  const view = await service.start(OPENCODE_TASK);
  const worktreePath = join(projectDir, '.claude', 'worktrees', 'fix-login');

  expect(added).toEqual([[projectDir, worktreePath, 'worktree-fix-login', { create: true }]]);
  const [record] = readState();
  expect(isOpencodeSessionId(record.claudeSessionId)).toBe(true);
  expect(record.agent).toBe('opencode');
  expect(service.launchSpec(view.session!.id)).toEqual({
    argv: [
      '/bin/opencode', '--standalone', '-s', record.claudeSessionId, '--prompt',
      openingPrompt({ agent: 'opencode', projectDir, worktreePath, title: 'Fix login', description: 'Users get logged out', branch: 'worktree-fix-login', noQuestions: false }),
    ],
    cwd: worktreePath,
    env: OPENCODE_ENV,
  });
  expect(service.list()[0].agent).toBe('opencode');
  expect(view.session).toMatchObject({ startedWithPrompt: true });
  expect(existsSync(join(taskDir(view.id), 'settings.json'))).toBe(false);
});

it("a Claude task's launch is unchanged", async () => {
  const { added, addWorktree } = recordingAdds();
  const { service, projectDir, readState, taskDir } = setup({ addWorktree });
  const view = await service.start(NEW_TASK);

  const spec = service.launchSpec(view.session!.id);
  expect(spec).not.toHaveProperty('env');
  expect(spec).toEqual({ cwd: projectDir, argv: expectedStart(readState()[0].claudeSessionId, taskDir(view.id), NEW_TASK.description) });
  expect(added).toEqual([]);
  expect(view.agent).toBe('claude');
  expect(readState()[0].agent).toBe('claude');
});

it('two OpenCode starts at once get two slugs', async () => {
  const { service } = setup();
  const [a, b] = await Promise.all([
    service.start({ ...OPENCODE_TASK, title: 'Same' }),
    service.start({ ...OPENCODE_TASK, title: 'Same' }),
  ]);
  expect([a.slug, b.slug].sort()).toEqual(['same', 'same-2']);
});

it('a failed worktree add leaves no task', async () => {
  const { service, changes, stateFile } = setup({ addWorktree: async () => { throw new Error('fatal: x'); } });
  await expect(service.start(OPENCODE_TASK)).rejects.toThrow('fatal: x');
  expect(service.list()).toEqual([]);
  expect(service.sessionIds()).toEqual([]);
  // The window gets the list without the task, in case another change meanwhile showed it.
  expect(changes).toEqual([[]]);
  expect(JSON.parse(readFileSync(stateFile, 'utf8')).tasks).toEqual([]);
});

it("a failed worktree add takes the task out of state.json, though another project saved it meanwhile", async () => {
  let fail!: (err: Error) => void;
  const { root, stateFile, make, readState } = setup({ addWorktree: () => new Promise((_, reject) => (fail = reject)) });
  const records = new TaskRecords(stateFile, 1000, () => {});
  const acme = make(records);
  const globex = make(records, join(root, 'Globex'));

  const starting = acme.start(OPENCODE_TASK);
  await new Promise((resolve) => setImmediate(resolve));
  const shipped = await globex.start({ ...NEW_TASK, title: 'Ship it' });
  expect(readState().map((t) => t.title)).toEqual(['Fix login', 'Ship it']);

  fail(new Error('fatal: x'));
  await expect(starting).rejects.toThrow('fatal: x');
  expect(readState().map((t) => t.id)).toEqual([shipped.id]);
  expect(acme.list()).toEqual([]);
});

it("a start on an agent that isn't installed says so", async () => {
  const { added, addWorktree } = recordingAdds();
  const agents = fakeAgents();
  agents.bins.opencode = null;
  const { service, stateFile } = setup({ addWorktree }, 'darwin', agents);
  await expect(service.start(OPENCODE_TASK)).rejects.toThrow('OpenCode 2.1.0 or later is not installed');
  expect(added).toEqual([]);
  expect(existsSync(stateFile)).toBe(false);
});

it('a start without an agent runs on the default agent', async () => {
  const { service, agents, readState } = setup();
  agents.default = 'opencode';
  const view = await service.start(NEW_TASK);
  expect(view.agent).toBe('opencode');
  expect(readState()[0].agent).toBe('opencode');
  expect(service.launchSpec(view.session!.id).argv[0]).toBe('/bin/opencode');
});

it('two projects share one AgentsInUse', async () => {
  const { root, stateFile, make, agents } = setup();
  const records = new TaskRecords(stateFile, 1000, () => {});
  const acme = make(records);
  const globex = make(records, join(root, 'Globex'));
  expect((await acme.start(NEW_TASK)).agent).toBe('claude');
  expect((await globex.start(NEW_TASK)).agent).toBe('claude');

  agents.default = 'opencode';
  expect((await acme.start({ ...NEW_TASK, title: 'Ship it' })).agent).toBe('opencode');
  expect((await globex.start({ ...NEW_TASK, title: 'Ship it' })).agent).toBe('opencode');
});

it("an unticked agent's task still reopens; a new task on it is refused", async () => {
  const { service, agents, stateFile } = setup();
  const view = await service.start(OPENCODE_TASK);
  service.onSessionExit(view.session!.id);

  agents.on = ['claude'];
  const reopened = await service.reopen(view.id);
  expect(service.launchSpec(reopened.session!.id).argv[0]).toBe('/bin/opencode');
  const before = readFileSync(stateFile, 'utf8');
  await expect(service.start({ ...OPENCODE_TASK, title: 'Ship it' })).rejects.toThrow('OpenCode is turned off in Settings');
  expect(readFileSync(stateFile, 'utf8')).toBe(before);
});

it('reopen resumes the same OpenCode session', async () => {
  const { service, readState, taskDir } = setup();
  const view = await service.start(OPENCODE_TASK);
  const { claudeSessionId } = readState()[0];
  // A Claude SessionStart record is not an OpenCode task's to follow.
  mkdirSync(taskDir(view.id), { recursive: true });
  writeFileSync(join(taskDir(view.id), SESSION_START_FILE), JSON.stringify({ session_id: '11111111-1111-4111-8111-111111111111' }));
  // Its conversation began, and its turn is over.
  service.noteStatus(view.session!.id, 'working');
  service.noteStatus(view.session!.id, 'done');
  service.onSessionExit(view.session!.id);
  expect(readState()[0].claudeSessionId).toBe(claudeSessionId);

  const resumed = await service.reopen(view.id);
  expect(service.launchSpec(resumed.session!.id).argv).toEqual(['/bin/opencode', '--standalone', '-s', claudeSessionId]);
  expect(resumed.session).toMatchObject({ startedWithPrompt: false });

  service.noteStatus(resumed.session!.id, 'working');
  service.onSessionExit(resumed.session!.id);
  const carriedOn = await service.reopen(view.id);
  expect(service.launchSpec(carriedOn.session!.id).argv).toEqual(['/bin/opencode', '--standalone', '-s', claudeSessionId, '--prompt', RESUME_PROMPT]);
  expect(carriedOn.session).toMatchObject({ startedWithPrompt: true });
  expect(readState()[0]).toMatchObject({ claudeSessionId, midTurn: false, open: true });
});

/** The opening prompt of an OpenCode task started from OPENCODE_TASK in `projectDir`. */
const opencodeOpening = (projectDir: string, title = 'Fix login', slug = 'fix-login') =>
  openingPrompt({
    agent: 'opencode',
    projectDir,
    worktreePath: join(projectDir, '.claude', 'worktrees', slug),
    title,
    description: 'Users get logged out',
    branch: `worktree-${slug}`,
    noQuestions: false,
  });

it('an OpenCode task whose conversation never began gets its brief on reopen', async () => {
  const { service, projectDir, readState } = setup();
  const view = await service.start(OPENCODE_TASK);
  const { claudeSessionId } = readState()[0];
  // OpenCode was quit at its login screen: it never reported a turn.
  service.noteStatus(view.session!.id, 'idle');
  service.onSessionExit(view.session!.id);

  const reopened = await service.reopen(view.id);
  expect(service.launchSpec(reopened.session!.id).argv).toEqual([
    '/bin/opencode', '--standalone', '-s', claudeSessionId, '--prompt', opencodeOpening(projectDir),
  ]);
  expect(reopened.session).toMatchObject({ startedWithPrompt: true });
});

it('an OpenCode task remembers its conversation began across runs', async () => {
  const { service, make, readState } = setup();
  const view = await service.start(OPENCODE_TASK);
  service.noteStatus(view.session!.id, 'blocked');
  expect(readState()[0].began).toBe(true);
  service.beginQuit();
  service.onSessionExit(view.session!.id);

  const next = make();
  await next.restore();
  const [reopened] = next.list();
  // Blocked as it quit: the carry-on prompt, not the brief.
  expect(next.launchSpec(reopened.session!.id).argv.slice(-2)).toEqual(['--prompt', ASK_AGAIN_PROMPT]);
});

it('a Claude task records no began', async () => {
  const { service, readState } = setup();
  const view = await service.start(NEW_TASK);
  service.noteStatus(view.session!.id, 'working');
  expect(readState()[0]).not.toHaveProperty('began');
});

it('an OpenCode start that meets a quit records the task, which begins with its brief at the next start', async () => {
  let added!: () => void;
  const { service, make, projectDir, readState } = setup({ addWorktree: () => new Promise<void>((resolve) => (added = resolve)) });
  const starting = service.start(OPENCODE_TASK);
  await new Promise((resolve) => setImmediate(resolve));
  service.beginQuit();
  added();

  const view = await starting;
  expect(view.session).toBeNull();
  expect(service.sessionIds()).toEqual([]);
  expect(readState()[0]).toMatchObject({ id: view.id, open: true });

  const next = make();
  await next.restore();
  const [restored] = next.list();
  expect(next.launchSpec(restored.session!.id).argv).toEqual([
    '/bin/opencode', '--standalone', '-s', readState()[0].claudeSessionId, '--prompt', opencodeOpening(projectDir),
  ]);
});

it('an OpenCode task stays off the list and the reports until its worktree is there', async () => {
  let added!: () => void;
  const { service, changes } = setup({ addWorktree: () => new Promise<void>((resolve) => (added = resolve)) });
  const starting = service.start(OPENCODE_TASK);
  await new Promise((resolve) => setImmediate(resolve));
  // Another task's change meanwhile shows the board without it.
  await service.start({ ...NEW_TASK, title: 'Ship it' });
  expect(service.list().map((t) => t.title)).toEqual(['Ship it']);
  expect(service.reports().map((r) => r.title)).toEqual(['Ship it']);
  expect(changes.at(-1)!.map((t) => t.title)).toEqual(['Ship it']);

  added();
  const view = await starting;
  expect(service.list().map((t) => t.id)).toContain(view.id);
  expect(service.reports().map((r) => r.taskId)).toContain(view.id);
});

it('reopen adds a deleted worktree back', async () => {
  let branchExists = true;
  const { added, addWorktree } = recordingAdds();
  const { service, projectDir } = setup({ addWorktree, branchExists: async () => branchExists });
  const view = await service.start(OPENCODE_TASK);
  added.length = 0;
  service.onSessionExit(view.session!.id);

  // The worktree folder was deleted by hand; its branch is still there.
  const readded = await service.reopen(view.id);
  expect(added).toEqual([[projectDir, view.worktreePath, view.branch, { create: false }]]);
  expect(service.launchSpec(readded.session!.id).cwd).toBe(view.worktreePath);

  branchExists = false;
  added.length = 0;
  service.onSessionExit(readded.session!.id);
  const inMain = await service.reopen(view.id);
  expect(added).toEqual([]);
  expect(service.launchSpec(inMain.session!.id).cwd).toBe(projectDir);
});

it('reopen runs in a worktree folder that is there, without adding it', async () => {
  const { added, addWorktree } = recordingAdds();
  const { service } = setup({ addWorktree, branchExists: async () => true });
  const view = await service.start(OPENCODE_TASK);
  mkdirSync(view.worktreePath, { recursive: true });
  added.length = 0;
  service.onSessionExit(view.session!.id);

  const reopened = await service.reopen(view.id);
  expect(added).toEqual([]);
  expect(service.launchSpec(reopened.session!.id).cwd).toBe(view.worktreePath);
});

it('two reopens at once while the worktree is added back start one session', async () => {
  const { added, addWorktree } = recordingAdds();
  const { service } = setup({ addWorktree, branchExists: async () => true });
  const view = await service.start(OPENCODE_TASK);
  added.length = 0;
  service.onSessionExit(view.session!.id);

  await Promise.all([service.reopen(view.id), service.reopen(view.id)]);
  expect(added).toHaveLength(1);
  expect(service.sessionIds()).toHaveLength(1);
});

it('reports name the agent', async () => {
  const { service } = setup();
  await service.start(OPENCODE_TASK);
  expect(service.reports()[0].agent).toBe('opencode');
});

it('old records load as Claude tasks', async () => {
  const { projectDir, stateFile, make } = setup();
  const old: TaskRecord = {
    id: 'old',
    projectDir,
    title: 'Fix login',
    description: '',
    slug: 'fix-login',
    name: 'acme-fix-login',
    claudeSessionId: '0b7e8a52-2f4c-4f7e-9a51-6d2c3c1b9e10',
    worktreePath: join(projectDir, '.claude', 'worktrees', 'fix-login'),
    branch: 'worktree-fix-login',
    createdAt: 5,
    closedAt: 6,
    open: false,
  };
  writeFileSync(stateFile, JSON.stringify({ version: 1, tasks: [old] }));
  const service = make();
  expect(service.list()[0].agent).toBe('claude');
  expect(service.reports()[0].agent).toBe('claude');
});

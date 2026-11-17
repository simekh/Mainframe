import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FolderLeftError, gitQueries, type GitQueries } from '../git';
import { makeRepo } from '../testing/makeRepo';
import type { AgentName, ChangedFile, FileDiff, ProgramState, ProgramStatus, TaskCardRef, TaskGitState, TaskView } from '../../shared/types';
import { NODE } from '../testing/lookups';
import { hookSettings, reopenArgv, SESSION_START_FILE, startArgv } from '../agents/claude';
import { isOpencodeSessionId, OPENCODE_ENV } from '../agents/opencode';
import { ADAPTERS } from '../agents/adapters';
import { continuePrompt, putBackPrompt } from './carryOn';
import { openingPrompt } from './openingPrompt';
import { TaskRecords, type TaskRecord } from './taskStore';
import { TaskService } from './taskService';

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * The agents Mainframe found at start, as every open project shares them; change its fields to change what the next
 * start sees. Every agent is found and ticked, and Claude Code is the default.
 */
function fakeAgents() {
  return {
    bins: { claude: 'claude', opencode: '/bin/opencode', codex: '/bin/codex' } as Record<AgentName, string | null>,
    on: ['claude', 'opencode', 'codex'] as AgentName[],
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
    taskDiff: async () => [],
    addWorktree: async () => {},
    fetchBase: async () => {},
    taskGitState: async () => ({ branch: 'unmerged', tip: 'tip', uncommitted: [], elsewhere: false, unsaved: [] }),
    removeWorktree: async () => {},
    deleteBranch: async () => {},
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

/** The folders an opening prompt is handed; Claude Code's worktree note names neither, so any will do. */
const CLAUDE_FOLDERS = { projectDir: '/p', worktreePath: '/p/.claude/worktrees/fix-login' };

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
      prompt: openingPrompt({ agent: 'claude', ...CLAUDE_FOLDERS, title: 'Fix login', description: 'Users get logged out', branch: 'worktree-fix-login', noQuestions: false }),
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
  expect(prompt).toBe(openingPrompt({ agent: 'claude', ...CLAUDE_FOLDERS, title: 'Fix login', description: '', branch: 'worktree-fix-login', noQuestions: true }));
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
      ...CLAUDE_FOLDERS,
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
    openingPrompt({ agent: 'claude', ...CLAUDE_FOLDERS, title: 'Fix login', description: 'Users get logged out', branch: 'worktree-fix-login', noQuestions: false, card: CARD }),
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

it('a view carries place, endedAt, merged and problem: null, null, false and null for a new task', async () => {
  const { service } = setup();
  const view = await service.start(NEW_TASK);
  expect(view).toMatchObject({ place: null, endedAt: null, merged: false, problem: null });
  expect(service.reports()[0]).toMatchObject({ place: null, endedAt: null });
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
      prompt: RESUME_PROMPT,
    }),
  });
  expect(second.launchSpec(restored.session!.id).argv.at(-1)).toBe(RESUME_PROMPT);
});

// OpenCode's reopen asks git about the branch when the worktree folder is missing, as here: the fake adds none.
it('a project that closes while restore waits on git starts no session, and leaves the task as it was recorded', async () => {
  let answer!: (exists: boolean) => void;
  const { service, make, readState } = setup({ branchExists: () => new Promise((resolve) => (answer = resolve)) });
  const view = await service.start(OPENCODE_TASK);
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
    'claude', '--worktree', 'fix-login', '--resume', t.readState()[0].claudeSessionId, '--settings', join(t.taskDir(view.id), 'settings.json'),
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
    // OpenCode's reopen asks git about the branch of a missing worktree folder.
    { ...record('broken', 'ses_0123456789abcdef0123456789ab'), agent: 'opencode' as const, began: true },
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

it('reopen resumes in the task\'s worktree from the main checkout, without asking git, though its branch is gone', async () => {
  const asked: unknown[] = [];
  const { service, projectDir, readState, taskDir, sessionStarted } = setup({ branchExists: async (...args) => (asked.push(args), false) });
  const view = await service.start(NEW_TASK);
  const { claudeSessionId } = readState()[0];
  sessionStarted(view.id, claudeSessionId);
  service.onSessionExit(view.session!.id);

  const reopened = await service.reopen(view.id);
  expect(service.launchSpec(reopened.session!.id)).toEqual({
    cwd: projectDir,
    argv: ['claude', '--worktree', 'fix-login', '--resume', claudeSessionId, '--settings', join(taskDir(view.id), 'settings.json')],
  });
  expect(asked).toEqual([]);
});

it("a reopen whose git can't run fails, and starts no session and leaves the task as recorded", async () => {
  const noGit = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
  const { service, readState, changes } = setup({ branchExists: async () => { throw noGit; } });
  const view = await service.start(OPENCODE_TASK);
  service.noteStatus(view.session!.id, 'working');
  service.onSessionExit(view.session!.id);
  const [recorded, listed, before] = [readState(), service.list(), changes.length];

  await expect(service.reopen(view.id)).rejects.toBe(noGit);
  expect(service.sessionIds()).toEqual([]);
  expect(readState()).toEqual(recorded);
  expect(service.list()).toEqual(listed);
  expect(changes.length).toBe(before);
  // Nothing is left marked as launching: the next reopen runs.
  await expect(service.reopen(view.id)).rejects.toBe(noGit);
});

it('an OpenCode reopen asks git about the main checkout and the real branch', async () => {
  const asked: unknown[][] = [];
  const { service, projectDir } = setup({ branchExists: async (...args) => (asked.push(args), true) });
  const view = await service.start(OPENCODE_TASK);
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
      prompt: openingPrompt({ agent: 'claude', ...CLAUDE_FOLDERS, title: 'Fix login', description: 'Users get logged out', branch: 'worktree-fix-login', noQuestions: true }),
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
    openingPrompt({ agent: 'claude', ...CLAUDE_FOLDERS, title: 'Fix login', description: 'Users get logged out', branch: 'worktree-fix-login', noQuestions: false, card: CARD }),
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
    openingPrompt({ agent: 'claude', ...CLAUDE_FOLDERS, title: 'Fix login', description: '', branch: 'worktree-fix-login', noQuestions: false }),
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

it("diff asks git for the task's worktree and the clicked file", async () => {
  const files: FileDiff[] = [{ path: 'src/a.ts', status: 'M', added: 1, removed: 1, hunks: [], note: 'binary' }];
  const asked: [string, string][] = [];
  const { service } = setup({ taskDiff: async (dir, focus) => (asked.push([dir, focus]), files) });
  const view = await service.start(NEW_TASK);

  expect(await service.diff(view.id, 'src/a.ts')).toEqual({ taskTitle: view.title, result: { kind: 'files', files } });
  expect(asked).toEqual([[view.worktreePath, 'src/a.ts']]);
});

it('diff says the worktree is gone when git finds none', async () => {
  const { service } = setup({ taskDiff: async () => null });
  const view = await service.start(NEW_TASK);
  expect((await service.diff(view.id, 'a')).result).toEqual({ kind: 'noWorktree' });
});

it("diff passes on git's failure as its message", async () => {
  const { service } = setup({ taskDiff: async () => Promise.reject(new Error('boom')) });
  const view = await service.start(NEW_TASK);
  expect((await service.diff(view.id, 'a')).result).toEqual({ kind: 'failed', message: 'boom' });
});

it('diff rejects an unknown task', async () => {
  const { service } = setup();
  await expect(service.diff('nope', 'a')).rejects.toThrow(/Unknown task/);
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
      place: null,
      endedAt: null,
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
      place: null,
      endedAt: null,
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
  const worktreePath = join(projectDir, '.mainframe', 'worktrees', 'fix-login');

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

it("an OpenCode task's worktrees folder gets a .gitignore of *", async () => {
  const { service, projectDir } = setup();
  await service.start(OPENCODE_TASK);
  expect(readFileSync(join(projectDir, '.mainframe', 'worktrees', '.gitignore'), 'utf8')).toBe('*\n');
});

it('a .gitignore already in the worktrees folder is left as it is', async () => {
  const { service, projectDir } = setup();
  mkdirSync(join(projectDir, '.mainframe', 'worktrees'), { recursive: true });
  writeFileSync(join(projectDir, '.mainframe', 'worktrees', '.gitignore'), 'mine\n');
  await service.start(OPENCODE_TASK);
  expect(readFileSync(join(projectDir, '.mainframe', 'worktrees', '.gitignore'), 'utf8')).toBe('mine\n');
});

it("re-adding an older task's worktree hides the folder it is recorded in", async () => {
  const { service, projectDir, make, readState, stateFile } = setup({ branchExists: async () => true });
  const view = await service.start(OPENCODE_TASK);
  const older = join(projectDir, '.claude', 'worktrees', 'fix-login');
  const records = new TaskRecords(stateFile, 1000, () => {});
  records.all.find((t) => t.id === view.id)!.worktreePath = older;
  const again = make(records);
  again.onSessionExit?.(view.session!.id);
  await again.reopen(view.id);
  expect(readFileSync(join(projectDir, '.claude', 'worktrees', '.gitignore'), 'utf8')).toBe('*\n');
  expect(readState()).toHaveLength(1);
});

it('a worktrees folder that cannot be hidden logs a warning and the start still succeeds', async () => {
  const { service, projectDir, warnings } = setup();
  writeFileSync(join(projectDir, '.mainframe'), 'a file, not a folder');
  const view = await service.start(OPENCODE_TASK);
  expect(view.session).toBeTruthy();
  expect(warnings.some((w) => w.includes('Could not hide'))).toBe(true);
});

it("a Claude task doesn't make a .mainframe folder", async () => {
  const { service, projectDir } = setup();
  await service.start(NEW_TASK);
  expect(existsSync(join(projectDir, '.mainframe'))).toBe(false);
});

it('a slug whose folder exists under .mainframe/worktrees counts as taken', async () => {
  const { service, projectDir } = setup();
  mkdirSync(join(projectDir, '.mainframe', 'worktrees', 'fix-login'), { recursive: true });
  expect((await service.start(NEW_TASK)).slug).toBe('fix-login-2');
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
    worktreePath: join(projectDir, '.mainframe', 'worktrees', slug),
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

const CODEX_TASK = { ...NEW_TASK, agent: 'codex' as const };

/** The opening prompt of a Codex task started from CODEX_TASK in `projectDir`. */
const codexOpening = (projectDir: string) =>
  openingPrompt({
    agent: 'codex',
    projectDir,
    worktreePath: join(projectDir, '.mainframe', 'worktrees', 'fix-login'),
    title: 'Fix login',
    description: 'Users get logged out',
    branch: 'worktree-fix-login',
    noQuestions: false,
  });

it('a Codex task starts `codex <opening prompt>` in its own worktree under .mainframe/worktrees', async () => {
  const { added, addWorktree } = recordingAdds();
  const { service, projectDir, readState } = setup({ addWorktree });
  const view = await service.start(CODEX_TASK);
  const worktreePath = join(projectDir, '.mainframe', 'worktrees', 'fix-login');

  expect(added).toEqual([[projectDir, worktreePath, 'worktree-fix-login', { create: true }]]);
  expect(readState()[0].agent).toBe('codex');
  expect(service.launchSpec(view.session!.id)).toEqual({ argv: ['/bin/codex', codexOpening(projectDir)], cwd: worktreePath });
  expect(view.session).toMatchObject({ startedWithPrompt: true });
});

it('a Codex task that never reported a turn starts again with its opening prompt on reopen', async () => {
  const { service, projectDir, readState } = setup();
  const view = await service.start(CODEX_TASK);
  // Codex was quit at its trust question or its sign-in screen: it never reported a turn.
  service.noteStatus(view.session!.id, 'idle');
  service.onSessionExit(view.session!.id);
  expect(readState()[0]).not.toHaveProperty('began');

  const reopened = await service.reopen(view.id);
  expect(service.launchSpec(reopened.session!.id)).toEqual({
    argv: ['/bin/codex', codexOpening(projectDir)],
    cwd: join(projectDir, '.mainframe', 'worktrees', 'fix-login'),
  });
  expect(reopened.session).toMatchObject({ startedWithPrompt: true });
});

it('a Codex task that reported working reopens with `codex resume --last`', async () => {
  const { service, make, projectDir, readState } = setup();
  const view = await service.start(CODEX_TASK);
  service.noteStatus(view.session!.id, 'working');
  expect(readState()[0].began).toBe(true);
  service.noteStatus(view.session!.id, 'done');
  service.onSessionExit(view.session!.id);

  const resumed = await service.reopen(view.id);
  expect(service.launchSpec(resumed.session!.id)).toEqual({
    argv: ['/bin/codex', 'resume', '--last'],
    cwd: join(projectDir, '.mainframe', 'worktrees', 'fix-login'),
  });
  expect(resumed.session).toMatchObject({ startedWithPrompt: false });

  // Quit mid-turn: the carry-on reopen resumes with the carry-on prompt.
  service.noteStatus(resumed.session!.id, 'working');
  service.beginQuit();
  service.onSessionExit(resumed.session!.id);
  const next = make();
  await next.restore();
  const [carriedOn] = next.list();
  expect(next.launchSpec(carriedOn.session!.id).argv).toEqual(['/bin/codex', 'resume', '--last', RESUME_PROMPT]);
  expect(carriedOn.session).toMatchObject({ startedWithPrompt: true });
});

it('an OpenCode start that meets a quit records the task, which begins with its brief at the next start', async () => {
  let added: (() => void) | undefined;
  // Only the start's add waits; the restore adds the worktree back at once.
  const addWorktree = () => (added ? Promise.resolve() : new Promise<void>((resolve) => (added = resolve)));
  const { service, make, projectDir, readState } = setup({ addWorktree });
  const starting = service.start(OPENCODE_TASK);
  await new Promise((resolve) => setImmediate(resolve));
  service.beginQuit();
  added!();

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
  const { added, addWorktree } = recordingAdds();
  const { service, projectDir } = setup({ addWorktree, branchExists: async () => true });
  const view = await service.start(OPENCODE_TASK);
  added.length = 0;
  service.onSessionExit(view.session!.id);

  // The worktree folder was deleted by hand; its branch is still there.
  const readded = await service.reopen(view.id);
  expect(added).toEqual([[projectDir, view.worktreePath, view.branch, { create: false }]]);
  expect(service.launchSpec(readded.session!.id).cwd).toBe(view.worktreePath);
});

it('Reopen of an OpenCode task whose folder and branch are gone adds a fresh worktree', async () => {
  const { added, addWorktree } = recordingAdds();
  const { service, projectDir } = setup({ addWorktree, branchExists: async () => false });
  const view = await service.start(OPENCODE_TASK);
  added.length = 0;
  service.onSessionExit(view.session!.id);

  const reopened = await service.reopen(view.id);
  expect(added).toEqual([[projectDir, view.worktreePath, view.branch, { create: true }]]);
  expect(service.launchSpec(reopened.session!.id).cwd).toBe(view.worktreePath);
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

/** A promise and the function that settles it, for holding a fake git call until the test lets it go. */
function held<T = void>(): { promise: Promise<T>; release: (value: T) => void } {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (release = resolve));
  return { promise, release };
}

/**
 * A service whose git reports, per branch, the state the test sets in `states` (unmerged with nothing uncommitted
 * until then), and records each taskGitState branch and each removal in order.
 */
function roundSetup(gitOverrides: Partial<GitQueries> = {}) {
  const states = new Map<string, Partial<TaskGitState>>();
  const checked: string[] = [];
  const removals: unknown[][] = [];
  /** Runs before each taskGitState answers, with the branch and how many calls came before: a test can hold it, or throw. */
  const hooks: { before: (branch: string, calls: number) => Promise<void> | void } = { before: () => {} };
  const t = setup({
    taskGitState: async (_dir, branch) => {
      const calls = checked.push(branch);
      await hooks.before(branch, calls);
      const state = { branch: 'unmerged' as const, uncommitted: [], elsewhere: false, unsaved: [], ...states.get(branch) };
      return { tip: state.branch === 'gone' ? null : `tip-of-${branch}`, ...state };
    },
    removeWorktree: async (dir, path, o) => {
      removals.push(['removeWorktree', dir, path, o]);
    },
    deleteBranch: async (dir, branch, tip) => {
      removals.push(tip === undefined ? ['deleteBranch', dir, branch] : ['deleteBranch', dir, branch, tip]);
    },
    ...gitOverrides,
  });
  return { ...t, states, checked, removals, hooks };
}

/** Starts a task on `service`, lets its conversation begin unless told not to, closes it and waits for its exit's round. */
async function pausedTask(
  t: ReturnType<typeof roundSetup>,
  o: { title?: string; begin?: boolean; service?: TaskService } = {},
): Promise<TaskView> {
  const service = o.service ?? t.service;
  const view = await service.start({ ...NEW_TASK, title: o.title ?? NEW_TASK.title });
  if (o.begin !== false) t.sessionStarted(view.id, t.readState().find((r) => r.id === view.id)!.claudeSessionId);
  service.close(view.id);
  service.onSessionExit(view.session!.id);
  await service.checkRound();
  return view;
}

const MERGED: Partial<TaskGitState> = { branch: 'merged', unsaved: ['squashed away'] };

it('a round moves a closed task with a merged branch and nothing uncommitted to Finished, removing its worktree and branch', async () => {
  const t = roundSetup();
  const view = await pausedTask(t);
  t.states.set(view.branch, MERGED);

  await t.service.checkRound();

  expect(t.service.list()[0]).toMatchObject({ place: 'finished', endedAt: 1000 });
  // Only while the branch still points at the commit the check judged.
  expect(t.removals).toEqual([
    ['removeWorktree', t.projectDir, view.worktreePath, { force: false }],
    ['deleteBranch', t.projectDir, view.branch, `tip-of-${view.branch}`],
  ]);
  expect(t.readState()[0]).toMatchObject({ place: 'finished', endedAt: 1000, open: false });
  expect(t.changes.at(-1)).toEqual(t.service.list());
});

it("a round leaves a task whose folder is gone and whose merged branch is checked out in the main checkout: git's guard keeps the branch, and the task stays", async () => {
  const repo = makeRepo();
  cleanup.push(dirname(repo.origin));
  execFileSync('git', ['-C', repo.main, 'checkout', '-q', '-b', 'worktree-fix-login'], { stdio: 'pipe' });
  const tip = execFileSync('git', ['-C', repo.main, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const t = roundSetup({
    taskGitState: async () => ({ branch: 'merged', tip, uncommitted: [], elsewhere: false, unsaved: [] }),
    deleteBranch: gitQueries.deleteBranch,
  });
  const service = t.make(undefined, repo.main);

  const view = await pausedTask(t, { service });

  expect(service.list()[0]).toMatchObject({ id: view.id, place: null });
  expect(await gitQueries.branchExists(repo.main, 'worktree-fix-login')).toBe(true);
  expect(execFileSync('git', ['-C', repo.main, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(tip);
  expect(t.warnings.some((w) => w.includes('worktree-fix-login'))).toBe(true);
});

it('a round moves a closed task whose branch and worktree are gone to Finished', async () => {
  const t = roundSetup();
  const view = await pausedTask(t);
  t.states.set(view.branch, { branch: 'gone' });

  await t.service.checkRound();

  expect(t.readState()[0]).toMatchObject({ place: 'finished', endedAt: 1000 });
});

it('a round moves a closed OpenCode task whose conversation began to Finished, and leaves one that never began', async () => {
  const t = roundSetup();
  const began = await t.service.start({ ...OPENCODE_TASK, title: 'Began' });
  const never = await t.service.start({ ...OPENCODE_TASK, title: 'Never' });
  t.service.noteStatus(began.session!.id, 'working');
  for (const view of [began, never]) {
    t.service.close(view.id);
    t.service.onSessionExit(view.session!.id);
    t.states.set(view.branch, { branch: 'gone' });
  }

  await t.service.checkRound();

  expect(t.service.list().map((v) => [v.title, v.place])).toEqual([['Began', 'finished'], ['Never', null]]);
});

it('a round leaves a task whose conversation never began, though its branch is gone', async () => {
  const t = roundSetup();
  const view = await pausedTask(t, { begin: false });
  t.states.set(view.branch, { branch: 'gone' });

  await t.service.checkRound();

  expect(t.service.list()[0].place).toBeNull();
  expect(t.removals).toEqual([]);
});

it('a round leaves a task whose branch has no commits of its own', async () => {
  const t = roundSetup();
  const view = await pausedTask(t);
  t.states.set(view.branch, { branch: 'no-commits' });

  await t.service.checkRound();

  expect(t.service.list()[0].place).toBeNull();
  expect(t.removals).toEqual([]);
});

it('a round leaves a merged task with uncommitted files, and removes nothing', async () => {
  const t = roundSetup();
  const view = await pausedTask(t);
  t.states.set(view.branch, { ...MERGED, uncommitted: ['notes.txt'] });

  await t.service.checkRound();

  expect(t.service.list()[0].place).toBeNull();
  expect(t.readState()[0]).not.toHaveProperty('place');
  expect(t.removals).toEqual([]);
});

it('a worktree on another branch keeps its task Paused', async () => {
  const t = roundSetup();
  const view = await pausedTask(t);
  t.states.set(view.branch, { branch: 'gone', elsewhere: true });

  await t.service.checkRound();

  expect(t.service.list()[0].place).toBeNull();
  expect(t.removals).toEqual([]);
});

it('a round marks a running merged task merged, without closing or removing anything, and clears the mark when it no longer passes', async () => {
  const t = roundSetup();
  const view = await t.service.start(NEW_TASK);
  t.sessionStarted(view.id, t.readState()[0].claudeSessionId);
  t.states.set(view.branch, MERGED);
  const before = t.changes.length;

  await t.service.checkRound();
  expect(t.service.list()[0]).toMatchObject({ merged: true, place: null, session: { id: view.session!.id } });
  expect(t.changes.length).toBe(before + 1);
  expect(t.changes.at(-1)![0].merged).toBe(true);
  expect(t.removals).toEqual([]);
  expect(t.readState()[0]).toMatchObject({ open: true });

  // Nothing changed: nothing is sent.
  await t.service.checkRound();
  expect(t.changes.length).toBe(before + 1);

  t.states.set(view.branch, { ...MERGED, uncommitted: ['a.txt'] });
  await t.service.checkRound();
  expect(t.service.list()[0].merged).toBe(false);
  expect(t.changes.at(-1)![0].merged).toBe(false);
});

it('a closed merged task is finished by the round its exit starts', async () => {
  const t = roundSetup();
  const view = await t.service.start(NEW_TASK);
  t.sessionStarted(view.id, t.readState()[0].claudeSessionId);
  t.states.set(view.branch, MERGED);
  await t.service.checkRound();
  expect(t.service.list()[0].merged).toBe(true);

  t.service.close(view.id);
  t.service.onSessionExit(view.session!.id);
  await t.service.checkRound();

  expect(t.service.list()[0]).toMatchObject({ place: 'finished', merged: false, session: null });
  expect(t.removals.map((r) => r[0])).toEqual(['removeWorktree', 'deleteBranch']);
});

it('a task that closes and no longer passes loses its merged mark', async () => {
  const t = roundSetup();
  const view = await t.service.start(NEW_TASK);
  t.sessionStarted(view.id, t.readState()[0].claudeSessionId);
  t.states.set(view.branch, MERGED);
  await t.service.checkRound();
  t.states.set(view.branch, { ...MERGED, uncommitted: ['a.txt'] });

  t.service.close(view.id);
  t.service.onSessionExit(view.session!.id);
  expect(t.changes.at(-1)![0]).toMatchObject({ merged: false, session: null });
  await t.service.checkRound();
  expect(t.service.list()[0]).toMatchObject({ merged: false, place: null });
});

it('a task reopened while the round checks it is not removed', async () => {
  const t = roundSetup();
  const view = await pausedTask(t);
  const gate = held();
  t.states.set(view.branch, MERGED);
  t.checked.length = 0;
  // The second check, just before the removal, waits.
  t.hooks.before = (_branch, calls) => (calls === 2 ? gate.promise : undefined);

  const round = t.service.checkRound();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(t.checked.length).toBe(2);
  await t.service.reopen(view.id);
  gate.release();
  await round;

  expect(t.removals).toEqual([]);
  expect(t.service.list()[0]).toMatchObject({ place: null, session: { startedWithPrompt: false } });
});

it('a task reopened while the round removes it gets no session', async () => {
  const gate = held();
  const t = roundSetup({ removeWorktree: () => gate.promise });
  const view = await pausedTask(t);
  t.states.set(view.branch, MERGED);

  const round = t.service.checkRound();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await t.service.reopen(view.id);
  gate.release();
  await round;

  expect(t.service.list()[0]).toMatchObject({ place: 'finished', session: null });
  expect(t.service.sessionIds()).toEqual([]);
});

it('a round leaves an open task that has no session yet, as restore or a quit leaves it', async () => {
  const t = roundSetup();
  const view = await t.service.start(NEW_TASK);
  t.sessionStarted(view.id, t.readState()[0].claudeSessionId);
  t.service.beginQuit();
  t.service.onSessionExit(view.session!.id);
  const next = t.make();
  t.states.set(view.branch, MERGED);

  await next.checkRound();

  expect(next.list()[0]).toMatchObject({ place: null, session: null });
  expect(t.removals).toEqual([]);
});

it('no round removes anything after beginQuit', async () => {
  const gate = held();
  const t = roundSetup();
  const view = await pausedTask(t);
  t.states.set(view.branch, MERGED);
  t.checked.length = 0;
  t.hooks.before = (_branch, calls) => (calls === 2 ? gate.promise : undefined);

  const round = t.service.checkRound();
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.service.beginQuit();
  gate.release();
  await round;
  await t.service.checkRound();

  expect(t.removals).toEqual([]);
  expect(t.service.list()[0].place).toBeNull();
});

it('no branch is deleted when the quit begins while the worktree is removed', async () => {
  const gate = held();
  const t = roundSetup({ removeWorktree: () => gate.promise });
  const view = await pausedTask(t);
  t.states.set(view.branch, MERGED);

  const round = t.service.checkRound();
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.service.beginQuit();
  gate.release();
  await round;

  expect(t.removals).toEqual([]);
  expect(t.service.list()[0].place).toBeNull();
});

it("a round touches only its own project's tasks", async () => {
  const t = roundSetup();
  const records = new TaskRecords(t.stateFile, 1000, () => {});
  const otherDir = join(t.root, 'Other');
  mkdirSync(otherDir);
  const mine = t.make(records);
  const other = t.make(records, otherDir);
  const a = await pausedTask(t, { service: mine, title: 'Mine' });
  const b = await pausedTask(t, { service: other, title: 'Theirs' });
  t.states.set(a.branch, MERGED);
  t.states.set(b.branch, MERGED);
  t.checked.length = 0;

  await mine.checkRound();

  expect(t.checked.every((branch) => branch === a.branch)).toBe(true);
  expect(mine.list()[0].place).toBe('finished');
  expect(other.list()[0].place).toBeNull();
  expect(t.removals.every((r) => r[1] === t.projectDir)).toBe(true);
});

it('an exit during a round is checked by a round after it', async () => {
  const gate = held();
  const t = roundSetup();
  // Second comes first in the round, which passes it over while it still runs, then holds on First.
  const second = await t.service.start({ ...NEW_TASK, title: 'Second' });
  t.sessionStarted(second.id, t.readState().find((r) => r.id === second.id)!.claudeSessionId);
  const first = await pausedTask(t, { title: 'First' });
  let holding = true;
  t.hooks.before = (branch) => (holding && branch === first.branch ? gate.promise : undefined);
  t.checked.length = 0;

  const round = t.service.checkRound();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(t.checked).toEqual([second.branch, first.branch]);
  t.states.set(second.branch, MERGED);
  t.service.close(second.id);
  t.service.onSessionExit(second.session!.id);
  // The exit queued one round; more calls meanwhile join it.
  const queued = t.service.checkRound();
  expect(t.service.checkRound()).toBe(queued);
  holding = false;
  gate.release();

  await round;
  expect(t.service.list().find((v) => v.id === second.id)!.place).toBeNull();
  await queued;
  expect(t.service.list().find((v) => v.id === second.id)!.place).toBe('finished');
  expect(t.checked.filter((branch) => branch === second.branch)).toHaveLength(3);
});

/** A closed OpenCode task whose conversation began, on `service`, once its exit's round is over; the fake git adds no folder. */
async function pausedOpencodeTask(service: TaskService): Promise<TaskView> {
  const view = await service.start(OPENCODE_TASK);
  service.noteStatus(view.session!.id, 'working');
  service.close(view.id);
  service.onSessionExit(view.session!.id);
  await service.checkRound();
  return view;
}

it('a round leaves a task whose reopen waits on git, and the reopen then starts its session', async () => {
  const answered = held<boolean>();
  const { added, addWorktree } = recordingAdds();
  const t = roundSetup({ branchExists: () => answered.promise, addWorktree });
  const view = await pausedOpencodeTask(t.service);
  added.length = 0;
  t.states.set(view.branch, { branch: 'gone' });

  const reopened = t.service.reopen(view.id);
  await t.service.checkRound();
  expect(t.removals).toEqual([]);
  expect(t.service.list()[0].place).toBeNull();
  answered.release(false);
  await reopened;

  expect(added).toEqual([[t.projectDir, view.worktreePath, view.branch, { create: true }]]);
  expect(t.service.list()[0]).toMatchObject({ place: null, session: { id: expect.any(String) } });
});

it('a reopen whose git answers after the task has moved starts no session and adds no worktree', async () => {
  const answered = held<boolean>();
  const { added, addWorktree } = recordingAdds();
  const t = roundSetup({ branchExists: () => answered.promise, addWorktree });
  const records = new TaskRecords(t.stateFile, 1000, () => {});
  const service = t.make(records);
  const view = await pausedOpencodeTask(service);
  added.length = 0;

  const reopened = service.reopen(view.id);
  // As Discard will.
  records.all[0].place = 'discarded';
  answered.release(true);
  await reopened;

  expect(added).toEqual([]);
  expect(service.sessionIds()).toEqual([]);
  expect(service.list()[0]).toMatchObject({ place: 'discarded', session: null });
});

it('a reopen of a finished task starts nothing: Continue brings it back', async () => {
  const t = roundSetup();
  const view = await pausedTask(t);
  t.states.set(view.branch, MERGED);
  await t.service.checkRound();

  const reopened = await t.service.reopen(view.id);
  expect(reopened).toMatchObject({ place: 'finished', session: null });
  expect(t.service.sessionIds()).toEqual([]);
});

it('a round does not move a task that was moved while it removed it', async () => {
  const gate = held();
  const t = roundSetup({ removeWorktree: () => gate.promise });
  const records = new TaskRecords(t.stateFile, 1000, () => {});
  const service = t.make(records);
  const view = await pausedTask(t, { service });
  t.states.set(view.branch, MERGED);

  const round = service.checkRound();
  await new Promise((resolve) => setTimeout(resolve, 0));
  // As Discard will.
  records.all[0].place = 'discarded';
  gate.release();
  await round;

  expect(records.all[0].place).toBe('discarded');
});

it('a removal git refuses leaves the task where it was and warns', async () => {
  const t = roundSetup({
    removeWorktree: async () => {
      throw new Error('fatal: worktree is locked');
    },
  });
  const view = await pausedTask(t);
  t.states.set(view.branch, MERGED);

  await t.service.checkRound();

  expect(t.service.list()[0]).toMatchObject({ place: null, problem: 'Could not remove the worktree: fatal: worktree is locked' });
  expect(t.changes.at(-1)).toEqual(t.service.list());
  expect(t.readState()[0]).not.toHaveProperty('place');
  expect(t.warnings.some((w) => w.includes('worktree is locked'))).toBe(true);
});

it('a removal git leaves half done says on the card to delete the folder, and once it is gone the round finishes the task', async () => {
  let left = true;
  const t = roundSetup({
    removeWorktree: async () => {
      if (left) throw new FolderLeftError("error: failed to delete 'build': Permission denied");
    },
  });
  const view = await pausedTask(t);
  t.states.set(view.branch, MERGED);

  await t.service.checkRound();
  expect(t.service.list()[0]).toMatchObject({
    place: null,
    problem: `Delete the folder git left behind, then Discard: ${view.worktreePath} (error: failed to delete 'build': Permission denied)`,
  });
  expect(t.removals).toEqual([]);

  // The owner deleted it by hand.
  left = false;
  await t.service.checkRound();
  expect(t.service.list()[0]).toMatchObject({ place: 'finished', problem: null });
});

it('a later removal of the folder git left behind keeps the card telling the owner to delete it', async () => {
  let failure: Error = new FolderLeftError('Permission denied');
  const t = roundSetup({
    removeWorktree: async () => {
      throw failure;
    },
  });
  const view = await pausedTask(t);
  t.states.set(view.branch, MERGED);
  const advice = `Delete the folder git left behind, then Discard: ${view.worktreePath} (Permission denied)`;
  await t.service.checkRound();
  expect(t.service.list()[0].problem).toBe(advice);

  // What is left is no longer a worktree, so git's next try only says so.
  failure = new Error(`fatal: '${view.worktreePath}' is not a working tree`);
  await t.service.checkRound();
  expect(t.service.list()[0]).toMatchObject({ place: null, problem: advice });
});

it('a round deletes the branch only at the tip its second check judged, and none for a branch that check found gone', async () => {
  const t = roundSetup();
  const view = await pausedTask(t);
  t.states.set(view.branch, MERGED);
  t.checked.length = 0;
  t.hooks.before = (_branch, calls) => {
    if (calls === 2) t.states.set(view.branch, { ...MERGED, tip: 'second' });
  };

  await t.service.checkRound();
  expect(t.removals.at(-1)).toEqual(['deleteBranch', t.projectDir, view.branch, 'second']);

  const gone = await pausedTask(t, { title: 'Gone' });
  t.states.set(gone.branch, { branch: 'gone' });
  t.removals.length = 0;
  await t.service.checkRound();
  expect(t.service.list().find((v) => v.id === gone.id)!.place).toBe('finished');
  expect(t.removals).toEqual([['removeWorktree', t.projectDir, gone.worktreePath, { force: false }]]);
});

it("a task git can't read is left alone, with a warning, and the round goes on to the others", async () => {
  const t = roundSetup();
  const bad = await pausedTask(t, { title: 'Bad' });
  const good = await pausedTask(t, { title: 'Good' });
  t.states.set(good.branch, MERGED);
  t.hooks.before = (branch) => {
    if (branch === bad.branch) throw new Error('not a git repository');
  };

  await expect(t.service.checkRound()).resolves.toBeUndefined();

  expect(t.service.list().map((v) => [v.title, v.place])).toEqual([['Bad', null], ['Good', 'finished']]);
  expect(t.warnings.some((w) => w.includes('not a git repository'))).toBe(true);
});

it('restore runs a round once its tasks are reopened', async () => {
  const t = roundSetup();
  const view = await pausedTask(t);
  t.states.set(view.branch, MERGED);
  const next = t.make();

  await next.restore();

  expect(next.list()[0].place).toBe('finished');
});

const CONTINUE_PROMPT =
  'Mainframe has continued this task in a fresh worktree on branch worktree-fix-login, made from the default branch, which has any of your earlier work that was merged. Wait for my next message.';

it('Continue of a finished Claude task resumes its chat in its worktree with the continue prompt, and puts it on the board', async () => {
  const t = roundSetup();
  const view = await pausedTask(t);
  t.states.set(view.branch, MERGED);
  await t.service.checkRound();
  const { claudeSessionId } = t.readState()[0];

  const continued = await t.service.continueTask(view.id);
  expect(continuePrompt(view.branch)).toBe(CONTINUE_PROMPT);
  expect(continued).toMatchObject({ place: null, endedAt: null, closedAt: null, session: { startedWithPrompt: true } });
  expect(t.service.launchSpec(continued.session!.id)).toEqual({
    cwd: t.projectDir,
    argv: reopenArgv({
      claudeBin: 'claude',
      slug: 'fix-login',
      claudeSessionId,
      settingsPath: join(t.taskDir(view.id), 'settings.json'),
      prompt: CONTINUE_PROMPT,
    }),
  });
  expect(t.readState()[0]).toMatchObject({ open: true, claudeSessionId });
  expect(t.readState()[0]).not.toHaveProperty('place');
  expect(t.readState()[0]).not.toHaveProperty('endedAt');

  // The prompt is owed until the session works on it.
  t.service.close(view.id);
  expect(t.readState()[0].midTurn).toBe(true);
});

it('Continue of a finished task whose chat is gone starts a new conversation with the continuing opening prompt', async () => {
  const t = roundSetup();
  const view = await pausedTask(t, { begin: false });
  const first = t.readState()[0].claudeSessionId;
  // Claude Code deleted the chat: no project folder holds its file.
  const transcript_path = join(t.dataDir, 'projects', '-acme', `${first}.jsonl`);
  writeFileSync(join(t.taskDir(view.id), SESSION_START_FILE), JSON.stringify({ session_id: first, source: 'startup', transcript_path }));
  t.states.set(view.branch, MERGED);
  await t.service.checkRound();
  expect(t.service.list()[0].place).toBe('finished');

  const continued = await t.service.continueTask(view.id);
  const { claudeSessionId } = t.readState()[0];
  expect(claudeSessionId).not.toBe(first);
  expect(continued).toMatchObject({ place: null, session: { startedWithPrompt: true } });
  expect(t.service.launchSpec(continued.session!.id)).toEqual({
    cwd: t.projectDir,
    argv: startArgv({
      claudeBin: 'claude',
      slug: 'fix-login',
      name: 'acme-fix-login',
      claudeSessionId,
      settingsPath: join(t.taskDir(view.id), 'settings.json'),
      prompt: openingPrompt({
        agent: 'claude',
        ...CLAUDE_FOLDERS, title: 'Fix login', description: 'Users get logged out', branch: 'worktree-fix-login', noQuestions: false, continuing: true,
      }),
    }),
  });
});

it('Continue of a finished OpenCode task adds a fresh worktree from the base', async () => {
  const { added, addWorktree } = recordingAdds();
  const t = roundSetup({ addWorktree });
  const view = await pausedOpencodeTask(t.service);
  t.states.set(view.branch, { branch: 'gone' });
  await t.service.checkRound();
  expect(t.service.list()[0].place).toBe('finished');
  added.length = 0;

  const continued = await t.service.continueTask(view.id);
  expect(added).toEqual([[t.projectDir, view.worktreePath, view.branch, { create: true }]]);
  expect(t.service.launchSpec(continued.session!.id)).toEqual({
    cwd: view.worktreePath,
    argv: ['/bin/opencode', '--standalone', '-s', t.readState()[0].claudeSessionId, '--prompt', CONTINUE_PROMPT],
    env: OPENCODE_ENV,
  });
  expect(continued).toMatchObject({ place: null, endedAt: null, session: { startedWithPrompt: true } });
});

it('a Continue waiting on git keeps the task Finished, so no round touches it, and a second Continue starts nothing', async () => {
  const answered = held<boolean>();
  const t = roundSetup({ branchExists: () => answered.promise });
  const records = new TaskRecords(t.stateFile, 1000, () => {});
  const service = t.make(records);
  // Its exit's round runs at once: git's answer is held only from here on.
  const view = await pausedOpencodeTask(service);
  records.all[0].place = 'finished';
  t.checked.length = 0;

  const continuing = service.continueTask(view.id);
  await service.continueTask(view.id);
  await service.checkRound();
  expect(t.checked).toEqual([]);
  expect(service.list()[0].place).toBe('finished');
  answered.release(false);
  await continuing;

  expect(service.sessionIds()).toHaveLength(1);
  expect(service.list()[0]).toMatchObject({ place: null, session: { startedWithPrompt: true } });
});

it('Continue of a put-back task reopens it and puts it on the board', async () => {
  const t = setup();
  const records = new TaskRecords(t.stateFile, 1000, () => {});
  const service = t.make(records);
  const view = await service.start(NEW_TASK);
  t.sessionStarted(view.id, t.readState()[0].claudeSessionId);
  service.close(view.id);
  service.onSessionExit(view.session!.id);
  records.all[0].place = 'putBack';

  const continued = await service.continueTask(view.id);
  expect(continued).toMatchObject({ place: null, session: { startedWithPrompt: false } });
  expect(service.launchSpec(continued.session!.id).argv).toContain('--resume');
});

it('Continue refuses a task on the board', async () => {
  const { service } = setup();
  const view = await service.start(NEW_TASK);
  service.onSessionExit(view.session!.id);
  await expect(service.continueTask(view.id)).rejects.toThrow('Task Fix login is on the board; reopen it instead');
  expect(service.sessionIds()).toEqual([]);
});

it('a chat-gone Continue drops the old session record, so an exit before the new one fires keeps the new id', async () => {
  const t = roundSetup();
  const view = await pausedTask(t, { begin: false });
  const first = t.readState()[0].claudeSessionId;
  const transcript_path = join(t.dataDir, 'projects', '-acme', `${first}.jsonl`);
  writeFileSync(join(t.taskDir(view.id), SESSION_START_FILE), JSON.stringify({ session_id: first, source: 'startup', transcript_path }));
  t.states.set(view.branch, MERGED);
  await t.service.checkRound();

  const continued = await t.service.continueTask(view.id);
  const { claudeSessionId } = t.readState()[0];
  expect(existsSync(join(t.taskDir(view.id), SESSION_START_FILE))).toBe(false);
  // claude quit before its SessionStart fired.
  t.service.onSessionExit(continued.session!.id);
  expect(t.readState()[0].claudeSessionId).toBe(claudeSessionId);
  expect(claudeSessionId).not.toBe(first);
});

it('a Continue whose session ends before its worktree is made stays Paused on the board, saying so, until a session makes it', async () => {
  const t = roundSetup();
  const view = await pausedTask(t);
  t.states.set(view.branch, { branch: 'gone' });
  await t.service.checkRound();
  expect(t.service.list()[0].place).toBe('finished');

  // claude fails at once: no worktree, no branch, and the old conversation's record.
  const continued = await t.service.continueTask(view.id);
  t.service.onSessionExit(continued.session!.id);
  await t.service.checkRound();
  const unmade = { place: null, session: null, problem: 'The session ended before its worktree was made' };
  expect(t.service.list()[0]).toMatchObject(unmade);

  // A Reopen that fails the same way leaves it there too.
  const reopened = await t.service.reopen(view.id);
  expect(t.service.list()[0].problem).toBeNull();
  t.service.onSessionExit(reopened.session!.id);
  await t.service.checkRound();
  expect(t.service.list()[0]).toMatchObject(unmade);

  // A session that makes the worktree: the round judges the task again.
  const again = await t.service.reopen(view.id);
  mkdirSync(view.worktreePath, { recursive: true });
  t.service.onSessionExit(again.session!.id);
  await t.service.checkRound();
  expect(t.service.list()[0]).toMatchObject({ place: 'finished', problem: null });
});

it('a Continue whose session made its worktree, which was gone again by its end, is finished by the round as any task is', async () => {
  const t = roundSetup();
  const view = await pausedTask(t);
  t.states.set(view.branch, { branch: 'gone' });
  await t.service.checkRound();

  const continued = await t.service.continueTask(view.id);
  mkdirSync(view.worktreePath, { recursive: true });
  t.service.noteStatus(continued.session!.id, 'idle');
  // Merged, and its worktree and branch removed, as the repo's instructions may say.
  rmSync(view.worktreePath, { recursive: true });
  t.service.onSessionExit(continued.session!.id);
  await t.service.checkRound();

  expect(t.service.list()[0]).toMatchObject({ place: 'finished', problem: null });
});

it('a Continue cut short while git adds the worktree removes the worktree and the branch it made', async () => {
  let adding: Promise<void> | null = null;
  const t = roundSetup({ addWorktree: () => adding ?? Promise.resolve() });
  const records = new TaskRecords(t.stateFile, 1000, () => {});
  const service = t.make(records);
  const view = await pausedOpencodeTask(service);
  records.all[0].place = 'finished';
  const gate = held();
  adding = gate.promise;

  const continuing = service.continueTask(view.id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  // As Discard will.
  records.all[0].place = 'discarded';
  gate.release();
  await continuing;

  expect(service.sessionIds()).toEqual([]);
  expect(t.removals).toEqual([
    ['removeWorktree', t.projectDir, view.worktreePath, { force: false }],
    ['deleteBranch', t.projectDir, view.branch],
  ]);
});

it('a reopen cut short by a quit while git adds the worktree back removes it, and keeps the branch it did not make', async () => {
  let adding: Promise<void> | null = null;
  const t = roundSetup({ addWorktree: () => adding ?? Promise.resolve(), branchExists: async () => true });
  const view = await pausedOpencodeTask(t.service);
  const gate = held();
  adding = gate.promise;

  const reopening = t.service.reopen(view.id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.service.beginQuit();
  gate.release();
  await reopening;

  expect(t.service.sessionIds()).toEqual([]);
  expect(t.removals).toEqual([['removeWorktree', t.projectDir, view.worktreePath, { force: false }]]);
});

it('a failed removal after a cut-short reopen only warns', async () => {
  let adding: Promise<void> | null = null;
  const t = roundSetup({
    addWorktree: () => adding ?? Promise.resolve(),
    removeWorktree: async () => { throw new Error('fatal: busy'); },
  });
  const view = await pausedOpencodeTask(t.service);
  const gate = held();
  adding = gate.promise;

  const reopening = t.service.reopen(view.id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.service.beginQuit();
  gate.release();
  await expect(reopening).resolves.toMatchObject({ session: null });
  expect(t.warnings.some((w) => w.includes('fatal: busy'))).toBe(true);
});

describe('discard', () => {
  it('discardPreview lists the uncommitted files and the unsaved commits', async () => {
    const t = roundSetup();
    const view = await pausedTask(t);
    t.states.set(view.branch, { uncommitted: ['a.ts', 'b.ts'], unsaved: ['abc1234 wip'] });

    await expect(t.service.discardPreview(view.id)).resolves.toEqual({ uncommitted: ['a.ts', 'b.ts'], unsaved: ['abc1234 wip'] });
  });

  it('discard force-removes the worktree, deletes the branch and moves the task to Discarded', async () => {
    const t = roundSetup();
    const view = await pausedTask(t);
    t.removals.length = 0;

    await t.service.discard(view.id);

    expect(t.removals).toEqual([
      ['removeWorktree', t.projectDir, view.worktreePath, { force: true }],
      ['deleteBranch', t.projectDir, view.branch],
    ]);
    expect(t.service.list()[0]).toMatchObject({ place: 'discarded', endedAt: 1000 });
    expect(t.readState()[0]).toMatchObject({ place: 'discarded', endedAt: 1000 });
    expect(t.changes.at(-1)).toEqual(t.service.list());
  });

  it('a rejected removal throws git\'s message and leaves the task on the board', async () => {
    const t = roundSetup({ removeWorktree: async () => { throw new Error('fatal: locked'); } });
    const view = await pausedTask(t);

    await expect(t.service.discard(view.id)).rejects.toThrow('fatal: locked');
    expect(t.service.list()[0]).toMatchObject({ place: null, problem: 'Could not remove the worktree: fatal: locked' });
    // The task is free again: a second try is not blocked.
    await expect(t.service.discard(view.id)).rejects.toThrow('fatal: locked');
  });

  it('a discard git leaves half done says on the card to delete the folder, and a discard once it is gone moves the task', async () => {
    let left = true;
    const t = roundSetup({
      removeWorktree: async () => {
        if (left) throw new FolderLeftError('Permission denied');
      },
    });
    const view = await pausedTask(t);

    await expect(t.service.discard(view.id)).rejects.toThrow('Permission denied');
    expect(t.service.list()[0]).toMatchObject({
      place: null,
      problem: `Delete the folder git left behind, then Discard: ${view.worktreePath} (Permission denied)`,
    });

    left = false;
    await t.service.discard(view.id);
    expect(t.service.list()[0]).toMatchObject({ place: 'discarded', problem: null });
  });

  it('discard refuses a running task', async () => {
    const t = roundSetup();
    const view = await t.service.start(NEW_TASK);

    await expect(t.service.discard(view.id)).rejects.toThrow(`Close ${view.title} before discarding it`);
    expect(t.removals).toEqual([]);
    expect(t.service.list()[0].place).toBeNull();
  });

  it('discard refuses a task a round is removing', async () => {
    const gate = held();
    const t = roundSetup();
    const view = await pausedTask(t);
    t.states.set(view.branch, MERGED);
    t.removals.length = 0;
    // The round's removal holds.
    (t.service as unknown as { deps: { git: GitQueries } }).deps.git.removeWorktree = (async (dir: string, path: string, o: unknown) => {
      t.removals.push(['removeWorktree', dir, path, o]);
      await gate.promise;
    }) as GitQueries['removeWorktree'];
    const round = t.service.checkRound();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(t.service.discard(view.id)).rejects.toThrow(`Close ${view.title} before discarding it`);
    gate.release(undefined);
    await round;
    expect(t.removals.filter((r) => r[0] === 'removeWorktree')).toHaveLength(1);
  });

  it('a reopen while a discard removes starts no session', async () => {
    const gate = held();
    const t = roundSetup({ removeWorktree: () => gate.promise });
    const view = await pausedTask(t);

    const discarding = t.service.discard(view.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.service.reopen(view.id);
    expect(t.service.sessionIds()).toEqual([]);
    gate.release(undefined);
    await discarding;
    expect(t.service.list()[0].place).toBe('discarded');
  });

  it('a card whose task was discarded starts a fresh task', async () => {
    const t = roundSetup();
    const first = await t.service.start({ ...NEW_TASK, card: CARD });
    t.service.close(first.id);
    t.service.onSessionExit(first.session!.id);
    await t.service.discard(first.id);

    const second = await t.service.start({ ...NEW_TASK, title: 'Again', card: CARD });

    expect(second.id).not.toBe(first.id);
    expect(t.service.list()).toHaveLength(2);
  });

  it("Continue refuses a discarded task whose card has since started another task, and continues one whose card has none", async () => {
    const t = roundSetup();
    const first = await t.service.start({ ...NEW_TASK, card: CARD });
    t.service.close(first.id);
    t.service.onSessionExit(first.session!.id);
    await t.service.discard(first.id);
    const second = await t.service.start({ ...NEW_TASK, title: 'Again', card: CARD });

    await expect(t.service.continueTask(first.id)).rejects.toThrow(
      `${CARD.number} already has the task "Again"; continue that one instead`,
    );
    expect(t.service.list().find((v) => v.id === first.id)).toMatchObject({ place: 'discarded', session: null });

    // Once that one is discarded too, the card has no other task, and the first continues.
    t.service.close(second.id);
    t.service.onSessionExit(second.session!.id);
    await t.service.discard(second.id);
    const continued = await t.service.continueTask(first.id);
    expect(continued.place).toBeNull();
  });

  it('a card whose task is finished still refuses Start', async () => {
    const t = roundSetup();
    const first = await t.service.start({ ...NEW_TASK, card: CARD });
    t.sessionStarted(first.id, t.readState()[0].claudeSessionId);
    t.service.close(first.id);
    t.service.onSessionExit(first.session!.id);
    t.states.set(first.branch, MERGED);
    await t.service.checkRound();
    expect(t.service.list()[0].place).toBe('finished');

    await expect(t.service.start({ ...NEW_TASK, title: 'Again', card: CARD })).rejects.toThrow('already has the task');
  });

  it('a round leaves alone a task a discard is removing, and a reopen then starts no session', async () => {
    const gate = held();
    const t = roundSetup({ removeWorktree: () => gate.promise });
    const view = await pausedTask(t);
    t.states.set(view.branch, MERGED);
    const calls = () => t.checked.length;

    const discarding = t.service.discard(view.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const before = calls();
    await t.service.checkRound();
    expect(calls()).toBe(before);
    await t.service.reopen(view.id);
    expect(t.service.sessionIds()).toEqual([]);
    gate.release(undefined);
    await discarding;
    expect(t.service.list()[0].place).toBe('discarded');
  });

  it('discard refuses a finished task, a put-back task and an open task without a session', async () => {
    const t = roundSetup();
    const view = await pausedTask(t);
    const rec = t.readState()[0];
    const task = (t.service as unknown as { find(id: string): { place?: string; open: boolean } }).find(view.id);
    task.place = 'finished';
    await expect(t.service.discard(view.id)).rejects.toThrow('not paused on the board');
    task.place = 'putBack';
    await expect(t.service.discard(view.id)).rejects.toThrow('not paused on the board');
    delete task.place;
    task.open = true;
    await expect(t.service.discard(view.id)).rejects.toThrow(`Close ${view.title} before discarding it`);
    expect(rec).toBeDefined();
    expect(t.removals.filter((r) => r[0] === 'removeWorktree')).toEqual([]);
  });
});

describe('put back', () => {
  const PUT_BACK_PROMPT =
    "I'm putting this task back on the to-do list for later. Move its card back to the to-do list the way this repo's CLAUDE.md says, or else to its board's to-do list or status. Then stop.";

  it('putBackCard resumes the task with the put-back prompt and closes it once its turn is over', async () => {
    const t = roundSetup();
    const view = await pausedTask(t);
    t.killed.length = 0;
    const { claudeSessionId } = t.readState()[0];
    expect(putBackPrompt(ADAPTERS.claude.instructions)).toBe(PUT_BACK_PROMPT);

    let ended: boolean | null = null;
    const putting = t.service.putBackCard(view.id).then((done) => (ended = done));
    const [sessionId] = t.service.sessionIds();
    expect(t.service.launchSpec(sessionId)).toEqual({
      cwd: t.projectDir,
      argv: reopenArgv({
        claudeBin: 'claude',
        slug: 'fix-login',
        claudeSessionId,
        settingsPath: join(t.taskDir(view.id), 'settings.json'),
        prompt: PUT_BACK_PROMPT,
      }),
    });
    // Reports from before the turn begins do not end it.
    t.service.noteStatus(sessionId, 'idle');
    expect(t.killed).toEqual([]);
    t.service.noteStatus(sessionId, 'working');
    t.service.noteStatus(sessionId, 'done');
    expect(t.killed).toEqual([sessionId]);
    expect(t.readState()[0]).toMatchObject({ open: false, midTurn: false });

    await Promise.resolve();
    expect(ended).toBeNull();
    t.service.onSessionExit(sessionId);
    await putting;
    expect(ended).toBe(true);
  });

  it('a put-back session that asks for permission goes on putting back: once the owner answers and the turn ends, it closes', async () => {
    const t = roundSetup();
    const view = await pausedTask(t);
    t.killed.length = 0;
    let ended: boolean | null = null;
    const putting = t.service.putBackCard(view.id).then((done) => (ended = done));
    const [sessionId] = t.service.sessionIds();

    t.service.noteStatus(sessionId, 'working');
    t.service.noteStatus(sessionId, 'blocked');
    await Promise.resolve();
    expect(ended).toBeNull();
    expect(t.killed).toEqual([]);
    // The owner answers; the agent moves the card and its turn ends, idle this time.
    t.service.noteStatus(sessionId, 'working');
    t.service.noteStatus(sessionId, 'blocked');
    t.service.noteStatus(sessionId, 'idle');
    expect(t.killed).toEqual([sessionId]);
    t.service.onSessionExit(sessionId);
    await putting;
    expect(ended).toBe(true);
  });

  it("a put-back session closes on done though no 'working' came before it, and not on an idle before its turn", async () => {
    const t = roundSetup();
    const view = await pausedTask(t);
    t.killed.length = 0;
    void t.service.putBackCard(view.id);
    const [sessionId] = t.service.sessionIds();

    t.service.noteStatus(sessionId, 'idle');
    t.service.noteStatus(sessionId, 'blocked');
    t.service.noteStatus(sessionId, 'idle');
    expect(t.killed).toEqual([]);
    t.service.noteStatus(sessionId, 'done');
    expect(t.killed).toEqual([sessionId]);
  });

  it('a put-back session that errs stays open, and settles as given up', async () => {
    const t = roundSetup();
    const view = await pausedTask(t);
    t.killed.length = 0;
    const putting = t.service.putBackCard(view.id);
    const [sessionId] = t.service.sessionIds();

    t.service.noteStatus(sessionId, 'working');
    t.service.noteStatus(sessionId, 'error');
    t.service.noteStatus(sessionId, 'idle');
    await expect(putting).resolves.toBe(false);
    expect(t.killed).toEqual([]);
  });

  it('a put-back launch that dies before any report owes no carry-on prompt', async () => {
    const t = roundSetup();
    const view = await pausedTask(t);
    const putting = t.service.putBackCard(view.id);
    t.service.onSessionExit(t.service.sessionIds()[0]);
    await putting;
    expect(t.readState()[0].midTurn).toBe(false);
  });

  it('putBackCard of a task whose conversation never began starts no session', async () => {
    const t = roundSetup();
    const view = await pausedTask(t, { begin: false });
    await expect(t.service.putBackCard(view.id)).resolves.toBe(true);
    expect(t.service.sessionIds()).toEqual([]);
  });

  it('putBackCard refuses a running task', async () => {
    const t = roundSetup();
    const running = await t.service.start(NEW_TASK);
    await expect(t.service.putBackCard(running.id)).rejects.toThrow('Close Fix login before putting it back');
    expect(t.service.sessionIds()).toHaveLength(1);
  });

  it('markPutBack and returnToBoard move the task and set the problem', async () => {
    const t = roundSetup();
    const view = await pausedTask(t);

    t.service.returnToBoard(view.id, 'Put back: the card is not on the to-do list');
    expect(t.service.list()[0]).toMatchObject({ place: null, problem: 'Put back: the card is not on the to-do list' });
    expect(t.changes.at(-1)).toEqual(t.service.list());

    t.service.markPutBack(view.id);
    expect(t.service.list()[0]).toMatchObject({ place: 'putBack', problem: null });
    expect(t.readState()[0].place).toBe('putBack');

    t.service.returnToBoard(view.id);
    expect(t.service.list()[0]).toMatchObject({ place: null, problem: null });
    expect(t.readState()[0]).not.toHaveProperty('place');
  });

  it('a reopen clears the problem', async () => {
    const t = roundSetup();
    const view = await pausedTask(t);
    t.service.returnToBoard(view.id, 'Put back: the card is not on the to-do list');
    await t.service.reopen(view.id);
    expect(t.service.list()[0].problem).toBeNull();
  });

  it('markPutBack and returnToBoard leave a finished task, and markPutBack a running one, where they are', async () => {
    const t = roundSetup();
    const view = await pausedTask(t);
    t.states.set(view.branch, MERGED);
    await t.service.checkRound();
    expect(t.service.list()[0].place).toBe('finished');

    t.service.markPutBack(view.id);
    expect(t.service.list()[0].place).toBe('finished');
    t.service.returnToBoard(view.id, 'Put back: the card is not on the to-do list');
    expect(t.service.list()[0]).toMatchObject({ place: 'finished', problem: null });

    const running = await t.service.start({ ...NEW_TASK, title: 'Other' });
    t.service.markPutBack(running.id);
    expect(t.service.list().find((v) => v.id === running.id)!.place).toBeNull();
  });

  it('whilePuttingBack marks the task for the whole run, which Reopen, Discard, a second Put back and the round leave alone', async () => {
    const t = roundSetup();
    const view = await pausedTask(t);
    t.states.set(view.branch, MERGED);
    const gate = held();

    const putting = t.service.whilePuttingBack(view.id, () => gate.promise);
    expect(t.service.list()[0].puttingBack).toBe(true);
    expect(t.changes.at(-1)![0].puttingBack).toBe(true);

    await expect(t.service.whilePuttingBack(view.id, async () => {})).rejects.toThrow('Fix login is being put back');
    await expect(t.service.reopen(view.id)).rejects.toThrow('Fix login is being put back');
    await expect(t.service.discard(view.id)).rejects.toThrow('Fix login is being put back');
    await t.service.checkRound();
    expect(t.service.sessionIds()).toEqual([]);
    expect(t.removals).toEqual([]);
    expect(t.service.list()[0]).toMatchObject({ place: null, puttingBack: true });

    gate.release();
    await putting;
    expect(t.service.list()[0].puttingBack).toBe(false);
    expect(t.changes.at(-1)![0].puttingBack).toBe(false);
  });

  it('whilePuttingBack clears the mark when its run fails', async () => {
    const t = roundSetup();
    const view = await pausedTask(t);
    await expect(
      t.service.whilePuttingBack(view.id, async () => {
        throw new Error('git refused');
      }),
    ).rejects.toThrow('git refused');
    expect(t.service.list()[0].puttingBack).toBe(false);
    await expect(t.service.reopen(view.id)).resolves.toMatchObject({ session: { id: expect.any(String) } });
  });
});

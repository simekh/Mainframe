import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { GitQueries } from '../git';
import type { ChangedFile, TaskView } from '../../shared/types';
import { hookSettings, reopenArgv, SESSION_START_FILE, startArgv } from './launch';
import { openingPrompt } from './openingPrompt';
import type { TaskRecord } from './taskStore';
import { TaskService } from './taskService';

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(gitOverrides: Partial<GitQueries> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'thesource-service-'));
  cleanup.push(root);
  const projectDir = join(root, 'Damela');
  mkdirSync(projectDir);
  const dataDir = mkdtempSync(join(tmpdir(), 'thesource-data-'));
  cleanup.push(dataDir);

  const git: GitQueries = {
    startCheck: async () => null,
    branchExists: async () => false,
    worktreeBranchNames: async () => [],
    changedFiles: async () => [],
    ...gitOverrides,
  };
  const killed: string[] = [];
  const changes: TaskView[][] = [];
  const warnings: string[] = [];
  let counter = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

  const make = () =>
    new TaskService({
      projectDir,
      dataDir,
      claudeBin: 'claude',
      git,
      kill: (id) => killed.push(id),
      onChange: (tasks) => changes.push(tasks),
      newId,
      now: () => 1000,
      warn: (msg) => warnings.push(msg),
    });

  const stateFile = join(dataDir, 'state.json');
  const readState = (): TaskRecord[] => JSON.parse(readFileSync(stateFile, 'utf8')).tasks;
  const taskDir = (taskId: string) => join(dataDir, 'tasks', taskId);

  return { projectDir, dataDir, stateFile, make, service: make(), killed, changes, warnings, readState, taskDir };
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
    name: 'damela-fix-login',
    worktreePath: view.worktreePath,
    branch: 'worktree-fix-login',
    open: true,
    closedAt: null,
  });
  expect(new Set([record.id, record.claudeSessionId, view.session!.id]).size).toBe(3);

  const settingsPath = join(taskDir(record.id), 'settings.json');
  expect(readFileSync(settingsPath, 'utf8')).toBe(hookSettings(taskDir(record.id)));
  expect(service.launchSpec(view.session!.id)).toEqual({
    cwd: projectDir,
    argv: startArgv({
      claudeBin: 'claude',
      slug: 'fix-login',
      name: 'damela-fix-login',
      claudeSessionId: record.claudeSessionId,
      settingsPath,
      prompt: openingPrompt({ title: 'Fix login', description: 'Users get logged out', branch: 'worktree-fix-login', noQuestions: false }),
    }),
  });
  expect(changes.at(-1)).toEqual([view]);
  expect(service.list()).toEqual([view]);
});

it('start trims the title and passes noQuestions on to the opening prompt', async () => {
  const { service } = setup();
  const view = await service.start({ title: '  Fix login  ', description: '', noQuestions: true });
  expect(view.title).toBe('Fix login');
  const prompt = service.launchSpec(view.session!.id).argv.at(-1);
  expect(prompt).toBe(openingPrompt({ title: 'Fix login', description: '', branch: 'worktree-fix-login', noQuestions: true }));
});

it('start picks a slug that no task, worktree branch or worktree folder has taken', async () => {
  const { service, projectDir } = setup({ worktreeBranchNames: async () => ['fix-login-2'] });
  expect((await service.start(NEW_TASK)).slug).toBe('fix-login');
  mkdirSync(join(projectDir, '.claude', 'worktrees', 'fix-login-3'), { recursive: true });
  expect((await service.start(NEW_TASK)).slug).toBe('fix-login-4');
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
  const { service, killed, readState } = setup();
  const view = await service.start(NEW_TASK);
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
  const { service, make, projectDir, readState, taskDir } = setup();
  const view = await service.start(NEW_TASK);

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

it('reopen resumes in the worktree while its branch exists, and in the main checkout once it is gone', async () => {
  let branchExists = true;
  const { service, readState, taskDir } = setup({ branchExists: async () => branchExists });
  const view = await service.start(NEW_TASK);
  const { claudeSessionId } = readState()[0];
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

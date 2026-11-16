import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { DiffLine } from '../shared/types';
import {
  addWorktree,
  branchExists,
  changedFiles,
  deleteBranch,
  fetchBase,
  FolderLeftError,
  removeWorktree,
  startCheck,
  taskDiff,
  taskGitState,
  worktreeBranchNames,
} from './git';
import { makeRepo } from './testing/makeRepo';

const cleanup: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  // Retries: a test whose call fails fast can leave its other git processes running, and Windows keeps
  // their files locked until they have gone.
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function repo(): { origin: string; main: string } {
  const r = makeRepo();
  cleanup.push(dirname(r.origin));
  return r;
}

function git(dir: string, ...args: string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
}

const ctx = (text: string, o: number, n: number): DiffLine => ({ kind: 'context', text, oldLine: o, newLine: n });
const rem = (text: string, o: number): DiffLine => ({ kind: 'remove', text, oldLine: o, newLine: null });
const add = (text: string, n: number): DiffLine => ({ kind: 'add', text, oldLine: null, newLine: n });

function commitFile(dir: string, name: string, content: string | Buffer): void {
  writeFileSync(join(dir, name), content);
  git(dir, 'add', name);
  git(dir, 'commit', '-m', `add ${name}`);
}

it("startCheck reports the main checkout's branch, origin/HEAD and how far ahead it is", async () => {
  const { main } = repo();
  expect(await startCheck(main)).toEqual({ ahead: 0, branch: 'stage', base: 'origin/stage' });
  commitFile(main, 'local.txt', 'x\n');
  expect(await startCheck(main)).toEqual({ ahead: 1, branch: 'stage', base: 'origin/stage' });
});

it('startCheck is null outside a repo and without origin/HEAD', async () => {
  const bare = mkdtempSync(join(tmpdir(), 'mainframe-norepo-'));
  cleanup.push(bare);
  expect(await startCheck(bare)).toBeNull();

  const { main } = repo();
  git(main, 'remote', 'set-head', 'origin', '--delete');
  expect(await startCheck(main)).toBeNull();
});

it('branchExists sees local branches only', async () => {
  const { main } = repo();
  expect(await branchExists(main, 'stage')).toBe(true);
  expect(await branchExists(main, 'worktree-x')).toBe(false);
  git(main, 'branch', 'worktree-x');
  expect(await branchExists(main, 'worktree-x')).toBe(true);
});

it("branchExists fails when git can't be run at all, where a missing branch is false", async () => {
  const { main } = repo();
  expect(await branchExists(main, 'worktree-x')).toBe(false);
  vi.stubEnv('PATH', '');
  await expect(branchExists(main, 'worktree-x')).rejects.toMatchObject({ code: 'ENOENT' });
});

it('worktreeBranchNames lists worktree branches without the prefix', async () => {
  const { main } = repo();
  git(main, 'branch', 'worktree-a');
  git(main, 'branch', 'worktree-b');
  git(main, 'branch', 'other');
  expect(await worktreeBranchNames(main)).toEqual(['a', 'b']);
});

it('worktreeBranchNames ignores a tag of the same name', async () => {
  const { main } = repo();
  git(main, 'branch', 'worktree-x');
  git(main, 'tag', 'worktree-x');
  expect(await worktreeBranchNames(main)).toEqual(['x']);
});

it('changedFiles lists committed, uncommitted and untracked changes since the branch left origin/HEAD', async () => {
  const { main } = repo();
  const worktree = join(main, '.claude', 'worktrees', 'x');
  git(main, 'worktree', 'add', '-b', 'worktree-x', worktree, 'origin/stage');
  commitFile(worktree, 'a.txt', 'a\n');
  writeFileSync(join(worktree, 'README.md'), 'bye\n');
  writeFileSync(join(worktree, 'u.txt'), 'u\n');
  expect(await changedFiles(worktree)).toEqual([
    { path: 'README.md', status: 'M', added: 1, removed: 1 },
    { path: 'a.txt', status: 'A', added: 1, removed: 0 },
    { path: 'u.txt', status: '?', added: null, removed: null },
  ]);
});

it('changedFiles gives binary files no line counts', async () => {
  const { main } = repo();
  const worktree = join(main, '.claude', 'worktrees', 'x');
  git(main, 'worktree', 'add', '-b', 'worktree-x', worktree, 'origin/stage');
  commitFile(worktree, 'b.bin', Buffer.from([0x62, 0x00, 0x01, 0xff]));
  expect(await changedFiles(worktree)).toEqual([{ path: 'b.bin', status: 'A', added: null, removed: null }]);
});

it("changedFiles is null for a plain folder where the task's worktree goes, inside the main checkout", async () => {
  const { main } = repo();
  const folder = join(main, '.claude', 'worktrees', 'x');
  mkdirSync(folder, { recursive: true });
  // A change in the main checkout, which must not be read as the task's.
  writeFileSync(join(main, 'README.md'), 'bye\n');
  expect(await changedFiles(folder)).toBeNull();
});

it('changedFiles is null for a folder that is not a work tree', async () => {
  const bare = mkdtempSync(join(tmpdir(), 'mainframe-norepo-'));
  cleanup.push(bare);
  expect(await changedFiles(bare)).toBeNull();
});

/** A worktree on origin/stage, as the task's own. */
function worktreeOf(main: string): string {
  const worktree = join(main, '.claude', 'worktrees', 'x');
  git(main, 'worktree', 'add', '-b', 'worktree-x', worktree, 'origin/stage');
  return worktree;
}

it('taskDiff shows committed, uncommitted and untracked changes, matching changedFiles', async () => {
  const { main } = repo();
  const wt = worktreeOf(main);
  commitFile(wt, 'a.txt', 'a\n');
  writeFileSync(join(wt, 'README.md'), 'bye\n');
  writeFileSync(join(wt, 'u.txt'), 'u1\nu2\n');

  const files = (await taskDiff(wt, 'a.txt'))!;
  expect(files.map((f) => [f.path, f.hunks])).toEqual([
    ['README.md', [[rem('hi', 1), add('bye', 1)]]],
    ['a.txt', [[add('a', 1)]]],
    ['u.txt', [[add('u1', 1), add('u2', 2)]]],
  ]);
  const listed = (await changedFiles(wt))!;
  const summary = (f: { path: string; status: string; added: number | null; removed: number | null }) =>
    f.status === '?' ? { path: f.path, status: f.status } : { path: f.path, status: f.status, added: f.added, removed: f.removed };
  expect(files.map(summary)).toEqual(listed.map(summary));
  expect(files.find((f) => f.path === 'u.txt')).toMatchObject({ status: '?', added: 2, removed: 0 });
});

it('taskDiff notes binary, empty and mode-only files', async () => {
  const { main } = repo();
  const wt = worktreeOf(main);
  commitFile(wt, 'b.bin', Buffer.from([0x62, 0x00, 0x01, 0xff]));
  commitFile(wt, 'e.txt', '');
  writeFileSync(join(wt, 'ub.bin'), Buffer.from([0x62, 0x00, 0x01, 0xff]));
  const notes = Object.fromEntries((await taskDiff(wt, ''))!.map((f) => [f.path, f.note]));
  expect(notes).toEqual({ 'b.bin': 'binary', 'e.txt': 'empty', 'ub.bin': 'binary' });
});

it.skipIf(process.platform === 'win32')('taskDiff notes a mode-only change', async () => {
  const { main } = repo();
  const wt = worktreeOf(main);
  chmodSync(join(wt, 'README.md'), 0o755);
  expect((await taskDiff(wt, ''))!.map((f) => [f.path, f.note])).toEqual([['README.md', 'modeOnly']]);
});

it('taskDiff shows a deleted file with every line removed', async () => {
  const { main } = repo();
  commitFile(main, 'gone.txt', 'one\ntwo\n');
  git(main, 'push', 'origin', 'stage');
  const wt = worktreeOf(main);
  git(wt, 'rm', 'gone.txt');
  git(wt, 'commit', '-m', 'remove gone.txt');
  expect((await taskDiff(wt, 'gone.txt'))!.map((f) => [f.path, f.status, f.hunks])).toEqual([
    ['gone.txt', 'D', [[rem('one', 1), rem('two', 2)]]],
  ]);
});

it("taskDiff fails with git's message when git fails after finding the worktree", async () => {
  const { main } = repo();
  const wt = worktreeOf(main);
  writeFileSync(join(main, '.git', 'worktrees', 'x', 'index'), 'not an index');
  const failure = taskDiff(wt, '');
  await expect(failure).rejects.toThrow(/index/);
  await expect(failure).rejects.not.toThrow(/Command failed/);
});

it('taskDiff keeps paths with spaces and non-ASCII letters', async () => {
  const { main } = repo();
  const wt = worktreeOf(main);
  commitFile(wt, 'a b.txt', 'x\n');
  commitFile(wt, 'ö.txt', 'y\n');
  expect((await taskDiff(wt, ''))!.map((f) => f.path)).toEqual(['a b.txt', 'ö.txt']);
});

it("taskDiff ignores the user's diff settings", async () => {
  const { main } = repo();
  // ten.txt is on the base, so only the edit below is a change.
  const ten = (changed: boolean) =>
    Array.from({ length: 10 }, (_, i) => `${i === 4 && changed ? 'five' : i === 2 ? '' : i + 1}\n`).join('');
  commitFile(main, 'ten.txt', ten(false));
  git(main, 'push', 'origin', 'stage');
  const wt = worktreeOf(main);
  commitFile(wt, 'ö.txt', 'y\n');
  writeFileSync(join(wt, 'ten.txt'), ten(true));
  for (const [key, value] of [
    ['diff.noprefix', 'true'],
    ['diff.mnemonicPrefix', 'true'],
    ['color.ui', 'always'],
    ['diff.context', '10'],
    ['core.quotePath', 'true'],
    ['diff.suppressBlankEmpty', 'true'],
    ['diff.submodule', 'log'],
  ]) {
    git(wt, 'config', key, value);
  }
  const files = (await taskDiff(wt, ''))!;
  const changed = files.find((f) => f.path === 'ten.txt')!;
  expect(changed.hunks).toHaveLength(1);
  expect(changed.hunks[0]).toHaveLength(8);
  expect(changed.hunks[0].slice(0, 4)).toEqual([ctx('2', 2, 2), ctx('', 3, 3), ctx('4', 4, 4), rem('5', 5)]);
  expect(changed.hunks[0][7]).toEqual(ctx('8', 8, 8));
  expect(files.map((f) => f.path)).toContain('ö.txt');
});

it('taskDiff marks untracked files over the limits too large', async () => {
  const { main } = repo();
  const wt = worktreeOf(main);
  writeFileSync(join(wt, 'lines.txt'), 'x\n'.repeat(3001));
  writeFileSync(join(wt, 'wide.txt'), 'x'.repeat(1_100_000));
  const files = (await taskDiff(wt, ''))!;
  expect(files.find((f) => f.path === 'lines.txt')).toMatchObject({ note: 'tooLarge', added: 3001 });
  expect(files.find((f) => f.path === 'wide.txt')).toMatchObject({ note: 'tooLarge', added: null });
});

it("taskDiff marks tracked files over the limits too large, with the listing's counts", async () => {
  const { main } = repo();
  const wt = worktreeOf(main);
  commitFile(wt, 'lines.txt', 'x\n'.repeat(3001));
  commitFile(wt, 'wide.txt', 'x'.repeat(1_100_000) + '\n');
  const files = (await taskDiff(wt, ''))!;
  expect(files.find((f) => f.path === 'lines.txt')).toMatchObject({ note: 'tooLarge', hunks: [], added: 3001, removed: 0 });
  expect(files.find((f) => f.path === 'wide.txt')).toMatchObject({ note: 'tooLarge', hunks: [], added: 1, removed: 0 });
});

it('taskDiff is null for a folder that is gone', async () => {
  const bare = mkdtempSync(join(tmpdir(), 'mainframe-norepo-'));
  cleanup.push(bare);
  expect(await taskDiff(join(bare, 'missing'), '')).toBeNull();
});

it("taskDiff fails with git's message for a folder in no repository, where the worktree check fails", async () => {
  const bare = mkdtempSync(join(tmpdir(), 'mainframe-norepo-'));
  cleanup.push(bare);
  // git looks no higher than the temp folder, whatever repository may hold it.
  vi.stubEnv('GIT_CEILING_DIRECTORIES', dirname(bare));
  const failure = taskDiff(bare, '');
  await expect(failure).rejects.toThrow(/not a git repository/);
  await expect(failure).rejects.not.toThrow(/Command failed/);
});

it.skipIf(process.platform === 'win32')('taskDiff shows an untracked link as one line, its target', async () => {
  const { main } = repo();
  const wt = worktreeOf(main);
  symlinkSync('README.md', join(wt, 'link'));
  expect((await taskDiff(wt, ''))!.map((f) => [f.path, f.note, f.hunks])).toEqual([['link', null, [[add('README.md', 1)]]]]);
});

it('taskDiff notes an untracked nested repository', async () => {
  const { main } = repo();
  const wt = worktreeOf(main);
  git(wt, 'init', '--quiet', 'nested');
  expect((await taskDiff(wt, ''))!.map((f) => [f.path, f.note])).toEqual([['nested/', 'repository']]);
});

it('taskDiff reads untracked files within a budget, the clicked file first, and one too large is so past it', async () => {
  const { main } = repo();
  const wt = worktreeOf(main);
  const names = Array.from({ length: 17 }, (_, i) => `f${String(i + 1).padStart(2, '0')}.txt`);
  // Binary, so the files read cost nothing against the diff's own text limit.
  for (const name of names) writeFileSync(join(wt, name), '\0' + 'x'.repeat(999_999));
  // After the budget is spent: clicking it would not show it either.
  writeFileSync(join(wt, 'g.txt'), 'x'.repeat(1_100_000));
  const files = (await taskDiff(wt, 'f17.txt'))!;
  expect(files.find((f) => f.path === 'f17.txt')!.note).toBe('binary');
  expect(files.filter((f) => f.note === 'notShown').map((f) => f.path)).toEqual(['f16.txt']);
  expect(files.find((f) => f.path === 'g.txt')!.note).toBe('tooLarge');
});

function out(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

it('addWorktree branches from origin/HEAD when there is one', async () => {
  const { main } = repo();
  commitFile(main, 'local.txt', 'x\n');
  const path = join(dirname(main), 'wt');
  await addWorktree(main, path, 'worktree-a', { create: true });
  expect(out(path, 'rev-parse', 'HEAD')).toBe(out(main, 'rev-parse', 'origin/HEAD'));
  expect(out(path, 'rev-parse', 'HEAD')).not.toBe(out(main, 'rev-parse', 'HEAD'));
  // Like a Claude task's branch, it tracks nothing on the remote.
  expect(() =>
    execFileSync('git', ['-C', main, 'rev-parse', '--abbrev-ref', 'worktree-a@{upstream}'], { stdio: 'pipe' }),
  ).toThrow(/no upstream/);
});

it('addWorktree branches from HEAD without origin/HEAD', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mainframe-norepo-'));
  cleanup.push(dir);
  git(dir, 'init', '-b', 'stage');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  commitFile(dir, 'a.txt', 'a\n');
  const path = join(dir, 'wt');
  await addWorktree(dir, path, 'worktree-a', { create: true });
  expect(out(path, 'rev-parse', 'HEAD')).toBe(out(dir, 'rev-parse', 'HEAD'));
});

it('addWorktree adds a deleted worktree back on its branch', async () => {
  const { main } = repo();
  const path = join(dirname(main), 'wt');
  await addWorktree(main, path, 'worktree-a', { create: true });
  rmSync(path, { recursive: true, force: true });
  await addWorktree(main, path, 'worktree-a', { create: false });
  expect(existsSync(path)).toBe(true);
  expect(out(path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('worktree-a');
});

it('addWorktree rejects when the branch is taken', async () => {
  const { main } = repo();
  git(main, 'branch', 'worktree-a');
  await expect(addWorktree(main, join(dirname(main), 'wt'), 'worktree-a', { create: true })).rejects.toThrow();
});

it("a folder holding a .gitignore of * stays out of git status, in a repo's root or in a subfolder project", () => {
  const { main } = repo();
  for (const project of [main, join(main, 'sub')]) {
    const folder = join(project, '.mainframe', 'worktrees');
    mkdirSync(join(folder, 'x'), { recursive: true });
    writeFileSync(join(folder, '.gitignore'), '*\n');
    writeFileSync(join(folder, 'x', 'a.txt'), 'a\n');
  }
  expect(out(main, 'status', '--porcelain')).toBe('');
});

/** A task branch and its worktree, made as Mainframe makes them: from origin/HEAD, tracking nothing. */
function taskBranch(main: string, name = 't'): { branch: string; wt: string } {
  const branch = `worktree-${name}`;
  const wt = join(dirname(main), `wt-${name}`);
  git(main, 'worktree', 'add', '--no-track', '-b', branch, wt, 'origin/HEAD');
  return { branch, wt };
}

const GONE = { branch: 'gone', tip: null, uncommitted: [], elsewhere: false, unsaved: [] };

it('taskGitState is gone for a missing branch and a missing folder', async () => {
  const { main } = repo();
  expect(await taskGitState(main, 'worktree-nope', join(dirname(main), 'nowhere'))).toEqual(GONE);
});

it('taskGitState marks a worktree on another branch or a detached HEAD as elsewhere, and lists its unsaved commits', async () => {
  const { main } = repo();
  const { branch, wt } = taskBranch(main);
  git(main, 'branch', '-m', branch, 'renamed');
  expect(await taskGitState(main, branch, wt)).toEqual({ ...GONE, elsewhere: true });

  git(wt, 'checkout', '--detach');
  commitFile(wt, 'd.txt', 'd\n');
  expect(await taskGitState(main, branch, wt)).toEqual({ ...GONE, elsewhere: true, unsaved: ['add d.txt'] });
});

it('removeWorktree rejects a locked worktree', async () => {
  const { main } = repo();
  const { wt } = taskBranch(main);
  git(main, 'worktree', 'lock', wt);
  await expect(removeWorktree(main, wt, { force: false })).rejects.toThrow(/locked/);
  await expect(removeWorktree(main, wt, { force: true })).rejects.toThrow(/locked/);
  expect(existsSync(wt)).toBe(true);
});

it('taskGitState is no-commits for a branch still where it was created, even once the base moves on', async () => {
  const { main } = repo();
  const { branch, wt } = taskBranch(main);
  expect((await taskGitState(main, branch, wt)).branch).toBe('no-commits');
  commitFile(main, 'm.txt', 'm\n');
  git(main, 'push', 'origin', 'stage');
  expect(await taskGitState(main, branch, wt)).toEqual({ branch: 'no-commits', tip: expect.any(String), uncommitted: [], elsewhere: false, unsaved: [] });
});

it('taskGitState is no-commits for an empty branch moved up to a newer base by a reset, a fast-forward or a rebase', async () => {
  const { main } = repo();
  const reset = taskBranch(main, 'reset');
  const ff = taskBranch(main, 'ff');
  const rebased = taskBranch(main, 'rebased');
  commitFile(main, 'm.txt', 'm\n');
  git(main, 'push', 'origin', 'stage');

  git(reset.wt, 'reset', '--hard', 'origin/stage');
  git(ff.wt, 'merge', '--ff-only', 'origin/stage');
  git(rebased.wt, 'rebase', 'origin/stage');

  for (const { branch, wt } of [reset, ff, rebased]) {
    expect((await taskGitState(main, branch, wt)).branch).toBe('no-commits');
  }
});

it('taskGitState is merged for a branch with its own commit, rebased onto a newer base and then merged', async () => {
  const { main } = repo();
  const { branch, wt } = taskBranch(main);
  commitFile(wt, 'a.txt', 'a\n');
  commitFile(main, 'm.txt', 'm\n');
  git(main, 'push', 'origin', 'stage');
  git(wt, 'rebase', 'origin/stage');
  expect((await taskGitState(main, branch, wt)).branch).toBe('unmerged');

  git(main, 'merge', '--ff-only', branch);
  git(main, 'push', 'origin', 'stage');
  expect((await taskGitState(main, branch, wt)).branch).toBe('merged');
});

it('taskGitState gives the tip it judged, and null for a branch that is gone', async () => {
  const { main } = repo();
  const { branch, wt } = taskBranch(main);
  commitFile(wt, 'a.txt', 'a\n');
  expect((await taskGitState(main, branch, wt)).tip).toBe(out(main, 'rev-parse', branch));
  expect((await taskGitState(main, 'worktree-nope', wt)).tip).toBeNull();
});

it('taskGitState is merged after a fast-forward merge, a merge commit and a squash merge', async () => {
  const { main } = repo();
  const ff = taskBranch(main, 'ff');
  commitFile(ff.wt, 'ff.txt', 'ff\n');
  const mc = taskBranch(main, 'mc');
  commitFile(mc.wt, 'mc.txt', 'mc\n');
  const sq = taskBranch(main, 'sq');
  commitFile(sq.wt, 'sq.txt', 'sq\n');

  git(main, 'merge', '--ff-only', ff.branch);
  git(main, 'push', 'origin', 'stage');
  expect(await taskGitState(main, ff.branch, ff.wt)).toEqual({ branch: 'merged', tip: expect.any(String), uncommitted: [], elsewhere: false, unsaved: [] });

  git(main, 'merge', '--no-ff', '-m', 'merge mc', mc.branch);
  git(main, 'push', 'origin', 'stage');
  expect(await taskGitState(main, mc.branch, mc.wt)).toEqual({ branch: 'merged', tip: expect.any(String), uncommitted: [], elsewhere: false, unsaved: [] });

  git(main, 'merge', '--squash', sq.branch);
  git(main, 'commit', '-m', 'squash sq');
  git(main, 'push', 'origin', 'stage');
  // The squash commit is not the branch's commit: only the tree comparison sees it as merged. Its own commit is on no remote.
  expect((await taskGitState(main, sq.branch, sq.wt)).branch).toBe('merged');
  expect((await taskGitState(main, sq.branch, sq.wt)).unsaved).toEqual(['add sq.txt']);
});

it('taskGitState is unmerged for a branch with commits not on the base, and lists those not on any remote', async () => {
  const { main } = repo();
  const { branch, wt } = taskBranch(main);
  commitFile(wt, 'a.txt', 'a\n');
  commitFile(wt, 'b.txt', 'b\n');
  expect(await taskGitState(main, branch, wt)).toEqual({
    branch: 'unmerged',
    tip: expect.any(String),
    uncommitted: [],
    elsewhere: false,
    unsaved: ['add b.txt', 'add a.txt'],
  });
  git(main, 'push', 'origin', branch);
  expect(await taskGitState(main, branch, wt)).toEqual({ branch: 'unmerged', tip: expect.any(String), uncommitted: [], elsewhere: false, unsaved: [] });
});

it('taskGitState lists uncommitted and untracked files, not ignored ones', async () => {
  const { main } = repo();
  commitFile(main, '.gitignore', 'ignored.txt\n');
  git(main, 'push', 'origin', 'stage');
  const { branch, wt } = taskBranch(main);
  writeFileSync(join(wt, 'README.md'), 'changed\n');
  writeFileSync(join(wt, 'new.txt'), 'n\n');
  writeFileSync(join(wt, 'ignored.txt'), 'i\n');
  expect((await taskGitState(main, branch, wt)).uncommitted).toEqual(['README.md', 'new.txt']);
});

it('taskGitState uses HEAD as the base when there is no origin/HEAD', async () => {
  const { main } = repo();
  const { branch, wt } = taskBranch(main);
  commitFile(wt, 'a.txt', 'a\n');
  git(main, 'remote', 'set-head', 'origin', '--delete');
  expect((await taskGitState(main, branch, wt)).branch).toBe('unmerged');
  git(main, 'merge', '--ff-only', branch);
  expect((await taskGitState(main, branch, wt)).branch).toBe('merged');
});

it('fetchBase brings in a merge pushed from another clone, and resolves without a remote', async () => {
  const { origin, main } = repo();
  const { branch, wt } = taskBranch(main);
  commitFile(wt, 'a.txt', 'a\n');
  git(main, 'push', 'origin', branch);
  const other = join(dirname(main), 'other');
  git(dirname(main), 'clone', origin, other);
  git(other, 'config', 'user.name', 'Test');
  git(other, 'config', 'user.email', 'test@example.com');
  git(other, 'config', 'commit.gpgsign', 'false');
  git(other, 'merge', '--no-ff', '-m', 'merge a', `origin/${branch}`);
  git(other, 'push', 'origin', 'stage');
  expect((await taskGitState(main, branch, wt)).branch).toBe('unmerged');
  await fetchBase(main);
  expect((await taskGitState(main, branch, wt)).branch).toBe('merged');

  git(main, 'remote', 'remove', 'origin');
  await expect(fetchBase(main)).resolves.toBeUndefined();
});

it('removeWorktree and deleteBranch remove a merged task\'s worktree and branch, and resolve when they are gone already', async () => {
  const { main } = repo();
  const { branch, wt } = taskBranch(main);
  commitFile(wt, 'a.txt', 'a\n');
  git(main, 'merge', '--ff-only', branch);
  await removeWorktree(main, wt, { force: false });
  await deleteBranch(main, branch);
  expect(existsSync(wt)).toBe(false);
  expect(await branchExists(main, branch)).toBe(false);
  await expect(removeWorktree(main, wt, { force: false })).resolves.toBeUndefined();
  await expect(deleteBranch(main, branch)).resolves.toBeUndefined();
});

it('removeWorktree refuses a worktree with untracked files unless forced', async () => {
  const { main } = repo();
  const { wt } = taskBranch(main);
  writeFileSync(join(wt, 'u.txt'), 'u\n');
  await expect(removeWorktree(main, wt, { force: false })).rejects.toThrow();
  expect(existsSync(wt)).toBe(true);
  await removeWorktree(main, wt, { force: true });
  expect(existsSync(wt)).toBe(false);
});

/** The worktree folders git has registered, as it prints them. */
function registered(main: string): string[] {
  return out(main, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

it("removeWorktree clears a hand-deleted folder's registration, so its branch can go, and leaves other worktrees' entries", async () => {
  const { main } = repo();
  const { branch, wt } = taskBranch(main);
  const other = taskBranch(main, 'other');
  rmSync(wt, { recursive: true, force: true });
  rmSync(other.wt, { recursive: true, force: true });
  expect(registered(main)).toHaveLength(3);

  await removeWorktree(main, wt, { force: false });
  await deleteBranch(main, branch);

  expect(await branchExists(main, branch)).toBe(false);
  // Only the task's own entry went: the other hand-deleted folder is the user's to prune.
  expect(registered(main)).toHaveLength(2);
  expect(registered(main).some((path) => path.endsWith('wt-other'))).toBe(true);
});

it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'a removal git leaves half done rejects as a folder left behind; once the folder is deleted by hand, removal and the check work again',
  async () => {
    const { main } = repo();
    const { branch, wt } = taskBranch(main);
    commitFile(wt, '.gitignore', 'build/\n');
    git(main, 'merge', '--ff-only', branch);
    git(main, 'push', 'origin', 'stage');
    mkdirSync(join(wt, 'build'));
    writeFileSync(join(wt, 'build', 'out.txt'), 'x\n');
    chmodSync(join(wt, 'build'), 0o555);
    try {
      const failed = removeWorktree(main, wt, { force: false });
      await expect(failed).rejects.toBeInstanceOf(FolderLeftError);
      await expect(failed).rejects.toThrow(/Permission denied/);
      expect(existsSync(wt)).toBe(true);
    } finally {
      chmodSync(join(wt, 'build'), 0o755);
    }

    rmSync(wt, { recursive: true, force: true });
    expect((await taskGitState(main, branch, wt)).branch).toBe('merged');
    await removeWorktree(main, wt, { force: true });
    await deleteBranch(main, branch);
    expect(await branchExists(main, branch)).toBe(false);
  },
);

it('a removal git refuses with the worktree intact rejects with an ordinary error, not a folder left behind', async () => {
  const { main } = repo();
  const { wt } = taskBranch(main);
  writeFileSync(join(wt, 'u.txt'), 'u\n');
  const failed = removeWorktree(main, wt, { force: false });
  await expect(failed).rejects.toThrow(/untracked/);
  await expect(failed).rejects.not.toBeInstanceOf(FolderLeftError);
});

it('deleteBranch given the tip judged deletes the branch only while it still points there', async () => {
  const { main } = repo();
  const { branch, wt } = taskBranch(main);
  commitFile(wt, 'a.txt', 'a\n');
  const judged = out(main, 'rev-parse', branch);
  commitFile(wt, 'b.txt', 'b\n');
  await removeWorktree(main, wt, { force: false });

  await expect(deleteBranch(main, branch, judged)).rejects.toThrow();
  expect(await branchExists(main, branch)).toBe(true);

  git(main, 'config', `branch.${branch}.description`, 'kept by git branch');
  await deleteBranch(main, branch, out(main, 'rev-parse', branch));
  expect(await branchExists(main, branch)).toBe(false);
  // As `git branch -D` does, the branch's settings go too: Continue makes a branch of the same name.
  expect(() => out(main, 'config', '--get-regexp', `^branch\\.${branch}\\.`)).toThrow();
});

it("fetchBase leaves the main checkout's FETCH_HEAD alone, and fetches the remote's branch though a local branch is named origin/<it>", async () => {
  const { origin, main } = repo();
  const other = join(dirname(main), 'other');
  git(dirname(main), 'clone', origin, other);
  git(other, 'config', 'user.name', 'Test');
  git(other, 'config', 'user.email', 'test@example.com');
  git(other, 'config', 'commit.gpgsign', 'false');
  commitFile(other, 'o.txt', 'o\n');
  git(other, 'push', 'origin', 'stage');
  // A local branch whose short name is the same as the remote-tracking one's.
  git(main, 'branch', 'origin/stage');
  const fetchHead = join(main, '.git', 'FETCH_HEAD');
  rmSync(fetchHead, { force: true });

  await fetchBase(main);

  expect(out(main, 'rev-parse', 'refs/remotes/origin/stage')).toBe(out(other, 'rev-parse', 'HEAD'));
  expect(existsSync(fetchHead)).toBe(false);
});

it('taskGitState keeps a commit with an empty subject among the unsaved ones', async () => {
  const { main } = repo();
  const { branch, wt } = taskBranch(main);
  git(wt, 'commit', '--allow-empty', '--allow-empty-message', '-m', '');
  expect((await taskGitState(main, branch, wt)).unsaved).toEqual(['']);
});

it('taskGitState rejects when it cannot read the worktree, rather than reporting nothing to lose', async () => {
  const { main } = repo();
  const { branch, wt } = taskBranch(main);
  writeFileSync(join(wt, '.git'), 'garbage\n');
  await expect(taskGitState(main, branch, wt)).rejects.toThrow();
});

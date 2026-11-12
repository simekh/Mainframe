import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { DiffLine } from '../shared/types';
import { branchExists, changedFiles, startCheck, taskDiff, worktreeBranchNames } from './git';
import { makeRepo } from './testing/makeRepo';

const cleanup: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
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

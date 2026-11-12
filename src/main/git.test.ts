import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { addWorktree, branchExists, changedFiles, startCheck, worktreeBranchNames } from './git';
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

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { branchExists, changedFiles, startCheck, worktreeBranchNames } from './git';
import { makeRepo } from './testing/makeRepo';

const cleanup: string[] = [];

afterEach(() => {
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

function commitFile(dir: string, name: string, content: string): void {
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
  const bare = mkdtempSync(join(tmpdir(), 'thesource-norepo-'));
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

it('worktreeBranchNames lists worktree branches without the prefix', async () => {
  const { main } = repo();
  git(main, 'branch', 'worktree-a');
  git(main, 'branch', 'worktree-b');
  git(main, 'branch', 'other');
  expect(await worktreeBranchNames(main)).toEqual(['a', 'b']);
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

it('changedFiles is null for a folder that is not a work tree', async () => {
  const bare = mkdtempSync(join(tmpdir(), 'thesource-norepo-'));
  cleanup.push(bare);
  expect(await changedFiles(bare)).toBeNull();
});

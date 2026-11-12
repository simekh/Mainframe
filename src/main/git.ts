// Adapted from Parallel Code (MIT): electron/ipc/git.ts (getChangedFiles) at 97c3558. See THIRD_PARTY_NOTICES.md.
import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { ChangedFile, StartCheck } from '../shared/types';

const execFileAsync = promisify(execFile);

// --no-optional-locks keeps the app from taking the index lock while a session runs git.
async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['--no-optional-locks', '-C', dir, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    // No console window flashes on Windows for each git call.
    windowsHide: true,
  });
  return stdout;
}

export async function startCheck(projectDir: string): Promise<StartCheck | null> {
  try {
    const [branch, base, ahead] = await Promise.all([
      git(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(projectDir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
      git(projectDir, ['rev-list', '--count', 'origin/HEAD..HEAD']),
    ]);
    return { ahead: Number(ahead), branch: branch.trim(), base: base.trim() };
  } catch {
    return null;
  }
}

/** Rejects when git can't be run at all: that says nothing of the branch. */
export async function branchExists(projectDir: string, branch: string): Promise<boolean> {
  try {
    await git(projectDir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch (err) {
    // A git that ran and found no branch exits non-zero; one that never ran has a code such as ENOENT.
    if (typeof (err as { code?: unknown }).code !== 'number') throw err;
    return false;
  }
}

const WORKTREE_PREFIX = 'worktree-';

export async function worktreeBranchNames(projectDir: string): Promise<string[]> {
  try {
    const out = await git(projectDir, [
      'for-each-ref',
      '--format=%(refname:lstrip=2)',
      `refs/heads/${WORKTREE_PREFIX}*`,
    ]);
    return out
      .split('\n')
      .filter(Boolean)
      .map((name) => name.slice(WORKTREE_PREFIX.length));
  } catch {
    return [];
  }
}

// `git diff` against the working tree refreshes stat-only changes by rewriting the index,
// which takes index.lock; a session committing in the same worktree would then fail.
const NO_INDEX_REFRESH = ['-c', 'diff.autoRefreshIndex=false'];

/** Null when the path is not a work tree's top: a missing folder, or a plain one inside the main checkout. */
export async function changedFiles(worktreePath: string): Promise<ChangedFile[] | null> {
  try {
    // Real paths on both sides: macOS's temp folders sit behind the /var → /private/var link.
    const top = (await git(worktreePath, ['rev-parse', '--show-toplevel'])).trim();
    if ((await realpath(top)) !== (await realpath(worktreePath))) return null;
    const base = (await git(worktreePath, ['merge-base', 'HEAD', 'origin/HEAD']).catch(() => 'HEAD')).trim();
    const diff = ['diff', '--no-renames', '-z'];
    const [nameStatus, numstat, untracked] = await Promise.all([
      git(worktreePath, [...NO_INDEX_REFRESH, ...diff, '--name-status', base, '--']),
      git(worktreePath, [...NO_INDEX_REFRESH, ...diff, '--numstat', base, '--']),
      git(worktreePath, ['ls-files', '--others', '--exclude-standard', '-z']),
    ]);

    const counts = new Map<string, { added: number | null; removed: number | null }>();
    for (const record of numstat.split('\0').filter(Boolean)) {
      const [added, removed, ...rest] = record.split('\t');
      counts.set(rest.join('\t'), {
        added: added === '-' ? null : Number(added),
        removed: removed === '-' ? null : Number(removed),
      });
    }

    const files: ChangedFile[] = [];
    const fields = nameStatus.split('\0').filter(Boolean);
    for (let i = 0; i + 1 < fields.length; i += 2) {
      const path = fields[i + 1];
      const { added, removed } = counts.get(path) ?? { added: null, removed: null };
      files.push({ path, status: fields[i] as ChangedFile['status'], added, removed });
    }
    for (const path of untracked.split('\0').filter(Boolean)) {
      files.push({ path, status: '?', added: null, removed: null });
    }
    return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  } catch {
    return null;
  }
}

/** Rejects with git's error. `create` makes the branch from origin/HEAD, or from HEAD without one; otherwise the branch exists and only its folder is gone. */
export async function addWorktree(projectDir: string, path: string, branch: string, o: { create: boolean }): Promise<void> {
  if (!o.create) {
    await git(projectDir, ['worktree', 'prune']);
    await git(projectDir, ['worktree', 'add', path, branch]);
    return;
  }
  const base = await git(projectDir, ['rev-parse', '--verify', '--quiet', 'origin/HEAD']).then(
    () => 'origin/HEAD',
    () => 'HEAD',
  );
  await git(projectDir, ['worktree', 'add', '-b', branch, path, base]);
}

export const gitQueries = { startCheck, branchExists, worktreeBranchNames, changedFiles, addWorktree };
export type GitQueries = typeof gitQueries;

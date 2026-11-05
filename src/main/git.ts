// Adapted from Parallel Code (MIT): electron/ipc/git.ts (getChangedFiles) at 97c3558. See THIRD_PARTY_NOTICES.md.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChangedFile, StartCheck } from '../shared/types';

const execFileAsync = promisify(execFile);

// --no-optional-locks keeps the app from taking the index lock while a session runs git.
async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['--no-optional-locks', '-C', dir, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
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

export async function branchExists(projectDir: string, branch: string): Promise<boolean> {
  try {
    await git(projectDir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

const WORKTREE_PREFIX = 'worktree-';

export async function worktreeBranchNames(projectDir: string): Promise<string[]> {
  try {
    const out = await git(projectDir, [
      'for-each-ref',
      '--format=%(refname:short)',
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

export async function changedFiles(worktreePath: string): Promise<ChangedFile[] | null> {
  try {
    if ((await git(worktreePath, ['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') return null;
    const base = (await git(worktreePath, ['merge-base', 'HEAD', 'origin/HEAD']).catch(() => 'HEAD')).trim();
    const diff = ['diff', '--no-renames', '-z'];
    const [nameStatus, numstat, untracked] = await Promise.all([
      git(worktreePath, [...NO_INDEX_REFRESH, ...diff, '--name-status', base]),
      git(worktreePath, [...NO_INDEX_REFRESH, ...diff, '--numstat', base]),
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

export const gitQueries = { startCheck, branchExists, worktreeBranchNames, changedFiles };
export type GitQueries = typeof gitQueries;

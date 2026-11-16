// Adapted from Parallel Code (MIT): electron/ipc/git.ts (getChangedFiles) at 97c3558. See THIRD_PARTY_NOTICES.md.
import { execFile } from 'node:child_process';
import { lstat, open, readlink, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ChangedFile, FileDiff, StartCheck, TaskGitState } from '../shared/types';
import { assembleDiff, DIFF_LIMITS, focusFirst, type UntrackedContent } from './diff/assembleDiff';
import { parsePatch } from './diff/parsePatch';

const execFileAsync = promisify(execFile);

// --no-optional-locks keeps the app from taking the index lock while a session runs git.
async function git(
  dir: string,
  args: string[],
  opts: { maxBuffer?: number; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<string> {
  const { stdout } = await execFileAsync('git', ['--no-optional-locks', '-C', dir, ...args], {
    encoding: 'utf8',
    maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
    env: opts.env && { ...process.env, ...opts.env },
    timeout: opts.timeoutMs,
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

/** Real paths on both sides: macOS's temp folders sit behind the /var → /private/var link. */
async function isWorktreeTop(path: string): Promise<boolean> {
  const top = (await git(path, ['rev-parse', '--show-toplevel'])).trim();
  return (await realpath(top)) === (await realpath(path));
}

async function diffBase(path: string): Promise<string> {
  return (await git(path, ['merge-base', 'HEAD', 'origin/HEAD']).catch(() => 'HEAD')).trim();
}

/** The panel's listing: the files changed since `base` with their counts, and the untracked ones. */
async function listChanges(path: string, base: string): Promise<ChangedFile[]> {
  const diff = ['diff', '--no-renames', '-z'];
  const [nameStatus, numstat, untracked] = await Promise.all([
    git(path, [...NO_INDEX_REFRESH, ...diff, '--name-status', base, '--']),
    git(path, [...NO_INDEX_REFRESH, ...diff, '--numstat', base, '--']),
    git(path, ['ls-files', '--others', '--exclude-standard', '-z']),
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
    const file = fields[i + 1];
    const { added, removed } = counts.get(file) ?? { added: null, removed: null };
    files.push({ path: file, status: fields[i] as ChangedFile['status'], added, removed });
  }
  for (const file of untracked.split('\0').filter(Boolean)) {
    files.push({ path: file, status: '?', added: null, removed: null });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Null when the path is not a work tree's top: a missing folder, or a plain one inside the main checkout. */
export async function changedFiles(worktreePath: string): Promise<ChangedFile[] | null> {
  try {
    if (!(await isWorktreeTop(worktreePath))) return null;
    return await listChanges(worktreePath, await diffBase(worktreePath));
  } catch {
    return null;
  }
}

// Untracked files are read into memory before the diff's own limits apply: a stray build folder must not fill it.
const UNTRACKED_BUDGET_BYTES = 16 * 1024 * 1024;
const DIFF_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Undefined for a file that is gone since the listing, or is neither a regular file nor a link.
 * A link reads as git shows it: one line, its target. The first file that would take `budget` past
 * its bytes, and every file after it, is left unread.
 */
async function readUntracked(
  worktreePath: string,
  path: string,
  budget: { left: number; spent: boolean },
): Promise<UntrackedContent | undefined> {
  const file = join(worktreePath, path);
  try {
    // A link's size is its target's length.
    const info = await lstat(file);
    if (!info.isFile() && !info.isSymbolicLink()) return undefined;
    if (info.size > DIFF_LIMITS.fileChars) return { kind: 'tooLarge' };
    if (budget.spent) return { kind: 'notRead' };
    if (info.size > budget.left) {
      budget.spent = true;
      return { kind: 'notRead' };
    }
    budget.left -= info.size;
    if (info.isSymbolicLink()) return { kind: 'text', lines: [await readlink(file)] };
    // No more than the size the limits were checked against: the file may grow while it is read.
    const handle = await open(file, 'r');
    const buffer = Buffer.alloc(info.size);
    let read = 0;
    try {
      // A read may return less than asked (a network drive): go on to the size, or the end of the file.
      while (read < info.size) {
        const { bytesRead } = await handle.read(buffer, read, info.size - read, read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
    } finally {
      await handle.close();
    }
    const bytes = buffer.subarray(0, read);
    if (bytes.subarray(0, 8000).includes(0)) return { kind: 'binary' };
    const lines = bytes.toString('utf8').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return { kind: 'text', lines: lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)) };
  } catch {
    return undefined;
  }
}

/** git's own words: execFile's message leads with the whole command line. */
function gitError(err: unknown): Error {
  const stderr = String((err as { stderr?: unknown }).stderr ?? '').trim();
  return stderr ? new Error(stderr) : (err as Error);
}

function withGitMessage(err: unknown): never {
  throw gitError(err);
}

/**
 * What the diff window shows: the changed-files listing joined with the patch and the untracked files' contents.
 * Null when the folder is gone, or is a plain one inside another checkout; any other failure throws, so a
 * broken git is not shown as a removed worktree.
 * The flags make the patch the same under any user's diff settings, which parsePatch relies on.
 */
export async function taskDiff(worktreePath: string, focus: string): Promise<FileDiff[] | null> {
  try {
    await stat(worktreePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  if (!(await isWorktreeTop(worktreePath).catch(withGitMessage))) return null;
  const base = await diffBase(worktreePath);
  const [listed, patch] = await Promise.all([
    listChanges(worktreePath, base),
    git(
      worktreePath,
      [
        '-c', 'core.quotePath=false',
        '-c', 'diff.suppressBlankEmpty=false',
        ...NO_INDEX_REFRESH,
        'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', '--no-renames',
        '--submodule=short', '--src-prefix=a/', '--dst-prefix=b/', '-U3', base, '--',
      ],
      { maxBuffer: DIFF_MAX_BUFFER },
    ).catch((err: unknown) => {
      if ((err as { code?: unknown }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        throw new Error('the changes are too large to read (over 64 MB)');
      }
      throw err;
    }),
  ]).catch(withGitMessage);
  const untracked = new Map<string, UntrackedContent>();
  // One at a time, the clicked file first, so a burst of files can't exhaust memory or file handles.
  const budget = { left: UNTRACKED_BUDGET_BYTES, spent: false };
  const paths = listed.filter((f) => f.status === '?').map((f) => f.path);
  for (const path of focusFirst(paths, (p) => p === focus)) {
    const content = await readUntracked(worktreePath, path, budget);
    if (content) untracked.set(path, content);
  }
  return assembleDiff(listed, parsePatch(patch, DIFF_LIMITS.fileLines), untracked, focus);
}

/** Rejects with git's error. `create` makes the branch from origin/HEAD, or from HEAD without one; otherwise the branch exists and only its folder is gone. */
export async function addWorktree(projectDir: string, path: string, branch: string, o: { create: boolean }): Promise<void> {
  if (!o.create) {
    await git(projectDir, ['worktree', 'prune']);
    await git(projectDir, ['worktree', 'add', path, branch]);
    return;
  }
  await git(projectDir, ['worktree', 'add', '--no-track', '-b', branch, path, await base(projectDir)]);
}

/** What a task's branch is compared with: origin/HEAD, or the main checkout's HEAD without one. */
async function base(projectDir: string): Promise<string> {
  return git(projectDir, ['rev-parse', '--verify', '--quiet', 'origin/HEAD']).then(
    () => 'origin/HEAD',
    () => 'HEAD',
  );
}

/** Brings the remote's default branch up to date, so a merge made elsewhere shows. Never rejects: no remote, no network or a slow one is not an error. */
export async function fetchBase(projectDir: string): Promise<void> {
  try {
    // In full: a local branch named origin/<x> would make the short name ambiguous.
    const head = (await git(projectDir, ['symbolic-ref', 'refs/remotes/origin/HEAD'])).trim();
    const prefix = 'refs/remotes/origin/';
    if (!head.startsWith(prefix)) return;
    // FETCH_HEAD is the main checkout's: a session's `git pull` there reads it.
    await git(projectDir, ['fetch', '--quiet', '--no-write-fetch-head', 'origin', head.slice(prefix.length)], {
      env: { GIT_TERMINAL_PROMPT: '0' },
      timeoutMs: 30_000,
    });
  } catch {
    // Nothing to fetch, or the fetch failed: the check goes on with what is there.
  }
}

/** The commit the branch points at; null when there is no such branch. */
async function branchTip(projectDir: string, branch: string): Promise<string | null> {
  return git(projectDir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(
    (out) => out.trim(),
    (err: unknown) => {
      // As in branchExists: a git that ran and found no branch exits non-zero; one that never ran has a code such as ENOENT.
      if (typeof (err as { code?: unknown }).code !== 'number') throw err;
      return null;
    },
  );
}

/**
 * A reflog entry of a command that made a commit on the branch: a commit (amended, merged or the first), a
 * cherry-pick or a revert. A fast-forward, a pull, a reset or a rebase only moves the branch, perhaps onto a newer
 * base, so it counts for nothing: an empty branch moved up is not mistaken for a merged one.
 */
const MADE_A_COMMIT = /^(commit( \([a-z]+\))?|cherry-pick|revert):/;

async function branchState(projectDir: string, branch: string, tip: string | null, from: string): Promise<TaskGitState['branch']> {
  if (tip === null) return 'gone';
  const reflog = (await git(projectDir, ['reflog', 'show', '--format=%gs', `refs/heads/${branch}`]).catch(() => '')).split('\n').filter(Boolean);
  const untouched = reflog.length
    ? !reflog.some((subject) => MADE_A_COMMIT.test(subject))
    : (await git(projectDir, ['rev-list', '--count', `${from}..${tip}`])).trim() === '0';
  if (untouched) return 'no-commits';
  try {
    // Merging it into the base changes nothing when the result has the base's own tree.
    const merged = (await git(projectDir, ['merge-tree', '--write-tree', from, tip])).split('\n')[0];
    const tree = (await git(projectDir, ['rev-parse', `${from}^{tree}`])).trim();
    return merged === tree ? 'merged' : 'unmerged';
  } catch {
    // A conflict, or a git without --write-tree (before 2.38).
    return 'unmerged';
  }
}

/** Paths git status lists: changed, staged or untracked, not ignored. */
async function uncommittedPaths(worktreePath: string): Promise<string[]> {
  const out = await git(worktreePath, [...NO_INDEX_REFRESH, 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const records = out.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < records.length; i++) {
    paths.push(records[i].slice(3));
    // A rename or copy is followed by a record for its source.
    if (/[RC]/.test(records[i].slice(0, 2))) i++;
  }
  return paths.sort();
}

/** What removing a task's worktree and branch would lose. A folder that is gone, or a plain one inside the main checkout, has nothing. */
export async function taskGitState(projectDir: string, branch: string, worktreePath: string): Promise<TaskGitState> {
  const from = await base(projectDir);
  // Everything is judged on this commit, so a commit added meanwhile is not passed by a check of the one before.
  const tip = await branchTip(projectDir, branch);
  const state = await branchState(projectDir, branch, tip, from);
  let uncommitted: string[] = [];
  let elsewhere = false;
  let head: string | null = null;
  // A missing folder has nothing to lose; any other failure rejects, so the caller leaves the task alone.
  if ((await pathExists(worktreePath)) && (await isWorktreeTop(worktreePath))) {
    uncommitted = await uncommittedPaths(worktreePath);
    const checkedOut = await git(worktreePath, ['symbolic-ref', '-q', 'HEAD']).then(
      (out) => out.trim(),
      () => null,
    );
    elsewhere = checkedOut !== `refs/heads/${branch}`;
    if (elsewhere) head = (await git(worktreePath, ['rev-parse', 'HEAD'])).trim();
  }
  const tips = [...(tip ? [tip] : []), ...(head ? [head] : [])];
  const unsaved = tips.length
    ? (await git(projectDir, ['log', '--format=x%s', ...tips, '--not', from, '--remotes']))
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(1))
    : [];
  return { branch: state, tip, uncommitted, elsewhere, unsaved };
}

/** A removal git left half done: it dropped the worktree, but some of its folder is still there. */
export class FolderLeftError extends Error {}

/**
 * Resolves when the folder is gone, clearing git's entry for it if it has one; other worktrees' entries are left
 * alone. Rejects with git's message: a locked worktree, or changes without `force`; as a `FolderLeftError` when the
 * folder is left behind no longer a worktree.
 */
export async function removeWorktree(projectDir: string, worktreePath: string, o: { force: boolean }): Promise<void> {
  const remove = ['worktree', 'remove', ...(o.force ? ['--force'] : []), worktreePath];
  if (!(await pathExists(worktreePath))) {
    // A folder deleted by hand may still be registered; with no entry, git fails and there is nothing to clear.
    await git(projectDir, remove).catch(() => {});
    return;
  }
  try {
    await git(projectDir, remove);
  } catch (err) {
    const { message } = gitError(err);
    if ((await pathExists(worktreePath)) && !(await isWorktreeTop(worktreePath).catch(() => false))) throw new FolderLeftError(message);
    throw new Error(message);
  }
}

/** False when nothing is at `path`; any other failure to look rejects. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Deletes the branch, as `git branch -D` does: the caller has proved its commits are safe. Given the `tip` that proof
 * was made on, only while the branch still points there; it rejects otherwise. Resolves when it is gone already.
 */
export async function deleteBranch(projectDir: string, branch: string, tip?: string): Promise<void> {
  if (!(await branchExists(projectDir, branch))) return;
  if (tip === undefined) {
    await git(projectDir, ['branch', '-D', branch]).catch(withGitMessage);
    return;
  }
  await git(projectDir, ['update-ref', '-d', `refs/heads/${branch}`, tip]).catch(withGitMessage);
  // Its settings, which `branch -D` would have removed; a branch with none has no section to remove.
  await git(projectDir, ['config', '--remove-section', `branch.${branch}`]).catch(() => {});
}

export const gitQueries = {
  startCheck,
  branchExists,
  worktreeBranchNames,
  changedFiles,
  taskDiff,
  addWorktree,
  fetchBase,
  taskGitState,
  removeWorktree,
  deleteBranch,
};
export type GitQueries = typeof gitQueries;

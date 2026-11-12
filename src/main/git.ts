// Adapted from Parallel Code (MIT): electron/ipc/git.ts (getChangedFiles) at 97c3558. See THIRD_PARTY_NOTICES.md.
import { execFile } from 'node:child_process';
import { lstat, open, readlink, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ChangedFile, FileDiff, StartCheck } from '../shared/types';
import { assembleDiff, DIFF_LIMITS, focusFirst, type UntrackedContent } from './diff/assembleDiff';
import { parsePatch } from './diff/parsePatch';

const execFileAsync = promisify(execFile);

// --no-optional-locks keeps the app from taking the index lock while a session runs git.
async function git(dir: string, args: string[], opts: { maxBuffer?: number } = {}): Promise<string> {
  const { stdout } = await execFileAsync('git', ['--no-optional-locks', '-C', dir, ...args], {
    encoding: 'utf8',
    maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
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
    if (budget.spent) return { kind: 'notRead' };
    if (info.size > DIFF_LIMITS.fileChars) return { kind: 'tooLarge' };
    if (info.size > budget.left) {
      budget.spent = true;
      return { kind: 'notRead' };
    }
    budget.left -= info.size;
    if (info.isSymbolicLink()) return { kind: 'text', lines: [await readlink(file)] };
    // No more than the size the limits were checked against: the file may grow while it is read.
    const handle = await open(file, 'r');
    let bytes: Buffer;
    try {
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(info.size), 0, info.size, 0);
      bytes = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    if (bytes.subarray(0, 8000).includes(0)) return { kind: 'binary' };
    const lines = bytes.toString('utf8').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return { kind: 'text', lines: lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)) };
  } catch {
    return undefined;
  }
}

/** git's own words: execFile's message leads with the whole command line. */
function withGitMessage(err: unknown): never {
  const stderr = String((err as { stderr?: unknown }).stderr ?? '').trim();
  throw stderr ? new Error(stderr) : err;
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

export const gitQueries = { startCheck, branchExists, worktreeBranchNames, changedFiles, taskDiff };
export type GitQueries = typeof gitQueries;

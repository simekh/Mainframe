import type { UpdateHow } from '../../shared/types';
import { NO_PROMPTS, runGit } from '../git';
import { newestRelease, type Version } from './versions';

// Calls that talk to the remote fail instead of asking anyone anything, and give up after 30 s, as fetchBase does.
const REMOTE_OPTS = { env: NO_PROMPTS, timeoutMs: 30_000 };
const NO_ASK = ['-c', 'credential.interactive=false'];

const lines = (out: string): string[] => out.split('\n').filter(Boolean);

/** The newest release tag merged into HEAD: what this clone runs, whatever it has committed since. Null without one. */
export async function runningVersion(dir: string): Promise<Version | null> {
  return newestRelease(lines(await runGit(dir, ['tag', '--merged', 'HEAD', '--list', 'v*'])));
}

/** The current branch's remote, else `origin` when there is one; null when neither. */
export async function releaseRemote(dir: string): Promise<string | null> {
  const branch = await runGit(dir, ['symbolic-ref', '--short', '-q', 'HEAD']).then(
    (out) => out.trim(),
    () => '',
  );
  if (branch) {
    // git config exits 1 for a key that is not set.
    const configured = await runGit(dir, ['config', '--get', `branch.${branch}.remote`]).then(
      (out) => out.trim(),
      () => '',
    );
    if (configured) return configured;
  }
  return lines(await runGit(dir, ['remote'])).includes('origin') ? 'origin' : null;
}

/** The newest release tag on the remote. Rejects when the remote can't be reached. */
export async function remoteNewest(dir: string, remote: string): Promise<Version | null> {
  const out = await runGit(dir, [...NO_ASK, 'ls-remote', '--tags', '--refs', remote], REMOTE_OPTS);
  const tags = lines(out).map((line) => line.split('\t')[1]?.replace(/^refs\/tags\//, '') ?? '');
  return newestRelease(tags);
}

/** Fetches the release tag, then reads CHANGELOG.md as of it; null when that release has none. Rejects when the fetch fails. */
export async function changelogAt(dir: string, remote: string, tag: string): Promise<string | null> {
  await runGit(dir, [...NO_ASK, 'fetch', '--quiet', remote, `refs/tags/${tag}:refs/tags/${tag}`], REMOTE_OPTS);
  try {
    return await runGit(dir, ['show', `refs/tags/${tag}:CHANGELOG.md`]);
  } catch (err) {
    // A git that ran and found no such file exits non-zero; one that never ran has a code such as ENOENT.
    if (typeof (err as { code?: unknown }).code !== 'number') throw err;
    return null;
  }
}

/** True when the only line of `git status --porcelain --untracked-files=no` is the lockfile: an `npm install` rewrites it. */
export function onlyLockfileChanged(porcelain: string): boolean {
  const changed = lines(porcelain);
  return changed.length === 1 && changed[0].slice(3) === 'package-lock.json';
}

/**
 * Whether the app can update this clone to `tag` by itself. Own commits come first: they need a merge, not a
 * fast-forward. Assumes the tag is fetched already (changelogAt does it).
 */
export async function howToUpdate(dir: string, remote: string, tag: string, launcher: boolean): Promise<UpdateHow> {
  const byHand = (why: 'not-launcher' | 'uncommitted' | 'own-commits'): UpdateHow => ({
    kind: 'by-hand',
    why,
    commands: [
      `git fetch ${remote} tag ${tag}`,
      why === 'own-commits' ? `git merge ${tag}` : `git merge --ff-only ${tag}`,
      'npm install',
      'npm start',
    ],
  });

  const ownCommits = await runGit(dir, ['merge-base', '--is-ancestor', 'HEAD', `refs/tags/${tag}`]).then(
    () => false,
    (err: unknown) => {
      // Exit 1 means HEAD is not an ancestor; any other failure rejects.
      if ((err as { code?: unknown }).code !== 1) throw err;
      return true;
    },
  );
  if (ownCommits) return byHand('own-commits');

  const status = await runGit(dir, ['status', '--porcelain', '--untracked-files=no']);
  if (lines(status).length > 0 && !onlyLockfileChanged(status)) return byHand('uncommitted');
  return launcher ? { kind: 'one-click' } : byHand('not-launcher');
}

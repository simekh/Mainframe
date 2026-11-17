// What `npm start` does when Mainframe quits to update: move this clone to the release tag, which the app's check
// fetched already, and install its packages. A small copy of the app's rules in src/main/updates/updateGit.ts, which a
// script can't import.
import { execFileSync } from 'node:child_process';

/** A release tag as the app writes it. Anything else never reaches git. */
export const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

/** A read-only git query's output; '' when git exits non-zero (a ref that isn't there). */
function read(dir, args) {
  try {
    // Only the end is trimmed: a porcelain status line starts with a meaningful space.
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trimEnd();
  } catch {
    return '';
  }
}

/**
 * Fast-forwards to `tag` and runs `npm install`. `run` runs a command in `dir` and returns its exit status: git's
 * calls name `dir` with -C, and npm's need `dir` as the working folder.
 */
export function applyUpdate(dir, tag, run) {
  const ok = (cmd, args) => run(cmd, args).status === 0;
  if (!read(dir, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])) {
    return { ok: false, stage: 'merge', message: `this clone doesn't have ${tag}. Nothing was changed.` };
  }

  // `npm install` can rewrite the lockfile on its own; that alone doesn't stop an update. Restored from HEAD, so a
  // staged rewrite goes too.
  const changed = read(dir, ['status', '--porcelain', '--untracked-files=no']).split('\n').filter(Boolean);
  if (changed.length === 1 && changed[0].slice(3) === 'package-lock.json') {
    if (!ok('git', ['-C', dir, 'checkout', 'HEAD', '--', 'package-lock.json'])) {
      return { ok: false, stage: 'merge', message: 'git could not restore package-lock.json. Nothing was changed.' };
    }
  }
  if (!ok('git', ['-C', dir, 'merge', '--ff-only', '--quiet', `refs/tags/${tag}`])) {
    return { ok: false, stage: 'merge', message: `git could not fast-forward to ${tag}. Nothing was changed.` };
  }
  if (!ok('npm', ['install'])) {
    return { ok: false, stage: 'install', message: `Mainframe is on ${tag}, but npm install failed.` };
  }
  return { ok: true };
}
